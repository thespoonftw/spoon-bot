// Photos of me: find the photos you're in, if you've opted in.
//
// A background loop scans every photo for faces with InsightFace's SCRFD detector, lines each face up
// by its eyes, nose and mouth, and turns it into a 512-number "fingerprint" with InsightFace's ArcFace
// model. Fingerprints of the same person point the same way; different people's don't.
//
// Nobody is findable until they opt in by adding a few selfies. Only the selfies' fingerprints are
// kept (the images are thrown away), and only you can search for yourself. Opting out deletes them.
//
// Everything runs locally on the CPU. The two models (~190MB) download from Hugging Face on first
// start into DATA_DIR/models/faces. InsightFace's models are licensed for non-commercial use only.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import http from "http";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type * as Ort from "onnxruntime-node";
import { DATA_DIR } from "./state";
import { PHOTO_STORAGE_PATH } from "./photoStorage";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { SMART_MODEL_KEY } from "./smartSearch";
import {
  dbGetPhotosNeedingFaceScan, dbSaveFaceScan, dbClearFailedFaceScans, dbLoadFaces, dbFaceScanStatus,
  dbAddFaceRef, dbGetFaceRefs, dbDeleteFaceRefs, dbEmbeddingStatus, type FaceBox,
} from "./db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as typeof import("sharp").default;

const MODEL_BASE = "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/";
const MODELS = {
  detector: { file: "det_10g.onnx", sha256: "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91" },
  recogniser: { file: "w600k_r50.onnx", sha256: "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43" },
};
// Fingerprints from different models aren't comparable; changing this rescans the library and asks
// everyone for fresh selfies.
export const FACE_MODEL_KEY = "insightface-buffalo_l";

// Photos are decoded at up to this size: big enough for faces in group shots, quick to decode.
const DECODE_MAX = 1920;
const DET_SIZE = 640;
const DET_THRESHOLD = 0.5;
const NMS_THRESHOLD = 0.4;
// Faces smaller than this (in the decoded photo) are too blurry to recognise reliably.
const MIN_FACE_PX = 32;
const MAX_FACES_PER_PHOTO = 40;
// A face is you if its fingerprint is at least this similar to one of your selfies'. ArcFace scores
// the same person ~0.4–0.8 and different people below ~0.2; selfies against candid, side-on shots
// sit lower, so this leaves some room.
const MATCH_THRESHOLD = 0.36;
// Faces that match very confidently join your selfies for a second pass, which catches angles and
// lighting the selfies don't cover. They must clear a higher bar against those faces.
const SEED_THRESHOLD = 0.55;
const MAX_SEEDS = 30;
const EXPANDED_THRESHOLD = 0.45;
const MAX_REFS = 10;
// Leave half the server's 4 cores for the bot and web server.
const THREADS = 2;
const BATCH = 10;
const IDLE_POLL_MS = 60 * 1000;

// Where ArcFace expects the eyes, nose and mouth corners in its 112×112 input.
const ARCFACE_DST = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

type Models = { ort: typeof Ort; detector: Ort.InferenceSession; recogniser: Ort.InferenceSession };
type Rgb = { data: Buffer; width: number; height: number };
type Detection = { x1: number; y1: number; x2: number; y2: number; score: number; kps: number[] };
export type FoundFace = { box: Detection; embedding: Float32Array };

let modelsPromise: Promise<Models> | null = null;
let modelsReady = false;
// Photo id → the fingerprints of the faces in it.
const index = new Map<number, Float32Array[]>();
let started = false;

const modelDir = () => path.join(DATA_DIR, "models", "faces");

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function ensureModelFile(m: { file: string; sha256: string }): Promise<string> {
  const dest = path.join(modelDir(), m.file);
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(modelDir(), { recursive: true });
  console.log(`[faces] downloading ${m.file}`);
  const res = await fetch(MODEL_BASE + m.file);
  if (!res.ok || !res.body) throw new Error(`download of ${m.file} failed: ${res.status}`);
  const tmp = dest + ".part";
  await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), fs.createWriteStream(tmp));
  if (await sha256(tmp) !== m.sha256) { fs.unlinkSync(tmp); throw new Error(`${m.file} failed its checksum`); }
  fs.renameSync(tmp, dest);
  return dest;
}

function loadModels(): Promise<Models> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ort = require("onnxruntime-node") as typeof Ort;
      const opts: Ort.InferenceSession.SessionOptions = { intraOpNumThreads: THREADS, interOpNumThreads: 1 };
      const [det, rec] = [await ensureModelFile(MODELS.detector), await ensureModelFile(MODELS.recogniser)];
      const [detector, recogniser] = await Promise.all([ort.InferenceSession.create(det, opts), ort.InferenceSession.create(rec, opts)]);
      modelsReady = true;
      return { ort, detector, recogniser };
    })();
    modelsPromise.catch(e => { console.error("[faces] model load failed:", e); modelsPromise = null; });
  }
  return modelsPromise;
}

