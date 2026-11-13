// Smart photo search: find photos by what's in them ("cat", "birthday cake", "snow") without tags.
//
// Each photo is run through a CLIP model, which turns it into a 512-number "embedding" capturing
// what the photo shows. A search query goes through CLIP's text half into the same space, and the
// photos whose embeddings point the same way as the query's are the matches.
//
// Everything runs locally on the CPU; the models (~600MB) download from Hugging Face on first start
// into DATA_DIR/models. A background loop embeds any photo that doesn't have an embedding yet: the
// existing library once, then each new upload (from the site or Discord) within a minute or so.
import fs from "fs";
import path from "path";
import type * as Transformers from "@huggingface/transformers";
import { DATA_DIR } from "./state";
import { PHOTO_STORAGE_PATH } from "./photoStorage";
import { dbGetPhotosNeedingEmbedding, dbSaveEmbedding, dbLoadEmbeddings, dbEmbeddingStatus } from "./db";

const MODEL_ID = "Xenova/clip-vit-base-patch16";
// Embeddings from different models aren't comparable, so each is stored with the model that made it;
// changing MODEL_ID makes the indexer redo the whole library.
export const SMART_MODEL_KEY = MODEL_ID;
// Minimum query/photo similarity to count as a match. Tuned on the real library with the "a photo of"
// prompt: real matches scored ~0.25–0.31, the best of unrelated photos ~0.21–0.23.
const MATCH_THRESHOLD = 0.24;
const MAX_RESULTS = 500;
// Leave half the server's 4 cores for the bot and web server while the backlog is processed.
const THREADS = 2;
const BATCH = 20;
const IDLE_POLL_MS = 60 * 1000;

type Models = {
  t: typeof Transformers;
  processor: Transformers.Processor;
  vision: Transformers.PreTrainedModel;
  tokenizer: Transformers.PreTrainedTokenizer;
  text: Transformers.PreTrainedModel;
};

let modelsPromise: Promise<Models> | null = null;
const index = new Map<number, Float32Array>();
let started = false;

function loadModels(): Promise<Models> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require("@huggingface/transformers") as typeof Transformers;
      t.env.cacheDir = path.join(DATA_DIR, "models");
      const opts = { dtype: "fp32" as const, session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 } };
      const [processor, vision, tokenizer, text] = await Promise.all([
        t.AutoProcessor.from_pretrained(MODEL_ID),
        t.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, opts),
        t.AutoTokenizer.from_pretrained(MODEL_ID),
        t.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, opts),
      ]);
      return { t, processor, vision, tokenizer, text };
    })();
    modelsPromise.catch(e => { console.error("[smart-search] model load failed:", e); modelsPromise = null; });
  }
  return modelsPromise;
}

function normalise(data: ArrayLike<number>): Float32Array {
  const v = Float32Array.from(data);
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= len;
  return v;
}

async function embedImage(m: Models, filePath: string): Promise<Float32Array> {
  const image = await m.t.RawImage.read(filePath);
  const inputs = await m.processor(image);
  const { image_embeds } = await m.vision(inputs);
  return normalise(image_embeds.data as Float32Array);
}

/** The thumbnail (256px, plenty for CLIP's 224px input and much quicker to decode), else the original. */
function photoFile(channelId: string, filename: string): string | null {
  const thumb = path.join(PHOTO_STORAGE_PATH, channelId, "thumbs", filename);
  if (fs.existsSync(thumb)) return thumb;
  const full = path.join(PHOTO_STORAGE_PATH, channelId, filename);
  return fs.existsSync(full) ? full : null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function indexLoop(): Promise<void> {
  // Copied out of the Buffer: SQLite's buffers needn't be 4-byte aligned for a Float32Array view.
  for (const row of dbLoadEmbeddings(SMART_MODEL_KEY)) index.set(row.id, new Float32Array(new Uint8Array(row.embedding).buffer));
  console.log(`[smart-search] ${index.size} photo embeddings loaded`);
  let models: Models;
  for (;;) {
    try { models = await loadModels(); break; } catch { await sleep(10 * 60 * 1000); }
  }
  console.log("[smart-search] models ready");
  for (;;) {
    // The photo drive can drop its mount; wait for the watchdog to bring it back rather than
    // marking every photo as unreadable.
    if (!fs.existsSync(PHOTO_STORAGE_PATH)) { await sleep(IDLE_POLL_MS); continue; }
    const batch = dbGetPhotosNeedingEmbedding(SMART_MODEL_KEY, BATCH);
    if (!batch.length) { await sleep(IDLE_POLL_MS); continue; }
    const batchStart = Date.now();
    for (const p of batch) {
      const file = p.filename ? photoFile(p.channelId, p.filename) : null;
      try {
        if (!file) throw new Error("file not found");
        const vec = await embedImage(models, file);
        dbSaveEmbedding(p.id, SMART_MODEL_KEY, Buffer.from(vec.buffer));
        index.set(p.id, vec);
      } catch (e) {
        if (!fs.existsSync(PHOTO_STORAGE_PATH)) break; // drive dropped mid-batch: retry these later
        // Saved with no embedding so a corrupt or missing file isn't retried forever.
        console.error(`[smart-search] photo ${p.id} skipped: ${(e as Error).message}`);
        dbSaveEmbedding(p.id, SMART_MODEL_KEY, null);
      }
    }
    const status = dbEmbeddingStatus(SMART_MODEL_KEY);
    if (status.pending > 0) console.log(`[smart-search] indexed ${status.indexed + status.failed}/${status.total} (${Math.round((Date.now() - batchStart) / batch.length)}ms/photo)`);
    else console.log(`[smart-search] library fully indexed (${status.indexed} photos, ${status.failed} skipped)`);
  }
}

export function startSmartSearch(): void {
  if (started) return;
  started = true;
  indexLoop().catch(e => console.error("[smart-search] indexer stopped:", e));
}

/**
 * Photo ids matching a free-text query, best match first. Callers still apply album access and other
 * filters, so this may return photos the user can't see.
 */
export async function smartSearchPhotoIds(query: string): Promise<number[]> {
  const m = await loadModels();
  // CLIP was trained on captions, so a bare "cat" matches better phrased as one.
  const q = query.trim().replace(/^(an? )?(photos?|pictures?|pics?) of /i, "").replace(/^(an?|the) /i, "");
  const tokens = m.tokenizer([`a photo of ${q}`], { padding: true, truncation: true });
  const { text_embeds } = await m.text(tokens);
  const qv = normalise(text_embeds.data as Float32Array);
  const hits: { id: number; score: number }[] = [];
  for (const [id, v] of index) {
    let score = 0;
    for (let i = 0; i < v.length; i++) score += v[i] * qv[i];
    if (score >= MATCH_THRESHOLD) hits.push({ id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, MAX_RESULTS).map(h => h.id);
}

export function smartSearchStatus(): { ready: boolean; indexed: number; total: number } {
  const s = dbEmbeddingStatus(SMART_MODEL_KEY);
  return { ready: started, indexed: s.indexed + s.failed, total: s.total };
}
