import fs from "fs";
import path from "path";
import type { Client, SendableChannels } from "discord.js";
import { DATA_DIR } from "./state";

// ── Temporary feature ────────────────────────────────────────────────────────
// Tails the running Archipelago server log and relays game events to a Discord
// channel. Remove the ARCHIPELAGO_* env vars (or this module) to disable.

const ENABLED = process.env.ARCHIPELAGO_ENABLED === "true";
const CHANNEL_ID = process.env.ARCHIPELAGO_CHANNEL_ID;
const LOG_DIR = process.env.ARCHIPELAGO_LOG_DIR ?? "/home/spoon/archipelago/Archipelago/logs";
const POLL_MS = 4000;
const MAX_LINES_PER_TICK = 40;
const CHUNK_LIMIT = 1900;

const POS_FILE = path.join(DATA_DIR, "archipelago.json");

type Pos = { file: string; offset: number };

let pos: Pos | null = null;
let carry = "";
let channel: SendableChannels | null = null;

function loadPos(): Pos | null {
  try {
    if (fs.existsSync(POS_FILE)) return JSON.parse(fs.readFileSync(POS_FILE, "utf-8"));
  } catch (e) { console.error("[archipelago] failed to read pos file:", e); }
  return null;
}

function savePos() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(POS_FILE, JSON.stringify(pos));
  } catch (e) { console.error("[archipelago] failed to write pos file:", e); }
}

// Server_YYYY_MM_DD_HH_MM_SS.txt — filenames sort chronologically.
function newestLog(): string | null {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => /^Server_.*\.txt$/.test(f))
      .sort();
    return files.length ? path.join(LOG_DIR, files[files.length - 1]) : null;
  } catch (e) {
    console.error("[archipelago] cannot read log dir:", e);
    return null;
  }
}

// Strip "[source at 2026-09-07 15:02:08,746]: " prefix and decide what to relay.
function formatLine(raw: string): string | null {
  const line = raw.replace(/^\[[^\]]+\]:\s*/, "").trim();
  if (!line) return null;
  if (/^connection (open|closed)$/.test(line)) return null;
  if (/^Notice \(Player .+\)/.test(line)) return null;
  if (/Now that you are connected/.test(line)) return null;
  if (/^Notice \(all\): \S+: !/.test(line)) return null; // chat command echoes
  return line.replace(/^Notice \(all\): /, "");
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > CHUNK_LIMIT) {
      if (cur) out.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function relay(lines: string[]) {
  if (!channel || !lines.length) return;
  let toSend = lines;
  if (lines.length > MAX_LINES_PER_TICK) {
    toSend = lines.slice(0, MAX_LINES_PER_TICK);
    toSend.push(`… and ${lines.length - MAX_LINES_PER_TICK} more`);
  }
  for (const part of chunk(toSend.join("\n"))) {
    try {
      await channel.send(part);
    } catch (e) {
      console.error("[archipelago] failed to send:", e);
      return;
    }
  }
}

async function tick() {
  const newest = newestLog();
  if (!newest) return;

  if (!pos || pos.file !== newest) {
    // New server session (or first run with a fresh file): start from the top.
    pos = { file: newest, offset: 0 };
    carry = "";
  }

  let size: number;
  try {
    size = fs.statSync(pos.file).size;
  } catch {
    return;
  }
  if (size < pos.offset) { pos.offset = 0; carry = ""; } // truncated
  if (size === pos.offset) return;

  let buf: Buffer;
  try {
    const fd = fs.openSync(pos.file, "r");
    buf = Buffer.alloc(size - pos.offset);
    fs.readSync(fd, buf, 0, buf.length, pos.offset);
    fs.closeSync(fd);
  } catch (e) {
    console.error("[archipelago] read failed:", e);
    return;
  }
  pos.offset = size;

  const text = carry + buf.toString("utf-8");
  const parts = text.split("\n");
  carry = parts.pop() ?? "";

  const lines = parts.map(formatLine).filter((l): l is string => l !== null);
  savePos();
  await relay(lines);
}

export function startArchipelagoRelay(client: Client) {
  if (!ENABLED) return;
  if (!CHANNEL_ID) { console.error("[archipelago] ARCHIPELAGO_ENABLED set but ARCHIPELAGO_CHANNEL_ID missing"); return; }

  pos = loadPos();
  if (pos && !fs.existsSync(pos.file)) pos = null;
  // First-ever run: don't dump the whole backlog, start at the current end.
  if (!pos) {
    const newest = newestLog();
    if (newest) {
      try { pos = { file: newest, offset: fs.statSync(newest).size }; savePos(); }
      catch { pos = null; }
    }
  }

  client.channels.fetch(CHANNEL_ID)
    .then(ch => {
      if (ch && ch.isTextBased() && "send" in ch) {
        channel = ch as SendableChannels;
        console.log(`[archipelago] relaying ${LOG_DIR} -> #${"name" in ch ? ch.name : CHANNEL_ID}`);
        setInterval(() => { tick().catch(e => console.error("[archipelago] tick error:", e)); }, POLL_MS);
      } else {
        console.error("[archipelago] channel not text-based or not found:", CHANNEL_ID);
      }
    })
    .catch(e => console.error("[archipelago] failed to fetch channel:", e));
}