/** Upright 8-bit RGB, at most DECODE_MAX on its long side. `lenient` accepts truncated files. */
async function decode(input: string | Buffer, lenient: boolean): Promise<Rgb> {
  const { data, info } = await sharp(input, { failOn: lenient ? "none" : "warning" })
    .rotate().resize(DECODE_MAX, DECODE_MAX, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`unexpected ${info.channels}-channel image`);
  return { data, width: info.width, height: info.height };
}

function iou(a: Detection, b: Detection): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
}

/** SCRFD: the photo shrunk into a 640×640 square (padded bottom/right), boxes and landmarks mapped back. */
async function detect(m: Models, img: Rgb): Promise<Detection[]> {
  const scale = DET_SIZE / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const square = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(w, h, { fit: "fill" })
    .extend({ right: DET_SIZE - w, bottom: DET_SIZE - h, background: { r: 0, g: 0, b: 0 } })
    .raw().toBuffer();
  const plane = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (square[i * 3 + c] - 127.5) / 128;
  }
  const out = await m.detector.run({ [m.detector.inputNames[0]]: new m.ort.Tensor("float32", input, [1, 3, DET_SIZE, DET_SIZE]) });
  const names = m.detector.outputNames; // scores ×3 strides, then boxes ×3, then landmarks ×3
  const found: Detection[] = [];
  [8, 16, 32].forEach((stride, s) => {
    const scores = out[names[s]].data as Float32Array;
    const boxes = out[names[s + 3]].data as Float32Array;
    const kps = out[names[s + 6]].data as Float32Array;
    const gridW = DET_SIZE / stride;
    for (let k = 0; k < scores.length; k++) {
      if (scores[k] < DET_THRESHOLD) continue;
      const loc = k >> 1; // two anchors per grid point
      const cx = (loc % gridW) * stride, cy = Math.floor(loc / gridW) * stride;
      const b = boxes.subarray(k * 4, k * 4 + 4);
      const p = kps.subarray(k * 10, k * 10 + 10);
      found.push({
        x1: (cx - b[0] * stride) / scale, y1: (cy - b[1] * stride) / scale,
        x2: (cx + b[2] * stride) / scale, y2: (cy + b[3] * stride) / scale,
        score: scores[k],
        kps: Array.from(p, (v, j) => ((j % 2 ? cy : cx) + v * stride) / scale),
      });
    }
  });
  found.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of found) if (!kept.some(k => iou(k, d) > NMS_THRESHOLD)) kept.push(d);
  return kept;
}

/**
 * The 112×112 face ArcFace expects: the best rotate + scale + shift taking the five landmarks onto
 * ARCFACE_DST, then each output pixel sampled (bilinearly) from where it lands in the photo.
 */
function align(img: Rgb, kps: number[]): Float32Array {
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < 5; i++) { sx += kps[i * 2]; sy += kps[i * 2 + 1]; dx += ARCFACE_DST[i][0]; dy += ARCFACE_DST[i][1]; }
  sx /= 5; sy /= 5; dx /= 5; dy /= 5;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < 5; i++) {
    const px = kps[i * 2] - sx, py = kps[i * 2 + 1] - sy, qx = ARCFACE_DST[i][0] - dx, qy = ARCFACE_DST[i][1] - dy;
    num1 += px * qx + py * qy; num2 += px * qy - py * qx; den += px * px + py * py;
  }
  const a = num1 / den, b = num2 / den; // dst = [a -b; b a]·src + t
  const tx = dx - (a * sx - b * sy), ty = dy - (b * sx + a * sy);
  const inv = 1 / (a * a + b * b);
  const plane = 112 * 112;
  const out = new Float32Array(3 * plane);
  for (let v = 0; v < 112; v++) {
    for (let u = 0; u < 112; u++) {
      const ux = u - tx, vy = v - ty;
      const x = inv * (a * ux + b * vy), y = inv * (-b * ux + a * vy);
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      for (let c = 0; c < 3; c++) {
        const px = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? 0 : img.data[(yy * img.width + xx) * 3 + c];
        const val = px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy)
          + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy;
        out[c * plane + v * 112 + u] = (val - 127.5) / 127.5;
      }
    }
  }
  return out;
}

function normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= len;
  return v;
}

/** One fingerprint per face; the recogniser takes them one at a time. */
async function fingerprint(m: Models, img: Rgb, faces: Detection[]): Promise<Float32Array[]> {
  const result: Float32Array[] = [];
  for (const f of faces) {
    const input = new m.ort.Tensor("float32", align(img, f.kps), [1, 3, 112, 112]);
    const out = await m.recogniser.run({ [m.recogniser.inputNames[0]]: input });
    result.push(normalise(Float32Array.from(out[m.recogniser.outputNames[0]].data as Float32Array)));
  }
  return result;
}

