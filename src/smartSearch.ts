// Smart photo search: find photos by what's in them ("cat", "birthday cake", "snow") without tags.
//
// Each photo is run through Google's SigLIP 2 model, which turns it into a 768-number "embedding"
// capturing what the photo shows. A search query goes through SigLIP's text half into the same space,
// and the photos whose embeddings point the same way as the query's are the matches. (Until Nov 2026
// this used OpenAI's CLIP; SigLIP 2 is the better retriever at the same size.)
//
// Everything runs locally on the CPU; the models (~1.5GB) download from Hugging Face on first start
// into DATA_DIR/models. A background loop embeds any photo that doesn't have an embedding yet: the
// existing library once, then each new upload (from the site or Discord) within a minute or so.
import fs from "fs";
import path from "path";
import type * as Transformers from "@huggingface/transformers";
import { DATA_DIR } from "./state";
import { PHOTO_STORAGE_PATH } from "./photoStorage";
import { dbGetPhotosNeedingEmbedding, dbSaveEmbedding, dbLoadEmbeddings, dbEmbeddingStatus, dbClearFailedEmbeddings } from "./db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as typeof import("sharp").default;

const MODEL_ID = "onnx-community/siglip2-base-patch16-224-ONNX";
// Embeddings from different models aren't comparable, so each is stored with the model that made it;
// changing MODEL_ID makes the indexer redo the whole library (each new embedding replaces the photo's old one).
export const SMART_MODEL_KEY = MODEL_ID;
// SigLIP's text half was trained on lowercased text padded to exactly this many tokens.
const TEXT_LENGTH = 64;
// A photo matches if its similarity to the query is at least MATCH_FLOOR and within MATCH_WINDOW of the
// query's best match. How high the best match scores varies by word, so the window trims the long
// tail of loose matches for common subjects. SigLIP's scores sit much lower than CLIP's did.
// Tuned by eye on an 800-photo sample (Nov 2026, 20 queries, "a photo of" prompt): best matches score
// ~0.10–0.15, typical photos ~0.02–0.06. At 0.09+ nearly all right, 0.08–0.09 mixed, below 0.08
// mostly wrong. The window stops e.g. "fireworks" (best 0.151) pulling in dark night shots at ~0.09.
const MATCH_FLOOR = 0.09;
const MATCH_WINDOW = 0.05;
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
        t.SiglipVisionModel.from_pretrained(MODEL_ID, opts),
        t.AutoTokenizer.from_pretrained(MODEL_ID),
        t.SiglipTextModel.from_pretrained(MODEL_ID, opts),
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

/** Decodes to 256px RGB (plenty for SigLIP's 224px input). `lenient` accepts truncated files, using what's there. */
async function decode(m: Models, file: string, lenient: boolean): Promise<Transformers.RawImage> {
  const { data, info } = await sharp(file, { failOn: lenient ? "none" : "warning" })
    .rotate().resize(256, 256, { fit: "outside", withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new m.t.RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, info.channels);
}

/**
 * Prefers the thumbnail (much quicker to decode). Some thumbnails were cut short when they were made,
 * so a thumbnail that won't decode cleanly falls back to the original, read leniently.
 */
async function embedPhoto(m: Models, channelId: string, filename: string): Promise<Float32Array> {
  const thumb = path.join(PHOTO_STORAGE_PATH, channelId, "thumbs", filename);
  const full = path.join(PHOTO_STORAGE_PATH, channelId, filename);
  let image: Transformers.RawImage | null = null;
  if (fs.existsSync(thumb)) image = await decode(m, thumb, false).catch(() => null);
  if (!image) {
    if (!fs.existsSync(full)) throw new Error("file not found");
    image = await decode(m, full, true);
  }
  const inputs = await m.processor(image);
  const { pooler_output } = await m.vision(inputs);
  return normalise(pooler_output.data as Float32Array);
}

/** The query's embedding, phrased like the captions the model learned from. */
async function embedQuery(m: Models, query: string): Promise<Float32Array> {
  const q = query.trim().toLowerCase().replace(/^(an? )?(photos?|pictures?|pics?) of /, "").replace(/^(an?|the) /, "");
  const tokens = m.tokenizer([`a photo of ${q}`], { padding: "max_length", max_length: TEXT_LENGTH, truncation: true });
  const { pooler_output } = await m.text(tokens);
  return normalise(pooler_output.data as Float32Array);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function indexLoop(): Promise<void> {
  // Photos that couldn't be read get another go each start, in case a fix (or a re-upload) helps.
  dbClearFailedEmbeddings(SMART_MODEL_KEY);
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
      try {
        if (!p.filename) throw new Error("no file");
        const vec = await embedPhoto(models, p.channelId, p.filename);
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
  // The model was trained on captions, so a bare "cat" matches better phrased as one.
  const qv = await embedQuery(m, query);
  const hits: { id: number; score: number }[] = [];
  let best = 0;
  for (const [id, v] of index) {
    let score = 0;
    for (let i = 0; i < v.length; i++) score += v[i] * qv[i];
    if (score >= MATCH_FLOOR) hits.push({ id, score });
    if (score > best) best = score;
  }
  const cutoff = Math.max(MATCH_FLOOR, best - MATCH_WINDOW);
  return hits.filter(h => h.score >= cutoff).sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS).map(h => h.id);
}

export function smartSearchStatus(): { ready: boolean; indexed: number; total: number } {
  const s = dbEmbeddingStatus(SMART_MODEL_KEY);
  return { ready: started, indexed: s.indexed + s.failed, total: s.total };
}
