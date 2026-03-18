import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Interaction, Message } from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import { DATA_DIR, groupStates } from "./state";
import { config } from "./config";

export type PhotoAlbum = {
  channelId: string;
  groupName: string;
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

export function buildEditMenuComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`group_editmodal_${channelId}`).setLabel("✏️ Edit Group").setStyle(ButtonStyle.Primary),
  );
  if (config.albumsEnabled) {
    if (!albums.has(channelId)) {
      row.addComponents(new ButtonBuilder().setCustomId(`album_start_${channelId}`).setLabel("📸 Start Photo Album").setStyle(ButtonStyle.Secondary));
    } else {
      row.addComponents(new ButtonBuilder().setCustomId(`album_delete_${channelId}`).setLabel("🗑️ Delete Photo Album").setStyle(ButtonStyle.Danger));
    }
  }
  row.addComponents(new ButtonBuilder().setCustomId("group_edit_cancel").setLabel("✕ Cancel").setStyle(ButtonStyle.Secondary));
  return [row];
}

export async function handleAlbumInteractions(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("album_start_")) {
    const channelId = interaction.customId.slice("album_start_".length);
    const groupName = groupStates.get(channelId)?.groupName ?? channelId;
    albums.set(channelId, { channelId, groupName, imageUrls: [], createdAt: new Date().toISOString() });
    persistAlbums();
    await interaction.update({ content: "📸 Photo album started!", components: [] });
    return;
  }

  if (interaction.customId.startsWith("album_delete_")) {
    const channelId = interaction.customId.slice("album_delete_".length);
    albums.delete(channelId);
    persistAlbums();
    await interaction.update({ content: "🗑️ Photo album deleted.", components: [] });
    return;
  }
}

export function handleAlbumMessageCreate(message: Message): void {
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

function buildHtml(): string {
  const albumList = [...albums.values()];
  const body = albumList.length === 0
    ? "<p>No albums yet.</p>"
    : albumList.map(album => {
        const images = album.imageUrls.length === 0
          ? "<p>No images yet.</p>"
          : album.imageUrls.map(url =>
              `<a href="${url}" target="_blank"><img src="${url}" onerror="this.parentElement.style.display='none'"></a>`
            ).join("");
        return `<section>
          <h2>${album.groupName}</h2>
          <p class="meta">${album.imageUrls.length} image(s) · started ${new Date(album.createdAt).toLocaleDateString("en-GB")}</p>
          <div class="gallery">${images}</div>
        </section>`;
      }).join("");

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
    h2 { color: #89b4fa; margin-bottom: 6px; }
    .meta { color: #a6adc8; font-size: 0.85em; margin-bottom: 12px; }
    section { background: #313244; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
    .gallery { display: flex; flex-wrap: wrap; gap: 8px; }
    .gallery img { width: 180px; height: 180px; object-fit: cover; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>📸 Snek Photo Albums</h1>
  ${body}
</body>
</html>`;
}

export function startWebServer(): void {
  if (!config.albumsEnabled) return;
  const port = parseInt(process.env.ALBUM_PORT ?? "3000");
  http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildHtml());
  }).listen(port, () => console.log(`Photo album web server running on port ${port}`));
}
