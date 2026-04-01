import { Interaction, TextChannel, MessageReaction, User, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import https from "https";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: string) => { resize(w: number, h: number, opts?: object): { toFile(p: string): Promise<void> }; metadata(): Promise<{ width?: number; height?: number }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const exifr = require("exifr") as { parse(file: string, opts: unknown): Promise<Record<string, unknown> | null> };
import { eventStates, DATA_DIR } from "./state";
import { initDb, dbHasAlbum, dbInsertAlbum, dbAddUploadedPhoto, dbUpsertUser, dbAddAlbumMember, dbDeleteAlbum, dbGetPhotosByDiscordMessageId, dbVotePhoto } from "./db";
import type { Guild } from "discord.js";

const PHOTO_STORAGE_PATH = process.env.PHOTO_STORAGE_PATH ?? path.join(DATA_DIR, "photos");

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
  const albumUrl = `${getBaseUrl()}/album/${channelId}`;
  dbInsertAlbum({ channelId, groupName: albumName, createdAt: new Date().toISOString() });
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
  const channelId = reaction.message.channelId;
  if (!dbHasAlbum(channelId)) return;

  // Any reaction on a single-image message → 👍 upvote for that photo
  if (!ALBUM_REACTION_EMOJIS.includes(reaction.emoji.name ?? "")) {
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const imageAttachments = [...message.attachments.values()].filter(a => a.contentType?.startsWith("image/"));
    if (imageAttachments.length === 1) {
      const photos = dbGetPhotosByDiscordMessageId(message.id);
      if (photos.length === 1) {
        dbUpsertUser(user.id, user.displayName ?? user.username, user.avatarURL() ?? undefined);
        dbVotePhoto(photos[0].id, user.id, "up");
      }
    }
    return;
  }

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

      try { await sharp(filePath).resize(256, 256, { fit: "outside", withoutEnlargement: true }).toFile(path.join(thumbDir, name)); } catch {}

      const photoUrl = `/uploads/${channelId}/${name}`;
      const caption = imageAttachments.length === 1 && message.content.trim() ? message.content.trim() : undefined;
      const photo = dbAddUploadedPhoto(channelId, photoUrl, name, author.id, width, height, takenAt, caption, message.id);

      // If single image, backfill any existing non-album reactions as upvotes
      if (imageAttachments.length === 1) {
        for (const [, msgReaction] of message.reactions.cache) {
          if (ALBUM_REACTION_EMOJIS.includes(msgReaction.emoji.name ?? "")) continue;
          try {
            const reactors = await msgReaction.users.fetch();
            for (const [, reactUser] of reactors) {
              if (reactUser.bot) continue;
              dbUpsertUser(reactUser.id, reactUser.displayName ?? reactUser.username, reactUser.avatarURL() ?? undefined);
              dbVotePhoto(photo.id, reactUser.id, "up");
            }
          } catch (e) { console.error("Failed to backfill reaction votes:", e); }
        }
      }

      anySuccess = true;
    } catch (e) { console.error("Failed to download/process reaction attachment:", e); }
  }

  if (anySuccess && reaction.emoji.name) {
    try { await message.react(reaction.emoji.name); } catch {}
  }
}

interface PendingUpload {
  channelId: string;
  attachments: { url: string; name: string }[];
  authorId: string;
  authorName: string;
  avatarUrl?: string;
  caption?: string;
  messageId: string;
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

  const caption = imageAttachments.length === 1 && message.content.trim() ? message.content.trim() : undefined;
  pendingUploads.set(pendingId, {
    channelId: message.channelId,
    attachments: imageAttachments.map(a => ({ url: a.url, name: a.name || "photo.jpg" })),
    authorId: message.author.id,
    authorName: displayName,
    avatarUrl: message.author.avatarURL() ?? undefined,
    caption,
    messageId: message.id,
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
  const { channelId, attachments, authorId, authorName, avatarUrl, caption, messageId } = pending;
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
      try { await sharp(filePath).resize(256, 256, { fit: "outside", withoutEnlargement: true }).toFile(path.join(thumbDir, name)); } catch {}
      dbAddUploadedPhoto(channelId, `/uploads/${channelId}/${name}`, name, authorId, width, height, takenAt, attachments.length === 1 ? caption : undefined, messageId);
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
