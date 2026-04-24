import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: string) => { rotate(): { toFile(p: string): Promise<void> }; resize(w: number, h: number, opts?: object): { toFile(p: string): Promise<void> }; metadata(): Promise<{ width?: number; height?: number }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const exifr = require("exifr") as { parse(file: string, opts: unknown): Promise<Record<string, unknown> | null> };
type BusboyFile = { filename: string; encoding: string; mimeType: string };
type BusboyInstance = { on(e: "file", cb: (f: string, s: NodeJS.ReadableStream, i: BusboyFile) => void): BusboyInstance; on(e: "field", cb: (name: string, val: string) => void): BusboyInstance; on(e: "error", cb: (err: Error) => void): BusboyInstance; };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Busboy = require("busboy") as (opts: { headers: Record<string, string | string[] | undefined>; limits?: { files?: number; fileSize?: number } }) => BusboyInstance;
import type { Client, Guild } from "discord.js";
import { eventStates, DATA_DIR, persistState } from "./state";
import { config } from "./config";
import { handleAuthRoutes, isValidSession, getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbHasAlbum, dbUpdateAlbum, dbAddUploadedPhoto, dbGetAlbumWithPhotos, dbGetAllAlbumsWithPhotos, dbCreateAlbum, dbUpsertUser, dbAddAlbumMember, dbRemoveAlbumMember, dbHideAlbumMember, dbUnhideAlbumMember, dbGetAllAlbumMembers, dbGetAllUsers, dbCreateGuestUser, dbDeleteUser, dbDeletePhoto, dbCreateAlbumShare, dbGetAlbumShare, dbGetPhotoCount, dbGetAlbumCount, dbVotePhoto, dbSetPhotoTagged, dbGetPhotoVotes, dbGetAlbumVotes, dbSetPhotoCaption, dbListTables, dbTablePage, dbSearchPhotos, dbGetAlbumLocations, dbAddAlbumLocation, dbDeleteAlbumLocation, dbReorderAlbumLocations, dbSetLocationCoords, dbRenameAlbumLocation, dbSetPhotoLocation, dbSetPhotoTakenAt } from "./db";

const PHOTO_STORAGE_PATH = process.env.PHOTO_STORAGE_PATH ?? path.join(DATA_DIR, "photos");
const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

type UpdateEventMessagesFn = (guild: Guild, channelId: string) => Promise<void>;
let updateEventMessagesFn: UpdateEventMessagesFn | null = null;
export function setUpdateEventMessages(fn: UpdateEventMessagesFn) { updateEventMessagesFn = fn; }

let albumDiscordClient: Client | null = null;
export function setAlbumDiscordClient(client: Client) { albumDiscordClient = client; }

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

    if (url === "/api/db/tables" && method === "GET") {
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      sendJson(res, 200, { tables: dbListTables() });
      return;
    }

    const dbTableMatch = url.match(/^\/api\/db\/table\/([^/?]+)(\?.*)?$/);
    if (dbTableMatch && method === "GET") {
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      const table = decodeURIComponent(dbTableMatch[1]);
      const rawUrl = req.url ?? "";
      const params = new URLSearchParams(rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "");
      const page = Math.max(0, parseInt(params.get("page") ?? "0") || 0);
      const pageSize = 50;
      try {
        sendJson(res, 200, { ...dbTablePage(table, page, pageSize), page, pageSize });
      } catch { sendJson(res, 400, { error: "Unknown table" }); }
      return;
    }

    if (url.startsWith("/api/photos/search") && method === "GET") {
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      const sessionUser = getSessionUser(token!);
      const params = new URLSearchParams(req.url?.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
      const uploadedById = params.get("uploadedById") || undefined;
      const taggedUserId = params.get("taggedUserId") || undefined;
      const sort = (params.get("sort") ?? "top") as "newest" | "oldest" | "top" | "newest_taken" | "oldest_taken";
      const page = Math.max(0, parseInt(params.get("page") ?? "0") || 0);
      const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "40") || 40));
      sendJson(res, 200, dbSearchPhotos({ uploadedById, taggedUserId, sort, page, pageSize, userId: sessionUser?.userId }));
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
          const { name, location, startDate, endDate, groupId } = JSON.parse(body);
          if (!name || !startDate) {
            sendJson(res, 400, { error: "name and startDate are required" }); return;
          }
          const album = dbCreateAlbum(name, startDate, endDate || undefined, groupId ?? null);
          if (location?.trim()) dbAddAlbumLocation(album.channelId, location.trim());
          const creator = getSessionUser(token);
          if (creator) {
            dbUpsertUser(creator.userId, creator.displayName, creator.avatarUrl);
            dbAddAlbumMember(album.channelId, creator.userId);
          }
          sendJson(res, 201, { ...album, photos: [], members: creator ? [{ userId: creator.userId, displayName: creator.displayName, avatarUrl: creator.avatarUrl }] : [] });
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
          const { name, startDate, endDate, groupId } = JSON.parse(body);
          if (!name?.trim()) { sendJson(res, 400, { error: "name is required" }); return; }
          const updated = dbUpdateAlbum(channelId, name, startDate || undefined, endDate || undefined, groupId ?? null);
          // Sync to Discord if this is a real event channel
          if (!channelId.startsWith("web_") && albumDiscordClient) {
            const state = eventStates.get(channelId);
            if (state) {
              state.eventName = name;
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

    // GET /api/album/:id/locations
    if (url.match(/^\/api\/album\/[^/]+\/locations$/) && method === "GET") {
      const channelId = url.split("/")[3];
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      sendJson(res, 200, dbGetAlbumLocations(channelId));
      return;
    }

    // POST /api/album/:id/locations
    if (url.match(/^\/api\/album\/[^/]+\/locations$/) && method === "POST") {
      const channelId = url.split("/")[3];
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      if (!dbHasAlbum(channelId)) { sendJson(res, 404, { error: "Not found" }); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { name } = JSON.parse(body);
          if (!name?.trim()) { sendJson(res, 400, { error: "name is required" }); return; }
          const loc = dbAddAlbumLocation(channelId, name.trim());
          if (!loc) { sendJson(res, 409, { error: "Location already exists" }); return; }
          sendJson(res, 201, loc);
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // DELETE /api/album/:id/locations/:locId
    if (url.match(/^\/api\/album\/[^/]+\/locations\/\d+$/) && method === "DELETE") {
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      const locId = parseInt(url.split("/")[5]);
      dbDeleteAlbumLocation(locId);
      sendJson(res, 200, { ok: true });
      return;
    }

    // PUT /api/album-location/:id/coords — save geocoded coords
    if (url.match(/^\/api\/album-location\/\d+\/coords$/) && method === "PUT") {
      const locId = parseInt(url.split("/")[3]);
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { lat, lon } = JSON.parse(body);
          dbSetLocationCoords(locId, lat, lon);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 400, { error: "Invalid body" }); }
      });
      return;
    }

    // PUT /api/album-location/:id/name — rename location
    if (url.match(/^\/api\/album-location\/\d+\/name$/) && method === "PUT") {
      const locId = parseInt(url.split("/")[3]);
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { name } = JSON.parse(body);
          if (!name?.trim()) { sendJson(res, 400, { error: "Name required" }); return; }
          dbRenameAlbumLocation(locId, name);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 400, { error: "Invalid body" }); }
      });
      return;
    }

    // PUT /api/album/:id/locations/order — reorder locations
    if (url.match(/^\/api\/album\/[^/]+\/locations\/order$/) && method === "PUT") {
      const channelId = url.split("/")[3];
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { ids } = JSON.parse(body);
          dbReorderAlbumLocations(channelId, ids);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 400, { error: "Invalid body" }); }
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
          try {
            const tmpPath = filePath + ".tmp";
            await sharp(filePath).rotate().toFile(tmpPath);
            fs.renameSync(tmpPath, filePath);
          } catch (e) { console.error("Auto-rotate failed:", e); }
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
            console.log("[upload] EXIF debug:", filename, JSON.stringify(exif));
          } catch (e) { console.error("[upload] EXIF parse failed:", e); }
          if (!takenAt) {
            const mFull = filename.match(/(20\d{6})[_-](\d{6})/);
            const mDate = !mFull && filename.match(/(?<![0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?![0-9])/);
            if (mFull) {
              const ds = `${mFull[1].slice(0,4)}-${mFull[1].slice(4,6)}-${mFull[1].slice(6,8)}T${mFull[2].slice(0,2)}:${mFull[2].slice(2,4)}:${mFull[2].slice(4,6)}`;
              const d = new Date(ds);
              if (!isNaN(d.getTime())) takenAt = d.toISOString();
            } else if (mDate) {
              const ds = `${mDate[1]}-${mDate[2]}-${mDate[3]}T12:00:00`;
              const d = new Date(ds);
              if (!isNaN(d.getTime())) takenAt = d.toISOString();
            }
          }
          try {
            await sharp(filePath).resize(256, 256, { fit: "outside", withoutEnlargement: true }).toFile(thumbPath);
          } catch (e) { console.error("Thumbnail generation failed:", e); }
          const photoUrl = `/uploads/${channelId}/${name}`;
          const photo = dbAddUploadedPhoto(channelId, photoUrl, name, uploader.userId, width, height, takenAt, undefined, undefined, filename);
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

    // POST /api/album/:channelId/photos/:photoId/tagged — set tagged people
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+\/tagged$/) && method === "POST") {
      const parts = url.split("/");
      const photoId = parseInt(parts[5]);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { userIds } = JSON.parse(body);
          dbSetPhotoTagged(photoId, Array.isArray(userIds) ? userIds : []);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // PATCH /api/album/:channelId/photos/:photoId/caption — set caption
    if (url.match(/^\/api\/album\/[^/]+\/photos\/\d+\/caption$/) && method === "PATCH") {
      const photoId = parseInt(url.split("/")[5]);
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { caption } = JSON.parse(body);
          dbSetPhotoCaption(photoId, caption ?? "");
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // PUT /api/photo/:photoId/taken — set photo taken date
    if (url.match(/^\/api\/photo\/\d+\/taken$/) && method === "PUT") {
      const photoId = parseInt(url.split("/")[3]);
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { takenAt } = JSON.parse(body);
          dbSetPhotoTakenAt(photoId, takenAt ?? null);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // PUT /api/photo/:photoId/location — set photo location
    if (url.match(/^\/api\/photo\/\d+\/location$/) && method === "PUT") {
      const photoId = parseInt(url.split("/")[3]);
      if (!isValidSession(getTokenFromRequest(req))) { send401(res); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { locationId } = JSON.parse(body);
          dbSetPhotoLocation(photoId, locationId ?? null);
          sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 500, { error: "Failed" }); }
      });
      return;
    }

    // GET /api/album/:channelId/votes — get all vote breakdowns for an album
    if (url.match(/^\/api\/album\/[^/]+\/votes$/) && method === "GET") {
      const channelId = url.split("/")[3];
      const token = getTokenFromRequest(req);
      if (!isValidSession(token)) { send401(res); return; }
      sendJson(res, 200, dbGetAlbumVotes(channelId));
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
          const { reactType, isSuper } = JSON.parse(body);
          if (!reactType || typeof reactType !== 'string' || reactType.length > 10) {
            sendJson(res, 400, { error: "Invalid react type" }); return;
          }
          const result = dbVotePhoto(photoId, sessionUser.userId, reactType, !!isSuper);
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
          sendJson(res, 200, { groupName: album.groupName, dateText: album.dateText, photos: album.photos });
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
      if (parts.length < 2) { res.writeHead(400); res.end("Bad request"); return; }
      const [channelId, filename] = parts;
      const thumbPath = path.resolve(PHOTO_STORAGE_PATH, channelId, "thumbs", filename);
      const fullPath = path.resolve(PHOTO_STORAGE_PATH, channelId, filename);
      const storagePrefix = PHOTO_STORAGE_PATH + path.sep;
      const servePath = fs.existsSync(thumbPath) ? thumbPath : fullPath;
      if (!servePath.startsWith(storagePrefix) || !fs.existsSync(servePath)) {
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
      if (parts.length < 2) { res.writeHead(400); res.end("Bad request"); return; }
      const [channelId, filename] = parts;
      const filePath = path.resolve(PHOTO_STORAGE_PATH, channelId, filename);
      const storagePrefix = PHOTO_STORAGE_PATH + path.sep;
      if (!filePath.startsWith(storagePrefix) || !fs.existsSync(filePath)) {
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
