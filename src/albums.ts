import { Client, Interaction, TextChannel } from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
type BusboyFile = { filename: string; encoding: string; mimeType: string };
type BusboyInstance = { on(e: "file", cb: (f: string, s: NodeJS.ReadableStream, i: BusboyFile) => void): BusboyInstance; on(e: "error", cb: (err: Error) => void): BusboyInstance; };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Busboy = require("busboy") as (opts: { headers: Record<string, string | string[] | undefined>; limits?: { files?: number; fileSize?: number } }) => BusboyInstance;
import { eventStates, DATA_DIR, persistState } from "./state";
import { config } from "./config";
import { handleAuthRoutes, isValidSession, getSessionUser } from "./auth";
import { initDb, dbHasAlbum, dbInsertAlbum, dbDeleteAlbum, dbUpdateAlbum, dbAddPhoto, dbAddUploadedPhoto, dbGetAlbumWithPhotos, dbGetAllAlbumsWithPhotos, dbCreateAlbum, dbUpsertUser, dbAddAlbumMember } from "./db";
import type { Guild } from "discord.js";

type UpdateEventMessagesFn = (guild: Guild, channelId: string) => Promise<void>;
let updateEventMessagesFn: UpdateEventMessagesFn | null = null;
export function setUpdateEventMessages(fn: UpdateEventMessagesFn) { updateEventMessagesFn = fn; }

const PHOTO_STORAGE_PATH = process.env.PHOTO_STORAGE_PATH ?? path.join(DATA_DIR, "photos");

let albumDiscordClient: Client | null = null;
export function setAlbumDiscordClient(client: Client) { albumDiscordClient = client; }

export function loadAlbums() {
  initDb();
}

export function hasAlbum(channelId: string): boolean {
  return dbHasAlbum(channelId);
}

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

export function getAlbumUrl(channelId: string): string | null {
  if (!dbHasAlbum(channelId)) return null;
  return `${getBaseUrl()}/album/${channelId}`;
}

// Returns channelId if event messages need refreshing, null otherwise
export async function handleAlbumInteractions(interaction: Interaction): Promise<string | null> {
  if (!interaction.isButton()) return null;

  if (interaction.customId.startsWith("album_start_")) {
    const channelId = interaction.customId.slice("album_start_".length);
    const eventState = eventStates.get(channelId);
    const albumName = eventState?.eventName ?? channelId;
    const dateText = eventState?.dateText;
    const albumUrl = `${getBaseUrl()}/album/${channelId}`;
    dbInsertAlbum({ channelId, groupName: albumName, dateText, location: eventState?.location, createdAt: new Date().toISOString() });
    if (interaction.guild) {
      try {
        await interaction.guild.members.fetch();
        const ch = interaction.guild.channels.cache.get(channelId);
        if (ch && "members" in ch) {
          for (const [, member] of (ch as TextChannel).members) {
            if (!member.user.bot) {
              dbUpsertUser(member.id, member.displayName, member.user.avatarURL() ?? undefined);
              dbAddAlbumMember(channelId, member.id);
            }
          }
        }
      } catch (e) { console.error("Failed to fetch channel members on album start:", e); }
    }
    await interaction.update({ content: `Photo album started! ${albumUrl}`, components: [] });
    const channel = interaction.guild?.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send(`📸 Photo album started for **${albumName}**! ${albumUrl}`);
    }
    return channelId;
  }

  if (interaction.customId.startsWith("album_delete_")) {
    const channelId = interaction.customId.slice("album_delete_".length);
    dbDeleteAlbum(channelId);
    await interaction.update({ content: "Photo album deleted.", components: [] });
    return channelId;
  }

  return null;
}


const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

