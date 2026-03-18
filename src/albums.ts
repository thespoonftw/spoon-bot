import { Interaction, TextChannel } from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import { DATA_DIR, eventStates } from "./state";
import { config } from "./config";
import { handleAuthRoutes } from "./auth";

export type PhotoAlbum = {
  channelId: string;
  groupName: string;
  dateText?: string;
  imageUrls: string[];
  createdAt: string;
};

const ALBUMS_FILE = path.join(DATA_DIR, "albums.json");
let albums: Map<string, PhotoAlbum> = new Map();

export function loadAlbums() {
  try {
    if (!fs.existsSync(ALBUMS_FILE)) return;
    const data: PhotoAlbum[] = JSON.parse(fs.readFileSync(ALBUMS_FILE, "utf-8"));
    albums = new Map(data.map(a => [a.channelId, a]));
    console.log(`Loaded ${albums.size} photo album(s) from disk.`);
  } catch (e) { console.error("Failed to load albums:", e); }
}

function persistAlbums() {
  fs.writeFileSync(ALBUMS_FILE, JSON.stringify([...albums.values()], null, 2));
}

export function hasAlbum(channelId: string): boolean {
  return albums.has(channelId);
}

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

export function getAlbumUrl(channelId: string): string | null {
  if (!albums.has(channelId)) return null;
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
    albums.set(channelId, { channelId, groupName: albumName, dateText, imageUrls: [], createdAt: new Date().toISOString() });
    persistAlbums();
    await interaction.update({ content: `Photo album started! ${albumUrl}`, components: [] });
    const channel = interaction.guild?.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send(`📸 Photo album started for **${albumName}**! ${albumUrl}`);
    }
    return channelId;
  }

  if (interaction.customId.startsWith("album_delete_")) {
    const channelId = interaction.customId.slice("album_delete_".length);
    albums.delete(channelId);
    persistAlbums();
    await interaction.update({ content: "Photo album deleted.", components: [] });
    return channelId;
  }

  return null;
}

export function handleAlbumMessageCreate(message: { author: { bot: boolean }; channelId: string; attachments: Map<string, { contentType?: string | null; url: string }> }): void {
  if (!config.albumsEnabled || message.author.bot) return;
  const album = albums.get(message.channelId);
  if (!album) return;
  const newUrls: string[] = [];
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType?.startsWith("image/")) newUrls.push(attachment.url);
  }
  if (newUrls.length === 0) return;
  album.imageUrls.push(...newUrls);
  persistAlbums();
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

    if (handleAuthRoutes(req, res)) return;

    if (url === "/api/albums") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([...albums.values()]));
      return;
    }
    if (url.startsWith("/api/album/")) {
      const channelId = url.slice("/api/album/".length);
      const album = albums.get(channelId);
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