/** The recognisable faces in an image, largest first. */
export async function findFaces(input: string | Buffer, lenient = false): Promise<{ faces: FoundFace[]; width: number; height: number }> {
  const m = await loadModels();
  const img = await decode(input, lenient);
  const boxes = (await detect(m, img))
    .filter(d => Math.min(d.x2 - d.x1, d.y2 - d.y1) >= MIN_FACE_PX)
    .sort((p, q) => (q.x2 - q.x1) * (q.y2 - q.y1) - (p.x2 - p.x1) * (p.y2 - p.y1))
    .slice(0, MAX_FACES_PER_PHOTO);
  const prints = await fingerprint(m, img, boxes);
  return { faces: boxes.map((box, i) => ({ box, embedding: prints[i] })), width: img.width, height: img.height };
}

/** The original if it's readable (thumbnails are too small for faces in group shots). */
async function scanPhoto(channelId: string, filename: string): Promise<FaceBox[]> {
  const full = path.join(PHOTO_STORAGE_PATH, channelId, filename);
  if (!fs.existsSync(full)) throw new Error("file not found");
  const { faces, width, height } = await findFaces(full, true);
  return faces.map(({ box, embedding }) => ({
    x: Math.max(0, box.x1 / width), y: Math.max(0, box.y1 / height),
    w: (box.x2 - box.x1) / width, h: (box.y2 - box.y1) / height,
    score: box.score, embedding: Buffer.from(embedding.buffer),
  }));
}

const toVec = (b: Buffer) => new Float32Array(new Uint8Array(b).buffer); // copied: SQLite buffers needn't be aligned
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function scanLoop(): Promise<void> {
  dbClearFailedFaceScans(FACE_MODEL_KEY);
  for (const f of dbLoadFaces(FACE_MODEL_KEY)) {
    const list = index.get(f.photoId);
    if (list) list.push(toVec(f.embedding)); else index.set(f.photoId, [toVec(f.embedding)]);
  }
  console.log(`[faces] ${[...index.values()].reduce((n, l) => n + l.length, 0)} faces loaded from ${index.size} photos`);
  for (;;) {
    try { await loadModels(); break; } catch { await sleep(10 * 60 * 1000); }
  }
  console.log("[faces] models ready");
  for (;;) {
    // Smart search gets the CPU first; faces carry on once it has caught up.
    if (!fs.existsSync(PHOTO_STORAGE_PATH) || dbEmbeddingStatus(SMART_MODEL_KEY).pending > 0) { await sleep(IDLE_POLL_MS); continue; }
    const batch = dbGetPhotosNeedingFaceScan(FACE_MODEL_KEY, BATCH);
    if (!batch.length) { await sleep(IDLE_POLL_MS); continue; }
    const batchStart = Date.now();
    for (const p of batch) {
      try {
        if (!p.filename) throw new Error("no file");
        const faces = await scanPhoto(p.channelId, p.filename);
        dbSaveFaceScan(p.id, FACE_MODEL_KEY, faces);
        if (faces.length) index.set(p.id, faces.map(f => toVec(f.embedding))); else index.delete(p.id);
      } catch (e) {
        if (!fs.existsSync(PHOTO_STORAGE_PATH)) break; // drive dropped mid-batch: retry these later
        console.error(`[faces] photo ${p.id} skipped: ${(e as Error).message}`);
        dbSaveFaceScan(p.id, FACE_MODEL_KEY, null);
      }
    }
    const s = dbFaceScanStatus(FACE_MODEL_KEY);
    if (s.scanned < s.total) console.log(`[faces] scanned ${s.scanned}/${s.total} (${Math.round((Date.now() - batchStart) / batch.length)}ms/photo)`);
    else console.log(`[faces] library fully scanned (${s.total} photos)`);
  }
}

export function startFaceScan(): void {
  if (started) return;
  started = true;
  scanLoop().catch(e => console.error("[faces] scanner stopped:", e));
}

export class SelfieError extends Error {}

