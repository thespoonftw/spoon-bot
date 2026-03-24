import { Client, Interaction, TextChannel, MessageReaction, User, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: string) => { resize(w: number, h: number, opts?: object): { toFile(p: string): Promise<void> }; metadata(): Promise<{ width?: number; height?: number }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const exifr = require("exifr") as { parse(file: string, opts: unknown): Promise<Record<string, unknown> | null> };
type BusboyFile = { filename: string; encoding: string; mimeType: string };
type BusboyInstance = { on(e: "file", cb: (f: string, s: NodeJS.ReadableStream, i: BusboyFile) => void): BusboyInstance; on(e: "field", cb: (name: string, val: string) => void): BusboyInstance; on(e: "error", cb: (err: Error) => void): BusboyInstance; };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Busboy = require("busboy") as (opts: { headers: Record<string, string | string[] | undefined>; limits?: { files?: number; fileSize?: number } }) => BusboyInstance;
import { eventStates, DATA_DIR, persistState } from "./state";
import { config } from "./config";
import { handleAuthRoutes, isValidSession, getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { initDb, dbHasAlbum, dbInsertAlbum, dbDeleteAlbum, dbUpdateAlbum, dbAddPhoto, dbAddUploadedPhoto, dbGetAlbumWithPhotos, dbGetAllAlbumsWithPhotos, dbCreateAlbum, dbUpsertUser, dbAddAlbumMember, dbRemoveAlbumMember, dbHideAlbumMember, dbUnhideAlbumMember, dbGetAllAlbumMembers, dbGetAllUsers, dbCreateGuestUser, dbDeleteUser, dbDeletePhoto, dbCreateAlbumShare, dbGetAlbumShare, dbGetPhotoCount, dbGetAlbumCount, dbVotePhoto, dbSetPhotoFeatured, dbGetPhotoVotes } from "./db";
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
export async function startAlbumForChannel(channelId: string, guild: Guild, albumNameOverride?: string): Promise<string> {
  const eventState = eventStates.get(channelId);
  const albumName = albumNameOverride ?? eventState?.eventName ?? channelId;
  const dateText = eventState?.dateText;
  const albumUrl = `${getBaseUrl()}/album/${channelId}`;
  dbInsertAlbum({ channelId, groupName: albumName, dateText, location: eventState?.location, createdAt: new Date().toISOString() });
  try {
    await guild.members.fetch();
    const ch = guild.channels.cache.get(channelId);
    if (ch && "members" in ch) {
      for (const [, member] of (ch as TextChannel).members) {
        if (!member.user.bot) {
          dbUpsertUser(member.id, member.displayName, member.user.avatarURL() ?? undefined);
          dbAddAlbumMember(channelId, member.id);
        }
      }
    }
  } catch (e) { console.error("Failed to fetch channel members on album start:", e); }
  return albumUrl;
}

export async function handleAlbumInteractions(interaction: Interaction): Promise<string | null> {
  if (!interaction.isButton()) return null;

  if (interaction.customId.startsWith("album_start_")) {
    const channelId = interaction.customId.slice("album_start_".length);
    if (!interaction.guild) return null;
    const albumUrl = await startAlbumForChannel(channelId, interaction.guild);
    const eventState = eventStates.get(channelId);
    const albumName = eventState?.eventName ?? channelId;
    await interaction.update({ content: `Photo album started! ${albumUrl}`, components: [] });
    const channel = interaction.guild.channels.cache.get(channelId);
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


const ALBUM_REACTION_EMOJIS = ["📷", "📸"];

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { file.close(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); reject(err); });
  });
}

