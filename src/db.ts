import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./state";

const DB_FILE = path.join(DATA_DIR, "snek.db");
const ALBUMS_JSON = path.join(DATA_DIR, "albums.json");

let db: Database.Database;

export function initDb() {
  db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      channel_id  TEXT PRIMARY KEY,
      group_name  TEXT NOT NULL,
      date_text   TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  TEXT NOT NULL REFERENCES albums(channel_id),
      url         TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
  `);
  migrateFromJson();
}

function migrateFromJson() {
  if (!fs.existsSync(ALBUMS_JSON)) return;
  try {
    type OldAlbum = { channelId: string; groupName: string; dateText?: string; imageUrls: string[]; createdAt: string };
    const data: OldAlbum[] = JSON.parse(fs.readFileSync(ALBUMS_JSON, "utf-8"));
    const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (channel_id, group_name, date_text, created_at) VALUES (?, ?, ?, ?)");
    const insertPhoto = db.prepare("INSERT INTO photos (channel_id, url, uploaded_at) VALUES (?, ?, ?)");
    const migrate = db.transaction(() => {
      for (const a of data) {
        insertAlbum.run(a.channelId, a.groupName, a.dateText ?? null, a.createdAt);
        for (const url of a.imageUrls) {
          insertPhoto.run(a.channelId, url, a.createdAt);
        }
      }
    });
    migrate();
    fs.renameSync(ALBUMS_JSON, ALBUMS_JSON + ".migrated");
    console.log(`Migrated ${data.length} album(s) from albums.json to SQLite.`);
  } catch (e) {
    console.error("Failed to migrate albums.json:", e);
  }
}

export type AlbumRow = { channelId: string; groupName: string; dateText?: string; createdAt: string };
export type AlbumWithPhotos = AlbumRow & { imageUrls: string[] };

export function dbHasAlbum(channelId: string): boolean {
  return !!db.prepare("SELECT 1 FROM albums WHERE channel_id = ?").get(channelId);
}

export function dbGetAlbum(channelId: string): AlbumRow | undefined {
  return db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, created_at AS createdAt FROM albums WHERE channel_id = ?"
  ).get(channelId) as AlbumRow | undefined;
}

export function dbGetPhotos(channelId: string): string[] {
  return (db.prepare("SELECT url FROM photos WHERE channel_id = ? ORDER BY id").all(channelId) as { url: string }[])
    .map(r => r.url);
}

export function dbGetAlbumWithPhotos(channelId: string): AlbumWithPhotos | null {
  const album = dbGetAlbum(channelId);
  if (!album) return null;
  return { ...album, imageUrls: dbGetPhotos(channelId) };
}

export function dbGetAllAlbumsWithPhotos(): AlbumWithPhotos[] {
  const albums = db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, created_at AS createdAt FROM albums ORDER BY created_at DESC"
  ).all() as AlbumRow[];
  return albums.map(a => ({ ...a, imageUrls: dbGetPhotos(a.channelId) }));
}

export function dbInsertAlbum(album: AlbumRow) {
  db.prepare("INSERT OR REPLACE INTO albums (channel_id, group_name, date_text, created_at) VALUES (?, ?, ?, ?)")
    .run(album.channelId, album.groupName, album.dateText ?? null, album.createdAt);
}

export function dbDeleteAlbum(channelId: string) {
  db.prepare("DELETE FROM photos WHERE channel_id = ?").run(channelId);
  db.prepare("DELETE FROM albums WHERE channel_id = ?").run(channelId);
}

export function dbAddPhoto(channelId: string, url: string) {
  db.prepare("INSERT INTO photos (channel_id, url, uploaded_at) VALUES (?, ?, ?)")
    .run(channelId, url, new Date().toISOString());
}
