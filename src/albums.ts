import { Interaction, TextChannel } from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import { eventStates } from "./state";
import { config } from "./config";
import { handleAuthRoutes, isValidSession } from "./auth";
import { initDb, dbHasAlbum, dbInsertAlbum, dbDeleteAlbum, dbAddPhoto, dbGetAlbumWithPhotos, dbGetAllAlbumsWithPhotos, dbCreateAlbum } from "./db";

export function loadAlbums() {
  initDb();
}

export function hasAlbum(channelId: string): boolean {
  return dbHasAlbum(channelId);
}

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

export function getAlbumUrl(channelId: string): string | null {
  if (!dbHasAlbum(channelId)) return null;
  return `${getBaseUrl()}/#/album/${channelId}`;
}

// Returns channelId if event messages need refreshing, null otherwise
export async function handleAlbumInteractions(interaction: Interaction): Promise<string | null> {
  if (!interaction.isButton()) return null;

  if (interaction.customId.startsWith("album_start_")) {
    const channelId = interaction.customId.slice("album_start_".length);
    const eventState = eventStates.get(channelId);
    const albumName = eventState?.eventName ?? channelId;
    const dateText = eventState?.dateText;
    const albumUrl = `${getBaseUrl()}/#/album/${channelId}`;
    dbInsertAlbum({ channelId, groupName: albumName, dateText, createdAt: new Date().toISOString() });
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

export function handleAlbumMessageCreate(message: { author: { bot: boolean }; channelId: string; attachments: Map<string, { contentType?: string | null; url: string }> }): void {
  if (!config.albumsEnabled || message.author.bot) return;
  if (!dbHasAlbum(message.channelId)) return;
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType?.startsWith("image/")) {
      dbAddPhoto(message.channelId, attachment.url);
    }
  }
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
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...album, imageUrls: [] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to create album" }));
        }
      });
      return;
    }
    if (url.startsWith("/api/album/")) {
      const channelId = url.slice("/api/album/".length);
      const album = dbGetAlbumWithPhotos(channelId);
      res.writeHead(album ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(album ?? { error: "Not found" }));
      return;
    }

    // Static files — assets have hashed names; everything else serves index.html for Vue Router
    const filePath = url.startsWith("/assets/")
      ? path.join(webDist, url)
      : path.join(webDist, "index.html");

    if (!filePath.startsWith(webDist) || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const mime = MIME[path.extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(fs.readFileSync(filePath));
  }).listen(port, () => console.log(`Photo album web server running on port ${port}`));
}