export async function handleAlbumReaction(reaction: MessageReaction, user: User): Promise<void> {
  if (!ALBUM_REACTION_EMOJIS.includes(reaction.emoji.name ?? "")) return;
  const channelId = reaction.message.channelId;
  if (!dbHasAlbum(channelId)) return;

  // Fetch full message if partial
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const imageAttachments = [...message.attachments.values()].filter(a => a.contentType?.startsWith("image/"));
  if (imageAttachments.length === 0) return;

  // Attribute to the message author, not the reactor
  const author = message.author;
  if (!author) return;
  const authorMember = reaction.message.guild?.members.cache.get(author.id);
  const displayName = authorMember?.displayName ?? author.displayName ?? author.username;
  dbUpsertUser(author.id, displayName, author.avatarURL() ?? undefined);

  const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
  fs.mkdirSync(albumDir, { recursive: true });
  const thumbDir = path.join(albumDir, "thumbs");
  fs.mkdirSync(thumbDir, { recursive: true });

  let anySuccess = false;
  for (const attachment of imageAttachments) {
    try {
      const ext = path.extname(attachment.name || ".jpg") || ".jpg";
      const name = crypto.createHash("md5").update(attachment.url).digest("hex") + ext;
      const filePath = path.join(albumDir, name);
      if (fs.existsSync(filePath)) { console.log(`Skipping duplicate attachment: ${name}`); continue; }
      await downloadFile(attachment.url, filePath);

      let width = 0, height = 0;
      try { const meta = await sharp(filePath).metadata(); width = meta.width ?? 0; height = meta.height ?? 0; } catch {}

      let takenAt: string | undefined;
      try {
        const exif = await exifr.parse(filePath, { exif: true });
        const raw = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
        if (raw instanceof Date && !isNaN(raw.getTime())) {
          takenAt = raw.toISOString();
        } else if (typeof raw === "string") {
          const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
          const d = new Date(normalized);
          if (!isNaN(d.getTime())) takenAt = d.toISOString();
        }
      } catch {}

      try { await sharp(filePath).resize(512, 512, { fit: "inside", withoutEnlargement: true }).toFile(path.join(thumbDir, name)); } catch {}

      const photoUrl = `/uploads/${channelId}/${name}`;
      dbAddUploadedPhoto(channelId, photoUrl, name, author.id, displayName, width, height, takenAt);
      anySuccess = true;
    } catch (e) { console.error("Failed to download/process reaction attachment:", e); }
  }

  if (anySuccess) {
    try { await message.react(reaction.emoji.name!); } catch {}
  }
}

interface PendingUpload {
  channelId: string;
  attachments: { url: string; name: string }[];
  authorId: string;
  authorName: string;
  avatarUrl?: string;
  originalMessage: Message;
}
const pendingUploads = new Map<string, PendingUpload>();

export async function handleAlbumMessageCreate(message: Message): Promise<void> {
  if (!dbHasAlbum(message.channelId)) return;
  const imageAttachments = [...message.attachments.values()].filter(a => a.contentType?.startsWith("image/"));
  if (imageAttachments.length === 0) return;

  const pendingId = message.id;
  const label = imageAttachments.length === 1 ? "1 image" : `${imageAttachments.length} images`;
  const member = message.guild?.members.cache.get(message.author.id);
  const displayName = member?.displayName ?? message.author.displayName ?? message.author.username;

  pendingUploads.set(pendingId, {
    channelId: message.channelId,
    attachments: imageAttachments.map(a => ({ url: a.url, name: a.name || "photo.jpg" })),
    authorId: message.author.id,
    authorName: displayName,
    avatarUrl: message.author.avatarURL() ?? undefined,
    originalMessage: message,
  });
  setTimeout(() => pendingUploads.delete(pendingId), 10 * 60 * 1000);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`album_upload_${pendingId}`).setLabel("Upload").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`album_ignore_${pendingId}`).setLabel("Ignore").setStyle(ButtonStyle.Secondary),
  );
  await message.reply({ content: `Upload ${label} to the album?`, components: [row] });
}

async function processUpload(pending: PendingUpload): Promise<number> {
  const { channelId, attachments, authorId, authorName, avatarUrl } = pending;
  dbUpsertUser(authorId, authorName, avatarUrl);
  const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
  fs.mkdirSync(albumDir, { recursive: true });
  const thumbDir = path.join(albumDir, "thumbs");
  fs.mkdirSync(thumbDir, { recursive: true });

  let count = 0;
  for (const { url, name: attachName } of attachments) {
    try {
      const ext = path.extname(attachName || ".jpg") || ".jpg";
      const name = crypto.createHash("md5").update(url).digest("hex") + ext;
      const filePath = path.join(albumDir, name);
      if (fs.existsSync(filePath)) { count++; continue; }
      await downloadFile(url, filePath);
      let width = 0, height = 0;
      try { const meta = await sharp(filePath).metadata(); width = meta.width ?? 0; height = meta.height ?? 0; } catch {}
      let takenAt: string | undefined;
      try {
        const exif = await exifr.parse(filePath, { exif: true });
        const raw = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
        if (raw instanceof Date && !isNaN(raw.getTime())) takenAt = raw.toISOString();
        else if (typeof raw === "string") {
          const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
          const d = new Date(normalized); if (!isNaN(d.getTime())) takenAt = d.toISOString();
        }
      } catch {}
      try { await sharp(filePath).resize(512, 512, { fit: "inside", withoutEnlargement: true }).toFile(path.join(thumbDir, name)); } catch {}
      dbAddUploadedPhoto(channelId, `/uploads/${channelId}/${name}`, name, authorId, authorName, width, height, takenAt);
      count++;
    } catch (e) { console.error("Failed to upload photo:", e); }
  }
  return count;
}

