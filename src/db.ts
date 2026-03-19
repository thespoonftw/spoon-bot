import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./state";

const DB_FILE = path.join(DATA_DIR, "snek.db");
const ALBUMS_JSON = path.join(DATA_DIR, "albums.json");

let db: Database.Database;

export function initDb() {
  db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      avatar_url    TEXT,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS albums (
      channel_id  TEXT PRIMARY KEY,
      group_name  TEXT NOT NULL,
      date_text   TEXT,
      location    TEXT,
      start_date  TEXT,
      end_date    TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id        TEXT NOT NULL REFERENCES albums(channel_id),
      url               TEXT NOT NULL,
      filename          TEXT,
      uploaded_by_id    TEXT,
      uploaded_by_name  TEXT,
      uploaded_at       TEXT NOT NULL
    );
  `);
  // Add new columns to existing DBs (safe to run repeatedly — fails silently if column exists)
  for (const sql of [
    "ALTER TABLE albums ADD COLUMN location TEXT",
    "ALTER TABLE albums ADD COLUMN start_date TEXT",
    "ALTER TABLE albums ADD COLUMN end_date TEXT",
    "ALTER TABLE photos ADD COLUMN filename TEXT",
    "ALTER TABLE photos ADD COLUMN uploaded_by_id TEXT",
    "ALTER TABLE photos ADD COLUMN uploaded_by_name TEXT",
  ]) {
    try { db.exec(sql); } catch { /* already exists */ }
  }
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

function formatDateDisplay(startDate: string, endDate?: string | null): string {
  const parse = (s: string) => {
    const d = new Date(s + "T00:00:00Z");
    const day = d.getUTCDate();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th";
    return { day, suffix, month, year, monthIdx: d.getUTCMonth() };
  };
  const s = parse(startDate);
  if (!endDate) return `${s.day}${s.suffix} ${s.month} ${s.year}`;
  const e = parse(endDate);
  if (s.monthIdx === e.monthIdx && s.year === e.year) return `${s.day}${s.suffix}–${e.day}${e.suffix} ${s.month} ${s.year}`;
  if (s.year === e.year) return `${s.day}${s.suffix} ${s.month} – ${e.day}${e.suffix} ${e.month} ${s.year}`;
  return `${s.day}${s.suffix} ${s.month} ${s.year} – ${e.day}${e.suffix} ${e.month} ${e.year}`;
}

export type AlbumRow = {
  channelId: string; groupName: string; dateText?: string;
  location?: string; startDate?: string; endDate?: string; createdAt: string;
};
export type PhotoRow = {
  id: number; channelId: string; url: string;
  filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string;
};
export type AlbumWithPhotos = AlbumRow & { photos: PhotoRow[] };

export function dbHasAlbum(channelId: string): boolean {
  return !!db.prepare("SELECT 1 FROM albums WHERE channel_id = ?").get(channelId);
}

export function dbGetAlbum(channelId: string): AlbumRow | undefined {
  return db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, location, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums WHERE channel_id = ?"
  ).get(channelId) as AlbumRow | undefined;
}

export function dbGetPhotos(channelId: string): PhotoRow[] {
  return db.prepare(
    "SELECT id, channel_id AS channelId, url, filename, uploaded_by_id AS uploadedById, uploaded_by_name AS uploadedByName, uploaded_at AS uploadedAt FROM photos WHERE channel_id = ? ORDER BY id"
  ).all(channelId) as PhotoRow[];
}

export function dbGetAlbumWithPhotos(channelId: string): AlbumWithPhotos | null {
  const album = dbGetAlbum(channelId);
  if (!album) return null;
  return { ...album, photos: dbGetPhotos(album.channelId) };
}

export function dbGetAllAlbumsWithPhotos(): AlbumWithPhotos[] {
  const albums = db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, location, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums ORDER BY created_at DESC"
  ).all() as AlbumRow[];
  return albums.map(a => ({ ...a, photos: dbGetPhotos(a.channelId) }));
}

export function dbInsertAlbum(album: AlbumRow) {
  db.prepare("INSERT OR REPLACE INTO albums (channel_id, group_name, date_text, location, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(album.channelId, album.groupName, album.dateText ?? null, album.location ?? null, album.startDate ?? null, album.endDate ?? null, album.createdAt);
}

export function dbCreateAlbum(name: string, location: string, startDate: string, endDate?: string): AlbumRow {
  const channelId = "web_" + crypto.randomBytes(8).toString("hex");
  const dateText = formatDateDisplay(startDate, endDate);
  const album: AlbumRow = { channelId, groupName: name, dateText, location, startDate, endDate, createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO albums (channel_id, group_name, date_text, location, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(channelId, name, dateText, location, startDate, endDate ?? null, album.createdAt);
  return album;
}

export function dbSyncAlbumFromEvent(channelId: string, eventName: string, location: string, dateText?: string) {
  db.prepare("UPDATE albums SET group_name=?, location=?, date_text=? WHERE channel_id=?")
    .run(eventName, location, dateText ?? null, channelId);
}

export function dbUpdateAlbum(channelId: string, name: string, location: string, startDate?: string, endDate?: string): AlbumRow | undefined {
  const dateText = startDate ? formatDateDisplay(startDate, endDate) : undefined;
  db.prepare("UPDATE albums SET group_name=?, location=?, start_date=?, end_date=?, date_text=? WHERE channel_id=?")
    .run(name, location, startDate ?? null, endDate ?? null, dateText ?? null, channelId);
  return dbGetAlbum(channelId);
}

export function dbDeleteAlbum(channelId: string) {
  db.prepare("DELETE FROM photos WHERE channel_id = ?").run(channelId);
  db.prepare("DELETE FROM albums WHERE channel_id = ?").run(channelId);
}

export function dbAddPhoto(channelId: string, url: string) {
  db.prepare("INSERT INTO photos (channel_id, url, uploaded_at) VALUES (?, ?, ?)")
    .run(channelId, url, new Date().toISOString());
}

export type UserRow = { userId: string; displayName: string; avatarUrl?: string; lastLoginAt?: string };

export function dbUpsertUser(userId: string, displayName: string, avatarUrl?: string) {
  db.prepare(`
    INSERT INTO users (user_id, display_name, avatar_url) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, avatar_url=excluded.avatar_url
  `).run(userId, displayName, avatarUrl ?? null);
}

export function dbUpdateUserLastLogin(userId: string) {
  db.prepare("UPDATE users SET last_login_at=? WHERE user_id=?").run(new Date().toISOString(), userId);
}

export function dbGetAllUsers(): UserRow[] {
  return db.prepare(
    "SELECT user_id AS userId, display_name AS displayName, avatar_url AS avatarUrl, last_login_at AS lastLoginAt FROM users ORDER BY display_name ASC"
  ).all() as UserRow[];
}

export function dbAddUploadedPhoto(channelId: string, url: string, filename: string, uploadedById: string, uploadedByName: string): PhotoRow {
  const uploadedAt = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO photos (channel_id, url, filename, uploaded_by_id, uploaded_by_name, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(channelId, url, filename, uploadedById, uploadedByName, uploadedAt);
  return { id: result.lastInsertRowid as number, channelId, url, filename, uploadedById, uploadedByName, uploadedAt };
}
