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
      first_name    TEXT,
      avatar_url    TEXT,
      last_login_at TEXT,
      level         INTEGER NOT NULL DEFAULT 1
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
    CREATE TABLE IF NOT EXISTS album_members (
      channel_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      hidden      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS photos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id        TEXT NOT NULL REFERENCES albums(channel_id),
      url               TEXT NOT NULL,
      filename          TEXT,
      uploaded_by_id    TEXT,
      uploaded_by_name  TEXT,
      uploaded_at       TEXT NOT NULL,
      taken_at          TEXT,
      width             INTEGER,
      height            INTEGER,
      lat               REAL,
      lon               REAL
    );
    CREATE TABLE IF NOT EXISTS album_shares (
      token         TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_votes (
      photo_id  INTEGER NOT NULL,
      user_id   TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      PRIMARY KEY (photo_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS photo_featured (
      photo_id INTEGER NOT NULL,
      user_id  TEXT NOT NULL,
      PRIMARY KEY (photo_id, user_id)
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
    "ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN first_name TEXT",
    "ALTER TABLE album_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN taken_at TEXT",
    "ALTER TABLE photos ADD COLUMN width INTEGER",
    "ALTER TABLE photos ADD COLUMN height INTEGER",
    "ALTER TABLE photos ADD COLUMN lat REAL",
    "ALTER TABLE photos ADD COLUMN lon REAL",
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
  takenAt?: string; width?: number; height?: number; lat?: number; lon?: number;
  score?: number; userVote?: string | null; featuredIds?: string[];
};
export type AlbumWithPhotos = AlbumRow & { photos: PhotoRow[]; members: UserRow[] };

export function dbHasAlbum(channelId: string): boolean {
  return !!db.prepare("SELECT 1 FROM albums WHERE channel_id = ?").get(channelId);
}

export function dbGetAlbum(channelId: string): AlbumRow | undefined {
  return db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, location, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums WHERE channel_id = ?"
  ).get(channelId) as AlbumRow | undefined;
}

export function dbGetPhotos(channelId: string, userId?: string): PhotoRow[] {
  type RawRow = PhotoRow & { featuredIds: string | null };
  const toRow = (r: RawRow): PhotoRow => ({ ...r, featuredIds: r.featuredIds ? r.featuredIds.split(",") : [] });
  if (userId) {
    const rows = db.prepare(`
      SELECT p.id, p.channel_id AS channelId, p.url, p.filename,
        p.uploaded_by_id AS uploadedById,
        COALESCE(u.first_name, p.uploaded_by_name) AS uploadedByName,
        p.uploaded_at AS uploadedAt, p.taken_at AS takenAt, p.width, p.height, p.lat, p.lon,
        COALESCE((SELECT SUM(CASE vote_type WHEN 'fav' THEN 3 WHEN 'up' THEN 1 WHEN 'down' THEN -1 ELSE 0 END) FROM photo_votes WHERE photo_id = p.id), 0) AS score,
        (SELECT vote_type FROM photo_votes WHERE photo_id = p.id AND user_id = ?) AS userVote,
        (SELECT GROUP_CONCAT(pf.user_id) FROM photo_featured pf WHERE pf.photo_id = p.id) AS featuredIds
      FROM photos p LEFT JOIN users u ON u.user_id = p.uploaded_by_id
      WHERE p.channel_id = ? ORDER BY p.id
    `).all(userId, channelId) as RawRow[];
    return rows.map(toRow);
  }
  const rows = db.prepare(`
    SELECT p.id, p.channel_id AS channelId, p.url, p.filename,
      p.uploaded_by_id AS uploadedById,
      COALESCE(u.first_name, p.uploaded_by_name) AS uploadedByName,
      p.uploaded_at AS uploadedAt, p.taken_at AS takenAt, p.width, p.height, p.lat, p.lon,
      COALESCE((SELECT SUM(CASE vote_type WHEN 'fav' THEN 3 WHEN 'up' THEN 1 WHEN 'down' THEN -1 ELSE 0 END) FROM photo_votes WHERE photo_id = p.id), 0) AS score,
      NULL AS userVote,
      (SELECT GROUP_CONCAT(pf.user_id) FROM photo_featured pf WHERE pf.photo_id = p.id) AS featuredIds
    FROM photos p LEFT JOIN users u ON u.user_id = p.uploaded_by_id
    WHERE p.channel_id = ? ORDER BY p.id
  `).all(channelId) as RawRow[];
  return rows.map(toRow);
}

export function dbGetAlbumWithPhotos(channelId: string, userId?: string): AlbumWithPhotos | null {
  const album = dbGetAlbum(channelId);
  if (!album) return null;
  return { ...album, photos: dbGetPhotos(album.channelId, userId), members: dbGetAlbumMembers(channelId) };
}

export function dbGetAllAlbumsWithPhotos(): AlbumWithPhotos[] {
  const albums = db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, date_text AS dateText, location, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums ORDER BY created_at DESC"
  ).all() as AlbumRow[];
  return albums.map(a => ({ ...a, photos: dbGetPhotos(a.channelId), members: dbGetAlbumMembers(a.channelId) }));
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

export type UserRow = { userId: string; displayName: string; firstName?: string; avatarUrl?: string; lastLoginAt?: string; level: number };

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
    "SELECT user_id AS userId, display_name AS displayName, first_name AS firstName, avatar_url AS avatarUrl, last_login_at AS lastLoginAt, level FROM users WHERE level > 0 ORDER BY display_name ASC"
  ).all() as UserRow[];
}

export function dbAddAlbumMember(channelId: string, userId: string) {
  db.prepare("INSERT OR IGNORE INTO album_members (channel_id, user_id) VALUES (?, ?)").run(channelId, userId);
}

