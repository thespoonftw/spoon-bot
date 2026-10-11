import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Interaction } from "discord.js";
import { DATA_DIR } from "./state";
import { config } from "./config";
import { sendJson } from "./auth";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: Buffer | { create: object }) => SharpChain;
type SharpChain = { composite(layers: object[]): SharpChain; extract(region: object): SharpChain; png(): SharpChain; toBuffer(): Promise<Buffer> };

// /location: the bot posts a live location card in the channel and gives the person a private link.
// While that page is open it sends their position here, and every 30 seconds the card is edited to
// match, with a map drawn from OpenStreetMap tiles. Sharing ends when they stop it (on the page or
// with the card's button), when the time they picked runs out, or when the card is deleted.

type Position = { lat: number; lng: number; accuracy: number };
type LocationShare = {
  id: string;     // Public: used in the card's button. Knowing it doesn't let anyone send positions.
  token: string;  // Secret: the private link. Whoever has it can set the position.
  userId: string;
  displayName: string;
  avatarUrl?: string;
  channelId: string;
  channelName: string;
  messageId: string;
  expiresAt: number;
  position?: Position;
  lastSeen?: number; // When the page last sent a position: the card's "Updated" time.
};

const SHARES_FILE = path.join(DATA_DIR, "location-shares.json");
const TICK_MS = 30_000;
const MIN_POST_GAP_MS = 2_000; // The page sends on every GPS fix; ignore anything faster than this.
const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

const shares = new Map<string, LocationShare>(); // by token
const dirty = new Set<string>();                   // tokens whose card is behind
const lastPost = new Map<string, number>();
const maps = new Map<string, { pos: Position; png: Buffer }>(); // last map drawn per token
let discordClient: Client | null = null;

function persistShares() {
  try { fs.writeFileSync(SHARES_FILE, JSON.stringify([...shares.values()], null, 2)); }
  catch (e) { console.error("Failed to persist location shares:", e); }
}

export function startLocationShares(client: Client) {
  discordClient = client;
  try {
    if (fs.existsSync(SHARES_FILE)) {
      for (const s of JSON.parse(fs.readFileSync(SHARES_FILE, "utf-8")) as LocationShare[]) {
        shares.set(s.token, s);
        dirty.add(s.token); // Redraw after a restart (the map image isn't kept).
      }
      if (shares.size > 0) console.log(`Loaded ${shares.size} location share(s) from disk.`);
    }
  } catch (e) { console.error("Failed to load location shares:", e); }
  setInterval(() => { tick().catch(e => console.error("Location tick error:", e)); }, TICK_MS);
}

async function tick() {
  const now = Date.now();
  for (const share of [...shares.values()]) {
    if (now >= share.expiresAt) await endShare(share, "expired");
    else if (dirty.has(share.token)) await updateCard(share);
  }
}

// ── The card ─────────────────────────────────────────────────────────────────

const mapsUrl = (p: Position) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const ts = (ms: number, style: string) => `<t:${Math.floor(ms / 1000)}:${style}>`;

async function buildCard(share: LocationShare, ended?: "stopped" | "expired") {
  const p = share.position;
  const lines: string[] = [];
  if (ended) lines.push(ended === "expired" ? `Sharing ended ${ts(Date.now(), "R")} (time ran out).` : `Sharing stopped ${ts(Date.now(), "R")}.`);
  if (!p) {
    if (!ended) lines.push(`Waiting for ${share.displayName} to open their link…`, `Sharing until ${ts(share.expiresAt, "t")}`);
  } else {
    lines.push(`${ended ? "Last known location" : "Accurate"} to within ~${Math.round(p.accuracy)} m`);
    lines.push(`${ended ? "Last updated" : "Updated"} ${ts(share.lastSeen ?? Date.now(), "R")}`);
    if (!ended) lines.push(`Sharing until ${ts(share.expiresAt, "t")}`);
  }

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x6c7086 : 0xa6e3a1)
    .setAuthor({ name: share.displayName, iconURL: share.avatarUrl })
    .setTitle(ended ? "📍 Location (no longer live)" : "📍 Live location")
    .setDescription(lines.join("\n"));

  const files: AttachmentBuilder[] = [];
  if (p) {
    const png = await mapFor(share.token, p);
    if (png) {
      files.push(new AttachmentBuilder(png, { name: "location.png" }));
      embed.setImage("attachment://location.png").setFooter({ text: "Map © OpenStreetMap contributors" });
    }
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (p) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open in Google Maps").setEmoji("🗺️").setURL(mapsUrl(p)));
  if (!ended) row.addComponents(new ButtonBuilder().setCustomId(`loc_stop_${share.id}`).setStyle(ButtonStyle.Danger).setLabel("Stop sharing"));
  return { embeds: [embed], components: row.components.length ? [row] : [], files, attachments: [] };
}