export function startWebServer(): void {
  if (!config.albumsEnabled) return;
  const port = parseInt(process.env.ALBUM_PORT ?? "3000");
  const webDist = path.join(__dirname, "..", "web", "dist");

  http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";

    if (handleAuthRoutes(req, res)) return;

    if (url === "/api/albums" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dbGetAllAlbumsWithPhotos()));
      return;
    }

    if (url === "/api/albums" && method === "POST") {
      const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
      if (!isValidSession(token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" })); return;
      }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { name, location, startDate, endDate } = JSON.parse(body);
          if (!name || !location || !startDate) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "name, location, and startDate are required" })); return;
          }
          const album = dbCreateAlbum(name, location, startDate, endDate || undefined);
          const creator = getSessionUser(token);
          if (creator) dbUpsertUser(creator.userId, creator.displayName, creator.avatarUrl);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...album, photos: [] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to create album" }));
        }
      });
      return;
    }
    // PUT /api/album/:id — update album metadata
    if (url.match(/^\/api\/album\/[^/]+$/) && method === "PUT") {
      const channelId = url.slice("/api/album/".length);
      const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
      if (!isValidSession(token)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }
      if (!dbHasAlbum(channelId)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const { name, location, startDate, endDate } = JSON.parse(body);
          const updated = dbUpdateAlbum(channelId, name, location, startDate || undefined, endDate || undefined);
          // Sync to Discord if this is a real event channel
          if (!channelId.startsWith("web_") && albumDiscordClient) {
            const state = eventStates.get(channelId);
            if (state) {
              state.eventName = name;
              state.location = location;
              if (updated?.dateText) state.dateText = updated.dateText;
              persistState();
              const guild = albumDiscordClient.guilds.cache.get(process.env.GUILD_ID ?? "");
              if (guild && updateEventMessagesFn) updateEventMessagesFn(guild, channelId).catch(e => console.error("Failed to sync album edit to Discord:", e));
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Update failed" }));
        }
      });
      return;
    }

    // POST /api/album/:id/photos — upload a photo file
    if (url.match(/^\/api\/album\/[^/]+\/photos$/) && method === "POST") {
      const channelId = url.split("/")[3];
      const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
      const uploader = getSessionUser(token);
      if (!uploader) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }
      if (!dbHasAlbum(channelId)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Album not found" })); return; }
      const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
      fs.mkdirSync(albumDir, { recursive: true });
      const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 50 * 1024 * 1024 } });
      let responded = false;
      bb.on("file", (_field, fileStream, { filename, mimeType }) => {
        if (!mimeType.startsWith("image/")) {
          fileStream.resume();
          if (!responded) { responded = true; res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Only images allowed" })); }
          return;
        }
        const ext = path.extname(filename) || ".jpg";
        const name = crypto.randomBytes(16).toString("hex") + ext;
        const filePath = path.join(albumDir, name);
        const writeStream = fs.createWriteStream(filePath);
        fileStream.pipe(writeStream);
        writeStream.on("finish", () => {
          if (responded) return;
          responded = true;
          const photoUrl = `/uploads/${channelId}/${name}`;
          const photo = dbAddUploadedPhoto(channelId, photoUrl, name, uploader.userId, uploader.displayName);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(photo));
        });
        writeStream.on("error", () => {
          if (!responded) { responded = true; res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Write failed" })); }
        });
      });
      bb.on("error", () => {
        if (!responded) { responded = true; res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Upload failed" })); }
      });
      req.pipe(bb as unknown as NodeJS.WritableStream);
      return;
    }

    // GET /api/album/:id
    if (url.match(/^\/api\/album\/[^/]+$/) && method === "GET") {
      const channelId = url.slice("/api/album/".length);
      const album = dbGetAlbumWithPhotos(channelId);
      res.writeHead(album ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(album ?? { error: "Not found" }));
      return;
    }

    // GET /uploads/:channelId/:filename — serve uploaded photo files
    if (url.startsWith("/uploads/")) {
      const parts = url.slice("/uploads/".length).split("/");
      if (parts.length < 2 || parts[0].includes("..") || parts[1].includes("..")) {
        res.writeHead(400); res.end("Bad request"); return;
      }
      const [channelId, filename] = parts;
      const filePath = path.join(PHOTO_STORAGE_PATH, channelId, filename);
      if (!filePath.startsWith(PHOTO_STORAGE_PATH) || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end("Not found"); return;
      }
      const ext = path.extname(filename).toLowerCase();
      const imgMime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic" };
      res.writeHead(200, { "Content-Type": imgMime[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Static files — assets have hashed names; everything else serves index.html for Vue Router
    const resolvedAsset = url.startsWith("/assets/") ? path.join(webDist, url) : path.join(webDist, "index.html");
    if (!resolvedAsset.startsWith(webDist) || !fs.existsSync(resolvedAsset)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const mime = MIME[path.extname(resolvedAsset)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(fs.readFileSync(resolvedAsset));
  }).listen(port, () => console.log(`Photo album web server running on port ${port}`));
}