export function dbRemoveAlbumMember(channelId: string, userId: string) {
  db.prepare("DELETE FROM album_members WHERE channel_id=? AND user_id=?").run(channelId, userId);
}

export function dbHideAlbumMember(channelId: string, userId: string) {
  db.prepare("UPDATE album_members SET hidden=1 WHERE channel_id=? AND user_id=?").run(channelId, userId);
}

export function dbUnhideAlbumMember(channelId: string, userId: string) {
  db.prepare("UPDATE album_members SET hidden=0 WHERE channel_id=? AND user_id=?").run(channelId, userId);
}

export function dbGetAlbumMembers(channelId: string): UserRow[] {
  return db.prepare(`
    SELECT u.user_id AS userId, u.display_name AS displayName, u.first_name AS firstName, u.avatar_url AS avatarUrl, u.last_login_at AS lastLoginAt, u.level
    FROM album_members am JOIN users u ON u.user_id = am.user_id
    WHERE am.channel_id = ? AND am.hidden = 0 AND u.level > 0 ORDER BY u.display_name ASC
  `).all(channelId) as UserRow[];
}

export type AlbumMemberRow = UserRow & { hidden: number };

export function dbUpdateUserFirstName(userId: string, firstName: string | null) {
  db.prepare("UPDATE users SET first_name=? WHERE user_id=?").run(firstName || null, userId);
}

export function dbGetUserById(userId: string): UserRow | undefined {
  return db.prepare("SELECT user_id AS userId, display_name AS displayName, first_name AS firstName, avatar_url AS avatarUrl, last_login_at AS lastLoginAt, level FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
}

export function dbCreateGuestUser(name: string): UserRow {
  const userId = "guest_" + crypto.randomBytes(8).toString("hex");
  db.prepare("INSERT INTO users (user_id, display_name, level) VALUES (?, ?, 1)").run(userId, name);
  return { userId, displayName: name, level: 1 };
}

export function dbDeleteUser(userId: string) {
  db.prepare("DELETE FROM album_members WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
}

export function dbGetAllAlbumMembers(channelId: string): AlbumMemberRow[] {
  return db.prepare(`
    SELECT u.user_id AS userId, u.display_name AS displayName, u.first_name AS firstName, u.avatar_url AS avatarUrl, u.last_login_at AS lastLoginAt, u.level, am.hidden
    FROM album_members am JOIN users u ON u.user_id = am.user_id
    WHERE am.channel_id = ? AND u.level > 0 ORDER BY am.hidden ASC, u.display_name ASC
  `).all(channelId) as AlbumMemberRow[];
}

export function dbAddUploadedPhoto(channelId: string, url: string, filename: string, uploadedById: string, uploadedByName: string, width: number, height: number, takenAt?: string, lat?: number, lon?: number): PhotoRow {
  const uploadedAt = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO photos (channel_id, url, filename, uploaded_by_id, uploaded_by_name, uploaded_at, taken_at, width, height, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(channelId, url, filename, uploadedById, uploadedByName, uploadedAt, takenAt ?? null, width, height, lat ?? null, lon ?? null);
  return { id: result.lastInsertRowid as number, channelId, url, filename, uploadedById, uploadedByName, uploadedAt, takenAt, width, height, lat, lon };
}

export function dbGetPhotoCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM photos").get() as { n: number }).n;
}

export function dbGetAlbumCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM albums").get() as { n: number }).n;
}

export function dbCreateAlbumShare(channelId: string, token: string, passwordHash: string): void {
  db.prepare("INSERT INTO album_shares (token, channel_id, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(token, channelId, passwordHash, new Date().toISOString());
}

export function dbGetAlbumShare(token: string): { channelId: string; passwordHash: string } | null {
  return db.prepare("SELECT channel_id AS channelId, password_hash AS passwordHash FROM album_shares WHERE token = ?").get(token) as { channelId: string; passwordHash: string } | null;
}

export function dbDeletePhoto(photoId: number): string | null {
  const row = db.prepare("SELECT filename FROM photos WHERE id = ?").get(photoId) as { filename: string } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM photos WHERE id = ?").run(photoId);
  return row.filename;
}

export function dbSetPhotoFeatured(photoId: number, userIds: string[]): void {
  const del = db.prepare("DELETE FROM photo_featured WHERE photo_id = ?");
  const ins = db.prepare("INSERT INTO photo_featured (photo_id, user_id) VALUES (?, ?)");
  db.transaction(() => {
    del.run(photoId);
    for (const uid of userIds) ins.run(photoId, uid);
  })();
}

export function dbVotePhoto(photoId: number, userId: string, voteType: string): { score: number; userVote: string | null } {
  const existing = db.prepare("SELECT vote_type FROM photo_votes WHERE photo_id = ? AND user_id = ?").get(photoId, userId) as { vote_type: string } | undefined;
  if (existing?.vote_type === voteType) {
    db.prepare("DELETE FROM photo_votes WHERE photo_id = ? AND user_id = ?").run(photoId, userId);
  } else {
    db.prepare("INSERT OR REPLACE INTO photo_votes (photo_id, user_id, vote_type) VALUES (?, ?, ?)").run(photoId, userId, voteType);
  }
  const scoreRow = db.prepare(
    "SELECT COALESCE(SUM(CASE vote_type WHEN 'fav' THEN 3 WHEN 'up' THEN 1 WHEN 'down' THEN -1 ELSE 0 END), 0) AS score FROM photo_votes WHERE photo_id = ?"
  ).get(photoId) as { score: number };
  const voteRow = db.prepare("SELECT vote_type FROM photo_votes WHERE photo_id = ? AND user_id = ?").get(photoId, userId) as { vote_type: string } | undefined;
  return { score: scoreRow.score, userVote: voteRow?.vote_type ?? null };
}
