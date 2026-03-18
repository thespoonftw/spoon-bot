import { Interaction, TextChannel } from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import { DATA_DIR, eventStates } from "./state";
import { config } from "./config";

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

function buildIndexHtml(): string {
  const albumList = [...albums.values()];
  const cards = albumList.length === 0
    ? "<p>No albums yet.</p>"
    : albumList.map(album => `
        <a class="card" href="/album/${album.channelId}">
          <h2>${album.groupName}</h2>
          ${album.dateText ? `<p class="date">${album.dateText}</p>` : ""}
          <p class="meta">${album.imageUrls.length} photo(s)</p>
        </a>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Snek Photo Albums</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 32px; }
    h1 { color: #cba6f7; margin-bottom: 24px; }
    h2 { color: #89b4fa; margin-bottom: 4px; }
    .date { color: #cdd6f4; margin-bottom: 4px; }
    .meta { color: #a6adc8; font-size: 0.85em; }
    .card { display: block; background: #313244; border-radius: 10px; padding: 20px; margin-bottom: 16px; text-decoration: none; color: inherit; }
    .card:hover { background: #45475a; }
  </style>
</head>
<body>
  <h1>📸 Snek Photo Albums</h1>
  ${cards}
</body>
</html>`;
}

function buildAlbumPageHtml(album: PhotoAlbum): string {
  const images = album.imageUrls.length === 0
    ? "<p>No photos yet.</p>"
    : album.imageUrls.map(url =>
        `<a href="${url}" target="_blank"><img src="${url}" onerror="this.parentElement.style.display='none'"></a>`
      ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${album.groupName} – Snek Photos</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 32px; }
    h1 { color: #cba6f7; margin-bottom: 6px; }
    .date { color: #a6adc8; margin-bottom: 24px; }
    a.back { color: #89b4fa; text-decoration: none; display: inline-block; margin-bottom: 20px; }
    .gallery { display: flex; flex-wrap: wrap; gap: 8px; }
    .gallery img { width: 220px; height: 220px; object-fit: cover; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <a class="back" href="/">← All Albums</a>
  <h1>${album.groupName}</h1>
  ${album.dateText ? `<p class="date">${album.dateText}</p>` : ""}
  <div class="gallery">${images}</div>
</body>
</html>`;
}

export function startWebServer(): void {
  if (!config.albumsEnabled) return;
  const port = parseInt(process.env.ALBUM_PORT ?? "3000");
  http.createServer((req, res) => {
    const url = req.url ?? "/";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (url.startsWith("/album/")) {
      const channelId = url.slice("/album/".length).split("?")[0];
      const album = albums.get(channelId);
      res.end(album ? buildAlbumPageHtml(album) : "<h1>Album not found</h1>");
    } else {
      res.end(buildIndexHtml());
    }
  }).listen(port, () => console.log(`Photo album web server running on port ${port}`));
}