export async function handleAlbumUploadInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;

  if (customId.startsWith("album_ignore_")) {
    pendingUploads.delete(customId.slice("album_ignore_".length));
    await interaction.message.delete().catch(() => {});
    await interaction.deferUpdate().catch(() => {});
    return true;
  }

  if (customId.startsWith("album_upload_")) {
    const pendingId = customId.slice("album_upload_".length);
    const pending = pendingUploads.get(pendingId);
    pendingUploads.delete(pendingId);
    if (!pending) {
      await interaction.update({ content: "This prompt has expired.", components: [] });
      setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
      return true;
    }
    await interaction.deferUpdate().catch(() => {});
    await processUpload(pending);
    await interaction.message.delete().catch(() => {});
    await pending.originalMessage.react("📸").catch(() => {});
    return true;
  }

  return false;
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

    if (url === "/api/status" && method === "GET") {
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      try {
        const statPath = fs.existsSync(PHOTO_STORAGE_PATH) ? PHOTO_STORAGE_PATH : DATA_DIR;
        const stats = fs.statfsSync(statPath);
        const total = stats.blocks * stats.bsize;
        const available = stats.bavail * stats.bsize;
        const used = total - available;
        sendJson(res, 200, { total, used, available, photoCount: dbGetPhotoCount(), albumCount: dbGetAlbumCount() });
      } catch (e) {
        sendJson(res, 500, { error: "Failed" });
      }
      return;
    }

    if (url === "/api/albums" && method === "GET") {
      const albums = dbGetAllAlbumsWithPhotos().map(a => {
        const state = eventStates.get(a.channelId);
        const members = a.members.filter(m => (state?.members.get(m.userId)?.status ?? null) !== "decline");
        return { ...a, members };
      });
      sendJson(res, 200, albums);
      return;
    }

    if (url === "/api/albums" && method === "POST") {
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { name, location, startDate, endDate } = JSON.parse(body);
          if (!name || !location || !startDate) {
            sendJson(res, 400, { error: "name, location, and startDate are required" }); return;
          }
          const album = dbCreateAlbum(name, location, startDate, endDate || undefined);
          const creator = getSessionUser(token);
          if (creator) dbUpsertUser(creator.userId, creator.displayName, creator.avatarUrl);
          sendJson(res, 201, { ...album, photos: [] });
        } catch (e) {
          sendJson(res, 500, { error: "Failed to create album" });
        }
      });
      return;
    }
    // PUT /api/album/:id — update album metadata
    if (url.match(/^\/api\/album\/[^/]+$/) && method === "PUT") {
      const channelId = url.slice("/api/album/".length);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      if (!dbHasAlbum(channelId)) { sendJson(res, 404, { error: "Not found" }); return; }
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
          sendJson(res, 200, updated);
        } catch (e) {
          sendJson(res, 500, { error: "Update failed" });
        }
      });
      return;
    }

    // POST /api/album/:id/photos — upload a photo file
    if (url.match(/^\/api\/album\/[^/]+\/photos$/) && method === "POST") {
      const channelId = url.split("/")[3];
      const token = getTokenFromRequest(req);
      const uploader = getSessionUser(token);
      if (!uploader) { send401(res); return; }
      if (!dbHasAlbum(channelId)) { sendJson(res, 404, { error: "Album not found" }); return; }
      const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
      fs.mkdirSync(albumDir, { recursive: true });
      const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 50 * 1024 * 1024 } });
      let responded = false;
      bb.on("file", (_field, fileStream, { filename, mimeType }) => {
        if (!mimeType.startsWith("image/")) {
          fileStream.resume();
          if (!responded) { responded = true; sendJson(res, 400, { error: "Only images allowed" }); }
          return;
        }
        const ext = path.extname(filename) || ".jpg";
        const name = crypto.randomBytes(16).toString("hex") + ext;
        const filePath = path.join(albumDir, name);
        const writeStream = fs.createWriteStream(filePath);
        fileStream.pipe(writeStream);
        writeStream.on("finish", async () => {
          if (responded) return;
          responded = true;
          const thumbDir = path.join(PHOTO_STORAGE_PATH, channelId, "thumbs");
          fs.mkdirSync(thumbDir, { recursive: true });
          const thumbPath = path.join(thumbDir, name);
          let width = 0, height = 0;
          try {
            const meta = await sharp(filePath).metadata();
            width = meta.width ?? 0; height = meta.height ?? 0;
          } catch (e) { console.error("Failed to read image dimensions:", e); }
          let takenAt: string | undefined;
          try {
            const exif = await exifr.parse(filePath, { exif: true });
            const raw = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
            if (raw instanceof Date && !isNaN(raw.getTime())) {
              takenAt = raw.toISOString();
            } else if (typeof raw === "string") {
              const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
              const d = new Date(normalized);
              if (!isNaN(d.getTime())) takenAt = d.toISOString();
            }
          } catch (e) { console.error("[upload] EXIF parse failed:", e); }
          try {
            await sharp(filePath).resize(512, 512, { fit: "inside", withoutEnlargement: true }).toFile(thumbPath);
          } catch (e) { console.error("Thumbnail generation failed:", e); }
          const photoUrl = `/uploads/${channelId}/${name}`;
          const photo = dbAddUploadedPhoto(channelId, photoUrl, name, uploader.userId, uploader.displayName, width, height, takenAt);
          sendJson(res, 201, photo);
        });
        writeStream.on("error", () => {
          if (!responded) { responded = true; sendJson(res, 500, { error: "Write failed" }); }
        });
      });
      bb.on("error", () => {
        if (!responded) { responded = true; sendJson(res, 400, { error: "Upload failed" }); }
      });
      req.pipe(bb as unknown as NodeJS.WritableStream);
      return;
    }

    // POST /api/album/:channelId/photos/:photoId/featured — set featured people
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+\/featured$/) && method === "POST") {
      const parts = url.split("/");
      const photoId = parseInt(parts[5]);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { userIds } = JSON.parse(body);
          dbSetPhotoFeatured(photoId, Array.isArray(userIds) ? userIds : []);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // GET /api/album/:channelId/photos/:photoId/votes — get vote breakdown
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+\/votes$/) && method === "GET") {
      const photoId = parseInt(url.split("/")[5]);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      sendJson(res, 200, dbGetPhotoVotes(photoId));
      return;
    }

    // POST /api/album/:channelId/photos/:photoId/vote — upvote/downvote/fav a photo
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+\/vote$/) && method === "POST") {
      const parts = url.split("/");
      const photoId = parseInt(parts[5]);
      const token = getTokenFromRequest(req);
      const sessionUser = token ? getSessionUser(token) : null;
      if (!sessionUser) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { voteType } = JSON.parse(body);
          if (!["up", "down", "fav"].includes(voteType)) {
            sendJson(res, 400, { error: "Invalid vote type" }); return;
          }
          const result = dbVotePhoto(photoId, sessionUser.userId, voteType);
          sendJson(res, 200, result);
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // DELETE /api/album/:id/photos/:photoId — delete a photo
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+$/) && method === "DELETE") {
      const parts = url.split("/");
      const channelId = parts[3];
      const photoId = parseInt(parts[5]);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      const filename = dbDeletePhoto(photoId);
      if (!filename) { sendJson(res, 404, { error: "Not found" }); return; }
      const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
      try { fs.unlinkSync(path.join(albumDir, filename)); } catch {}
      try { fs.unlinkSync(path.join(albumDir, "thumbs", filename)); } catch {}
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/album/:id/members — all members including hidden, with RSVP status (for edit modal)
    if (url.match(/^\/api\/album\/[^/]+\/members$/) && method === "GET") {
      const channelId = url.split("/")[3];
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      const state = eventStates.get(channelId);
      const members = dbGetAllAlbumMembers(channelId).map(m => ({ ...m, rsvpStatus: state?.members.get(m.userId)?.status ?? null }));
      sendJson(res, 200, members);
      return;
    }

    // POST /api/album/:id/members — add existing user or create guest and add
    if (url.match(/^\/api\/album\/[^/]+\/members$/) && method === "POST") {
      const channelId = url.split("/")[3];
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { userId, name } = JSON.parse(body);
          let user;
          if (userId) {
            user = dbGetAllUsers().find(u => u.userId === userId);
            if (!user) { sendJson(res, 404, { error: "User not found" }); return; }
          } else if (name?.trim()) {
            user = dbCreateGuestUser(name.trim());
          } else {
            sendJson(res, 400, { error: "userId or name required" }); return;
          }
          dbAddAlbumMember(channelId, user.userId);
          const state = eventStates.get(channelId);
          sendJson(res, 201, { ...user, hidden: 0, rsvpStatus: state?.members.get(user.userId)?.status ?? null });
        } catch {
          sendJson(res, 500, { error: "Failed" });
        }
      });
      return;
    }

    // DELETE /api/album/:id/members/:userId — hide or remove member
    if (url.match(/^\/api\/album\/[^/]+\/members\/[^/]+$/) && method === "DELETE") {
      const parts = url.split("/");
      const channelId = parts[3];
      const userId = parts[5];
      const remove = (req.url ?? "").includes("?remove=true");
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      if (userId.startsWith("guest_")) {
        dbDeleteUser(userId);
      } else if (remove) {
        dbRemoveAlbumMember(channelId, userId);
      } else {
        dbHideAlbumMember(channelId, userId);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // PATCH /api/album/:id/members/:userId — unhide member
    if (url.match(/^\/api\/album\/[^/]+\/members\/[^/]+$/) && method === "PATCH") {
      const parts = url.split("/");
      const channelId = parts[3];
      const userId = parts[5];
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      dbUnhideAlbumMember(channelId, userId);
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /api/album/:id/share — create a password-protected share link
    if (url.match(/^\/api\/album\/[^/]+\/share$/) && method === "POST") {
      const channelId = url.split("/")[3];
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      if (!dbHasAlbum(channelId)) { sendJson(res, 404, { error: "Not found" }); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { password } = JSON.parse(body);
          if (!password?.trim()) { sendJson(res, 400, { error: "Password required" }); return; }
          const shareToken = crypto.randomBytes(24).toString("base64url");
          const passwordHash = crypto.createHash("sha256").update(shareToken + ":" + password.trim()).digest("hex");
          dbCreateAlbumShare(channelId, shareToken, passwordHash);
          sendJson(res, 201, { url: `${getBaseUrl()}/share/${shareToken}` });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // POST /api/share/:token/unlock — verify password and return album data
    if (url.match(/^\/api\/share\/[^/]+\/unlock$/) && method === "POST") {
      const shareToken = url.split("/")[3];
      const share = dbGetAlbumShare(shareToken);
      if (!share) { sendJson(res, 404, { error: "Not found" }); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { password } = JSON.parse(body);
          const hash = crypto.createHash("sha256").update(shareToken + ":" + (password ?? "")).digest("hex");
          if (hash !== share.passwordHash) { sendJson(res, 401, { error: "Wrong password" }); return; }
          const album = dbGetAlbumWithPhotos(share.channelId);
          if (!album) { sendJson(res, 404, { error: "Album not found" }); return; }
          sendJson(res, 200, { groupName: album.groupName, dateText: album.dateText, location: album.location, photos: album.photos });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // GET /api/album/:id
    if (url.match(/^\/api\/album\/[^/]+$/) && method === "GET") {
      const channelId = url.slice("/api/album/".length);
      const token = getTokenFromRequest(req);
      const sessionUser = token ? getSessionUser(token) : null;
      const album = dbGetAlbumWithPhotos(channelId, sessionUser?.userId);
      if (!album) { sendJson(res, 404, { error: "Not found" }); return; }
      const state = eventStates.get(channelId);
      const members = album.members
        .map(m => ({ ...m, rsvpStatus: state?.members.get(m.userId)?.status ?? null }))
        .filter(m => m.rsvpStatus !== "decline");
      sendJson(res, 200, { ...album, members });
      return;
    }

    // GET /thumbnails/:channelId/:filename — serve thumbnail (falls back to full image if thumb missing)
    if (url.startsWith("/thumbnails/")) {
      const parts = url.slice("/thumbnails/".length).split("/");
      if (parts.length < 2 || parts[0].includes("..") || parts[1].includes("..")) {
        res.writeHead(400); res.end("Bad request"); return;
      }
      const [channelId, filename] = parts;
      const thumbPath = path.join(PHOTO_STORAGE_PATH, channelId, "thumbs", filename);
      const fullPath = path.join(PHOTO_STORAGE_PATH, channelId, filename);
      const servePath = fs.existsSync(thumbPath) ? thumbPath : fullPath;
      if (!servePath.startsWith(PHOTO_STORAGE_PATH) || !fs.existsSync(servePath)) {
        res.writeHead(404); res.end("Not found"); return;
      }
      const ext = path.extname(filename).toLowerCase();
      const imgMime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic" };
      res.writeHead(200, { "Content-Type": imgMime[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
      fs.createReadStream(servePath).pipe(res);
      return;
    }

    // GET /uploads/:channelId/:filename — serve uploaded photo files (auth required)
    if (url.startsWith("/uploads/")) {
      if (!isValidSession(getTokenFromRequest(req))) { res.writeHead(401); res.end("Unauthorized"); return; }
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
      res.writeHead(200, { "Content-Type": imgMime[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
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