/** Opting in (or adding another angle): keeps the fingerprint of the one face in the selfie. */
export async function addSelfie(userId: string, image: Buffer): Promise<number> {
  const existing = dbGetFaceRefs(userId, FACE_MODEL_KEY).length;
  if (existing >= MAX_REFS) throw new SelfieError(`You've already added ${MAX_REFS} selfies — turn it off and on again to start over.`);
  let found: FoundFace[];
  try { ({ faces: found } = await findFaces(image)); } catch (e) {
    if (e instanceof Error && /unsupported image format|Input buffer/i.test(e.message)) throw new SelfieError("That file isn't a photo we can read.");
    throw e;
  }
  const area = (f: FoundFace) => (f.box.x2 - f.box.x1) * (f.box.y2 - f.box.y1);
  if (!found.length || found[0].box.score < 0.6) throw new SelfieError("We couldn't find a clear face in that photo. Try one taken straight on, in good light.");
  if (found.length > 1 && area(found[1]) > area(found[0]) * 0.4) throw new SelfieError("There's more than one face in that photo — use one with just you in it.");
  dbAddFaceRef(userId, FACE_MODEL_KEY, Buffer.from(found[0].embedding.buffer));
  return existing + 1;
}

export function removeSelfies(userId: string): void {
  dbDeleteFaceRefs(userId);
}

function bestScore(faces: Float32Array[], refs: Float32Array[]): number {
  let best = -1;
  for (const f of faces) {
    for (const r of refs) {
      let s = 0;
      for (let i = 0; i < r.length; i++) s += f[i] * r[i];
      if (s > best) best = s;
    }
  }
  return best;
}

/** The photos you're in, most confident first, or null if you haven't opted in. Callers apply album access. */
export function photosOfUser(userId: string): number[] | null {
  const refs = dbGetFaceRefs(userId, FACE_MODEL_KEY).map(toVec);
  if (!refs.length) return null;
  const scores = new Map<number, number>();
  for (const [photoId, faces] of index) scores.set(photoId, bestScore(faces, refs));
  // Second pass: your most confident matches stand in as extra selfies.
  const seeds: Float32Array[] = [];
  for (const [photoId, score] of [...scores].filter(([, s]) => s >= SEED_THRESHOLD).sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEDS)) {
    const faces = index.get(photoId)!;
    seeds.push(faces.reduce((best, f) => bestScore([f], refs) > bestScore([best], refs) ? f : best));
  }
  const hits: { id: number; score: number }[] = [];
  for (const [photoId, score] of scores) {
    if (score >= MATCH_THRESHOLD) hits.push({ id: photoId, score });
    else if (seeds.length) {
      const expanded = bestScore(index.get(photoId)!, seeds);
      // Ranked just below direct matches, in order of how well they match the stand-ins.
      if (expanded >= EXPANDED_THRESHOLD) hits.push({ id: photoId, score: MATCH_THRESHOLD - (1 - expanded) * 0.1 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).map(h => h.id);
}

export function faceStatus(userId: string): { optedIn: boolean; selfies: number; maxSelfies: number; ready: boolean; scanned: number; total: number } {
  const s = dbFaceScanStatus(FACE_MODEL_KEY);
  const selfies = dbGetFaceRefs(userId, FACE_MODEL_KEY).length;
  return { optedIn: selfies > 0, selfies, maxSelfies: MAX_REFS, ready: modelsReady, scanned: s.scanned, total: s.total };
}

// ── Routes ──

const MAX_SELFIE_BYTES = 25 * 1024 * 1024;

/** The whole request body, or null if it's bigger than MAX_SELFIE_BYTES. Selfies are only ever held in memory. */
function readSelfie(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_SELFIE_BYTES) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * GET    /api/faces/me          whether you've opted in, and how far the library scan has got
 * POST   /api/faces/me/selfies  opt in / add another selfie (the raw image is the body)
 * DELETE /api/faces/me          opt out: forgets your selfies
 */
export function handleFaceRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  if (url !== "/api/faces/me" && url !== "/api/faces/me/selfies") return false;
  const method = req.method ?? "GET";
  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) { send401(res); return true; }

  if (url === "/api/faces/me" && method === "GET") { sendJson(res, 200, faceStatus(user.userId)); return true; }
  if (url === "/api/faces/me" && method === "DELETE") {
    removeSelfies(user.userId);
    console.log(`[faces] ${user.displayName} opted out`);
    sendJson(res, 200, faceStatus(user.userId));
    return true;
  }
  if (url === "/api/faces/me/selfies" && method === "POST") {
    if (!(req.headers["content-type"] ?? "").startsWith("image/")) { sendJson(res, 400, { error: "That file isn't a photo." }); return true; }
    readSelfie(req)
      .then(async body => {
        if (!body) { sendJson(res, 413, { error: "That photo is too big (25MB max)." }); return; }
        const count = await addSelfie(user.userId, body);
        console.log(`[faces] ${user.displayName} added selfie ${count}`);
        sendJson(res, 200, faceStatus(user.userId));
      })
      .catch(e => {
        if (res.headersSent) return;
        if (e instanceof SelfieError) { sendJson(res, 400, { error: e.message }); return; }
        console.error("[faces] selfie failed:", e);
        sendJson(res, 503, { error: "Face matching isn't available right now — try again in a minute." });
      });
    return true;
  }
  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}