async function editCard(share: LocationShare, ended?: "stopped" | "expired"): Promise<boolean> {
  const channel = discordClient?.channels.cache.get(share.channelId);
  if (!channel?.isTextBased()) return false;
  try {
    await channel.messages.edit(share.messageId, await buildCard(share, ended));
    return true;
  } catch (e) {
    // The card was deleted: nothing left to update, so the share is over.
    if ((e as { code?: number }).code === 10008) return false;
    console.error(`Failed to update location card ${share.messageId}:`, e);
    return true;
  }
}

async function updateCard(share: LocationShare) {
  dirty.delete(share.token);
  if (!await editCard(share)) forgetShare(share);
}

async function endShare(share: LocationShare, reason: "stopped" | "expired") {
  forgetShare(share);
  await editCard(share, reason);
  maps.delete(share.token);
}

function forgetShare(share: LocationShare) {
  shares.delete(share.token);
  dirty.delete(share.token);
  lastPost.delete(share.token);
  persistShares();
}

// ── The map ──────────────────────────────────────────────────────────────────

const TILE = 256, MAP_W = 600, MAP_H = 340;
const tileCache = new Map<string, Buffer>();

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  // OpenStreetMap's tile policy asks for a User-Agent that identifies the app.
  const res = await fetch(`https://tile.openstreetmap.org/${key}.png`, {
    headers: { "User-Agent": `spoon-bot/1.0 (+${getBaseUrl()})` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Tile ${key}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (tileCache.size >= 300) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, buf);
  return buf;
}

function distanceMetres(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos((a.lat + b.lat) / 2 * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

// Reuses the last map unless they've moved or the accuracy has changed noticeably.
async function mapFor(token: string, p: Position): Promise<Buffer | null> {
  const prev = maps.get(token);
  if (prev && distanceMetres(prev.pos, p) < 5 && Math.abs(prev.pos.accuracy - p.accuracy) < Math.max(10, prev.pos.accuracy * 0.25)) return prev.png;
  try {
    const png = await renderMap(p);
    maps.set(token, { pos: p, png });
    return png;
  } catch (e) {
    console.error("Failed to draw location map:", e);
    return prev?.png ?? null;
  }
}

async function renderMap({ lat, lng, accuracy }: Position): Promise<Buffer> {
  // Zoom out far enough that the accuracy circle fits, but no further than town level.
  const equatorMpp = 156543.03392 * Math.cos(lat * Math.PI / 180);
  const zoom = Math.max(11, Math.min(16, Math.floor(Math.log2(equatorMpp * MAP_H * 0.35 / Math.max(accuracy, 1)))));
  const n = 2 ** zoom;
  const s = Math.sin(lat * Math.PI / 180);
  const px = (lng + 180) / 360 * n * TILE;
  const py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE;
  const left = Math.round(px - MAP_W / 2), top = Math.round(py - MAP_H / 2);
  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + MAP_W - 1) / TILE), ty1 = Math.floor((top + MAP_H - 1) / TILE);

  const layers: Promise<object>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (ty < 0 || ty >= n) continue;
      layers.push(fetchTile(zoom, ((tx % n) + n) % n, ty).then(input => ({ input, left: (tx - tx0) * TILE, top: (ty - ty0) * TILE })));
    }
  }
  const grid = await sharp({ create: { width: (tx1 - tx0 + 1) * TILE, height: (ty1 - ty0 + 1) * TILE, channels: 4, background: "#e5e3df" } })
    .composite(await Promise.all(layers)).png().toBuffer();

  const cx = px - left, cy = py - top;
  const r = Math.min(accuracy / (equatorMpp / n), MAP_W);
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e66f5" fill-opacity="0.15" stroke="#1e66f5" stroke-opacity="0.5" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="9" fill="#1e66f5" stroke="#fff" stroke-width="3"/>
  </svg>`;
  return sharp(grid)
    .extract({ left: left - tx0 * TILE, top: top - ty0 * TILE, width: MAP_W, height: MAP_H })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png().toBuffer();
}

// ── Discord ──────────────────────────────────────────────────────────────────

export async function handleLocationInteractions(interaction: Interaction) {
  if (!config.albumsEnabled) return; // The page lives on the album web server.

  if (interaction.isChatInputCommand() && interaction.commandName === "location") {
    const channel = interaction.channel;
    if (!channel?.isSendable() || !("name" in channel)) {
      await interaction.reply({ content: "I can't post in this channel.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    // One share per person: starting a new one ends the old.
    for (const s of [...shares.values()]) if (s.userId === interaction.user.id) await endShare(s, "stopped");

    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    const minutes = interaction.options.getInteger("duration") ?? 60;
    const share: LocationShare = {
      id: crypto.randomBytes(8).toString("hex"),
      token: crypto.randomBytes(24).toString("base64url"),
      userId: interaction.user.id,
      displayName: member?.displayName ?? interaction.user.displayName,
      avatarUrl: (member ?? interaction.user).displayAvatarURL({ extension: "png", size: 128 }),
      channelId: channel.id,
      channelName: channel.name ?? "",
      messageId: "",
      expiresAt: Date.now() + minutes * 60_000,
    };
    try {
      share.messageId = (await channel.send(await buildCard(share))).id;
    } catch (e) {
      console.error("Failed to post location card:", e);
      await interaction.editReply("I couldn't post in this channel.");
      return;
    }
    shares.set(share.token, share);
    persistShares();

    await interaction.editReply({
      content: [
        `Tap below to share your location in <#${channel.id}> until ${ts(share.expiresAt, "t")}.`,
        "Keep the page open: your location only updates while it is. This link is just for you.",
      ].join("\n"),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Share my location").setEmoji("📍").setURL(`${getBaseUrl()}/location/${share.token}`),
      )],
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("loc_stop_")) {
    const id = interaction.customId.slice("loc_stop_".length);
    const share = [...shares.values()].find(s => s.id === id);
    if (!share) { await interaction.reply({ content: "That share has already ended.", ephemeral: true }); return; }
    if (share.userId !== interaction.user.id) {
      await interaction.reply({ content: `Only ${share.displayName} can stop sharing their location.`, ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    await endShare(share, "stopped");
  }
}

// ── Web ──────────────────────────────────────────────────────────────────────

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// The private link's page (web/src/views/LocationShareView.vue) talks to these. No login: the token
// is the key, and an unknown or finished token is a 404.
export function handleLocationRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const match = url.match(/^\/api\/location\/([A-Za-z0-9_-]+)(\/stop)?$/);
  if (!match) return false;
  const method = req.method ?? "GET";
  const share = shares.get(match[1]);
  if (!share) { sendJson(res, 404, { error: "This link has ended." }); return true; }
  const info = () => ({ name: share.displayName, channelName: share.channelName, expiresAt: share.expiresAt });

  // GET /api/location/:token — who's sharing, where to, and until when
  if (!match[2] && method === "GET") { sendJson(res, 200, info()); return true; }

  // POST /api/location/:token — the latest position { lat, lng, accuracy }
  if (!match[2] && method === "POST") {
    readJson(req).then(body => {
      const lat = Number(body.lat), lng = Number(body.lng), accuracy = Number(body.accuracy);
      if (!(Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && accuracy >= 0)) { sendJson(res, 400, { error: "Bad position" }); return; }
      const now = Date.now();
      if (now - (lastPost.get(share.token) ?? 0) >= MIN_POST_GAP_MS) {
        lastPost.set(share.token, now);
        const first = !share.position;
        share.position = { lat, lng, accuracy: Math.min(accuracy, 50_000) };
        share.lastSeen = now;
        dirty.add(share.token);
        persistShares();
        // The first fix goes up straight away rather than waiting for the next tick.
        if (first) updateCard(share).catch(e => console.error("Location card error:", e));
      }
      sendJson(res, 200, info());
    }).catch(() => sendJson(res, 400, { error: "Bad request" }));
    return true;
  }

  // POST /api/location/:token/stop
  if (match[2] && method === "POST") {
    endShare(share, "stopped").catch(e => console.error("Location stop error:", e));
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}
