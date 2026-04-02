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
      last_seen_at TEXT,
      level         INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS albums (
      channel_id  TEXT PRIMARY KEY,
      group_name  TEXT NOT NULL,
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
      uploaded_at       TEXT NOT NULL,
      taken_at          TEXT,
      width             INTEGER,
      height            INTEGER
    );
    CREATE TABLE IF NOT EXISTS album_shares (
      token         TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_votes (
      photo_id   INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      react_type TEXT NOT NULL DEFAULT '👍',
      is_super   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (photo_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS photo_tagged (
      photo_id INTEGER NOT NULL,
      user_id  TEXT NOT NULL,
      PRIMARY KEY (photo_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS album_locations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      lat        REAL,
      lon        REAL,
      UNIQUE(channel_id, name)
    );
  `);
  // Add new columns to existing DBs (safe to run repeatedly — fails silently if column exists)
  for (const sql of [
    "ALTER TABLE albums ADD COLUMN location TEXT",
    "ALTER TABLE albums ADD COLUMN start_date TEXT",
    "ALTER TABLE albums ADD COLUMN end_date TEXT",
    "ALTER TABLE photos ADD COLUMN filename TEXT",
    "ALTER TABLE photos ADD COLUMN uploaded_by_id TEXT",
    "ALTER TABLE photos DROP COLUMN uploaded_by_name",
    "ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN first_name TEXT",
    "ALTER TABLE album_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN taken_at TEXT",
    "ALTER TABLE photos ADD COLUMN width INTEGER",
    "ALTER TABLE photos ADD COLUMN height INTEGER",
    "ALTER TABLE photos ADD COLUMN location_id INTEGER",
    "ALTER TABLE album_locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE album_locations ADD COLUMN lat REAL",
    "ALTER TABLE album_locations ADD COLUMN lon REAL",
    "ALTER TABLE album_locations ADD COLUMN geocode_attempted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN caption TEXT",
    "ALTER TABLE photos ADD COLUMN discord_message_id TEXT",
    "ALTER TABLE albums DROP COLUMN date_text",
    "ALTER TABLE photos DROP COLUMN lat",
    "ALTER TABLE photos DROP COLUMN lon",
    "DROP TABLE IF EXISTS photo_featured",
    "ALTER TABLE albums DROP COLUMN location",
    "ALTER TABLE users RENAME COLUMN last_login_at TO last_seen_at",
    "ALTER TABLE photo_votes ADD COLUMN react_type TEXT NOT NULL DEFAULT '👍'",
    "ALTER TABLE photo_votes ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE photo_votes DROP COLUMN vote_type",
  ]) {
    try { db.exec(sql); } catch { /* already exists */ }
  }
  // Migrate legacy vote_type column to react_type + is_super
  try {
    db.exec(`UPDATE photo_votes SET react_type = '👍', is_super = CASE vote_type WHEN 'fav' THEN 1 ELSE 0 END WHERE vote_type IS NOT NULL AND react_type = '👍' AND is_super = 0`);
  } catch { }
  // Migrate legacy single-location strings into album_locations table
  try {
    db.exec("INSERT OR IGNORE INTO album_locations (channel_id, name) SELECT channel_id, location FROM albums WHERE location IS NOT NULL AND location != ''");
  } catch { }
  migrateFromJson();
  const cleaned = {
    votes: db.prepare("DELETE FROM photo_votes WHERE photo_id NOT IN (SELECT id FROM photos)").run().changes,
    tags: db.prepare("DELETE FROM photo_tagged WHERE photo_id NOT IN (SELECT id FROM photos)").run().changes,
  };
  if (cleaned.votes || cleaned.tags) console.log(`[db] Cleaned up orphaned data: ${cleaned.votes} votes, ${cleaned.tags} tags`);
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
  if (s.monthIdx === e.monthIdx && s.year === e.year) return `${s.day}${s.suffix} ${s.month} – ${e.day}${e.suffix} ${e.month} ${s.year}`;
  if (s.year === e.year) return `${s.day}${s.suffix} ${s.month} – ${e.day}${e.suffix} ${e.month} ${s.year}`;
  return `${s.day}${s.suffix} ${s.month} ${s.year} – ${e.day}${e.suffix} ${e.month} ${e.year}`;
}

export type AlbumLocation = { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number };
export type AlbumRow = {
  channelId: string; groupName: string;
  locations?: AlbumLocation[];
  startDate?: string; endDate?: string; createdAt: string;
  readonly dateText?: string;
};

export function dbGetAlbumLocations(channelId: string): AlbumLocation[] {
  return db.prepare("SELECT id, name, lat, lon, geocode_attempted AS geocodeAttempted FROM album_locations WHERE channel_id = ? ORDER BY sort_order, id").all(channelId) as AlbumLocation[];
}
export function dbSetLocationCoords(id: number, lat: number | null, lon: number | null) {
  db.prepare("UPDATE album_locations SET lat = ?, lon = ?, geocode_attempted = 1 WHERE id = ?").run(lat, lon, id);
}
export function dbRenameAlbumLocation(id: number, name: string) {
  db.prepare("UPDATE album_locations SET name = ? WHERE id = ?").run(name.trim(), id);
}
export function dbAddAlbumLocation(channelId: string, name: string): AlbumLocation | null {
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM album_locations WHERE channel_id = ?").get(channelId) as { m: number }).m;
  const result = db.prepare("INSERT OR IGNORE INTO album_locations (channel_id, name, sort_order) VALUES (?, ?, ?)").run(channelId, name.trim(), maxOrder + 1);
  if (!result.lastInsertRowid) return null;
  return { id: Number(result.lastInsertRowid), name: name.trim() };
}
export function dbDeleteAlbumLocation(id: number) {
  db.prepare("UPDATE photos SET location_id = NULL WHERE location_id = ?").run(id);
  db.prepare("DELETE FROM album_locations WHERE id = ?").run(id);
}
export function dbReorderAlbumLocations(channelId: string, orderedIds: number[]) {
  const update = db.prepare("UPDATE album_locations SET sort_order = ? WHERE id = ? AND channel_id = ?");
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => update.run(i, id, channelId));
  });
  tx();
}

function toAlbumRow(raw: Omit<AlbumRow, "dateText"> & { startDate?: string; endDate?: string }): AlbumRow {
  return { ...raw, dateText: raw.startDate ? formatDateDisplay(raw.startDate, raw.endDate) : undefined };
}
export type PhotoRow = {
  id: number; channelId: string; url: string;
  filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string;
  takenAt?: string; width?: number; height?: number; caption?: string;
  score?: number; userVote?: string | null; userIsSuper?: number | null; taggedIds?: string[];
  locationId?: number | null;
};

export function dbSetPhotoLocation(photoId: number, locationId: number | null) {
  db.prepare("UPDATE photos SET location_id = ? WHERE id = ?").run(locationId, photoId);
}
export type AlbumWithPhotos = AlbumRow & { photos: PhotoRow[]; members: UserRow[] };

export function dbHasAlbum(channelId: string): boolean {
  return !!db.prepare("SELECT 1 FROM albums WHERE channel_id = ?").get(channelId);
}

export function dbGetAlbum(channelId: string): AlbumRow | undefined {
  const raw = db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums WHERE channel_id = ?"
  ).get(channelId) as Omit<AlbumRow, "dateText"> | undefined;
  if (!raw) return undefined;
  return { ...toAlbumRow(raw), locations: dbGetAlbumLocations(channelId) };
}

export function dbGetPhotos(channelId: string, userId?: string): PhotoRow[] {
  type RawRow = PhotoRow & { taggedIds: string | null };
  const toRow = (r: RawRow): PhotoRow => ({ ...r, taggedIds: r.taggedIds ? r.taggedIds.split(",") : [] });
  if (userId) {
    const rows = db.prepare(`
      SELECT p.id, p.channel_id AS channelId, p.url, p.filename,
        p.uploaded_by_id AS uploadedById,
        COALESCE(u.first_name, u.display_name) AS uploadedByName,
        p.uploaded_at AS uploadedAt, p.taken_at AS takenAt, p.width, p.height, p.caption, p.location_id AS locationId,
        COALESCE((SELECT SUM(CASE is_super WHEN 1 THEN 3 ELSE 1 END) FROM photo_votes WHERE photo_id = p.id), 0) AS score,
        (SELECT react_type FROM photo_votes WHERE photo_id = p.id AND user_id = ?) AS userVote,
        (SELECT is_super FROM photo_votes WHERE photo_id = p.id AND user_id = ?) AS userIsSuper,
        (SELECT GROUP_CONCAT(pf.user_id) FROM photo_tagged pf WHERE pf.photo_id = p.id) AS taggedIds
      FROM photos p LEFT JOIN users u ON u.user_id = p.uploaded_by_id
      WHERE p.channel_id = ? ORDER BY p.id
    `).all(userId, userId, channelId) as RawRow[];
    return rows.map(toRow);
  }
  const rows = db.prepare(`
    SELECT p.id, p.channel_id AS channelId, p.url, p.filename,
      p.uploaded_by_id AS uploadedById,
      COALESCE(u.first_name, u.display_name) AS uploadedByName,
      p.uploaded_at AS uploadedAt, p.taken_at AS takenAt, p.width, p.height, p.caption, p.location_id AS locationId,
      COALESCE((SELECT SUM(CASE is_super WHEN 1 THEN 3 ELSE 1 END) FROM photo_votes WHERE photo_id = p.id), 0) AS score,
      NULL AS userVote,
      (SELECT GROUP_CONCAT(pf.user_id) FROM photo_tagged pf WHERE pf.photo_id = p.id) AS taggedIds
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
  const albums = (db.prepare(
    "SELECT channel_id AS channelId, group_name AS groupName, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM albums ORDER BY created_at DESC"
  ).all() as Omit<AlbumRow, "dateText">[]).map(toAlbumRow);
  const allLocs = db.prepare("SELECT channel_id AS channelId, id, name, lat, lon, geocode_attempted AS geocodeAttempted FROM album_locations ORDER BY sort_order, id").all() as (AlbumLocation & { channelId: string })[];
  const locMap = new Map<string, AlbumLocation[]>();
  for (const l of allLocs) {
    if (!locMap.has(l.channelId)) locMap.set(l.channelId, []);
    locMap.get(l.channelId)!.push({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, geocodeAttempted: l.geocodeAttempted });
  }
  return albums.map(a => ({ ...a, locations: locMap.get(a.channelId) ?? [], photos: dbGetPhotos(a.channelId), members: dbGetAlbumMembers(a.channelId) }));
}

export function dbInsertAlbum(album: AlbumRow) {
  db.prepare("INSERT OR REPLACE INTO albums (channel_id, group_name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(album.channelId, album.groupName, album.startDate ?? null, album.endDate ?? null, album.createdAt);
}

export function dbCreateAlbum(name: string, startDate: string, endDate?: string): AlbumRow {
  const channelId = "web_" + crypto.randomBytes(8).toString("hex");
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO albums (channel_id, group_name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(channelId, name, startDate, endDate ?? null, createdAt);
  return toAlbumRow({ channelId, groupName: name, startDate, endDate, createdAt });
}

export function dbSyncAlbumFromEvent(channelId: string, eventName: string) {
  db.prepare("UPDATE albums SET group_name=? WHERE channel_id=?")
    .run(eventName, channelId);
}

export function dbUpdateAlbum(channelId: string, name: string, startDate?: string, endDate?: string): AlbumRow | undefined {
  db.prepare("UPDATE albums SET group_name=?, start_date=?, end_date=? WHERE channel_id=?")
    .run(name, startDate ?? null, endDate ?? null, channelId);
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

export type UserRow = { userId: string; displayName: string; firstName?: string; avatarUrl?: string; lastSeenAt?: string; level: number; uploadCount?: number; taggedCount?: number };

export function dbUpsertUser(userId: string, displayName: string, avatarUrl?: string) {
  db.prepare(`
    INSERT INTO users (user_id, display_name, avatar_url) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, avatar_url=excluded.avatar_url
  `).run(userId, displayName, avatarUrl ?? null);
}

export function dbUpdateUserLastSeen(userId: string) {
  db.prepare("UPDATE users SET last_seen_at=? WHERE user_id=?").run(new Date().toISOString(), userId);
}

export function dbGetAllUsers(): UserRow[] {
  return db.prepare(`
    SELECT u.user_id AS userId, u.display_name AS displayName, u.first_name AS firstName,
      u.avatar_url AS avatarUrl, u.last_seen_at AS lastSeenAt, u.level,
      (SELECT COUNT(*) FROM photos p WHERE p.uploaded_by_id = u.user_id) AS uploadCount,
      (SELECT COUNT(*) FROM photo_tagged pt WHERE pt.user_id = u.user_id) AS taggedCount
    FROM users u WHERE u.level > 0 ORDER BY display_name ASC
  `).all() as UserRow[];
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
    SELECT u.user_id AS userId, u.display_name AS displayName, u.first_name AS firstName, u.avatar_url AS avatarUrl, u.last_seen_at AS lastSeenAt, u.level
    FROM album_members am JOIN users u ON u.user_id = am.user_id
    WHERE am.channel_id = ? AND am.hidden = 0 AND u.level > 0 ORDER BY u.display_name ASC
  `).all(channelId) as UserRow[];
}

export type AlbumMemberRow = UserRow & { hidden: number };

export function dbUpdateUserFirstName(userId: string, firstName: string | null) {
  db.prepare("UPDATE users SET first_name=? WHERE user_id=?").run(firstName || null, userId);
}

export function dbGetUserById(userId: string): UserRow | undefined {
  return db.prepare("SELECT user_id AS userId, display_name AS displayName, first_name AS firstName, avatar_url AS avatarUrl, last_seen_at AS lastSeenAt, level FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
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
    SELECT u.user_id AS userId, u.display_name AS displayName, u.first_name AS firstName, u.avatar_url AS avatarUrl, u.last_seen_at AS lastSeenAt, u.level, am.hidden
    FROM album_members am JOIN users u ON u.user_id = am.user_id
    WHERE am.channel_id = ? AND u.level > 0 ORDER BY am.hidden ASC, u.display_name ASC
  `).all(channelId) as AlbumMemberRow[];
}

export function dbAddUploadedPhoto(channelId: string, url: string, filename: string, uploadedById: string, width: number, height: number, takenAt?: string, caption?: string, discordMessageId?: string): PhotoRow {
  const uploadedAt = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO photos (channel_id, url, filename, uploaded_by_id, uploaded_at, taken_at, width, height, caption, discord_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(channelId, url, filename, uploadedById, uploadedAt, takenAt ?? null, width, height, caption ?? null, discordMessageId ?? null);
  return { id: result.lastInsertRowid as number, channelId, url, filename, uploadedById, uploadedAt, takenAt, width, height, caption };
}

export function dbGetPhotosByDiscordMessageId(messageId: string): { id: number }[] {
  return db.prepare("SELECT id FROM photos WHERE discord_message_id = ?").all(messageId) as { id: number }[];
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
  db.transaction(() => {
    db.prepare("DELETE FROM photo_votes WHERE photo_id = ?").run(photoId);
    db.prepare("DELETE FROM photo_tagged WHERE photo_id = ?").run(photoId);
    db.prepare("DELETE FROM photos WHERE id = ?").run(photoId);
  })();
  return row.filename;
}

export function dbCleanOrphanedPhotoData(): { votes: number; tags: number } {
  const votes = db.prepare("DELETE FROM photo_votes WHERE photo_id NOT IN (SELECT id FROM photos)").run().changes;
  const tags = db.prepare("DELETE FROM photo_tagged WHERE photo_id NOT IN (SELECT id FROM photos)").run().changes;
  return { votes, tags };
}

export function dbSetPhotoTagged(photoId: number, userIds: string[]): void {
  const del = db.prepare("DELETE FROM photo_tagged WHERE photo_id = ?");
  const ins = db.prepare("INSERT INTO photo_tagged (photo_id, user_id) VALUES (?, ?)");
  db.transaction(() => {
    del.run(photoId);
    for (const uid of userIds) ins.run(photoId, uid);
  })();
}

export function dbGetPhotoVotes(photoId: number): { userId: string; displayName: string; firstName: string | null; avatarUrl: string | null; reactType: string; isSuper: number }[] {
  return db.prepare(`
    SELECT pv.user_id as userId, u.display_name as displayName, u.first_name as firstName, u.avatar_url as avatarUrl, pv.react_type as reactType, pv.is_super as isSuper
    FROM photo_votes pv LEFT JOIN users u ON u.user_id = pv.user_id
    WHERE pv.photo_id = ?
    ORDER BY pv.is_super DESC, pv.photo_id
  `).all(photoId) as { userId: string; displayName: string; firstName: string | null; avatarUrl: string | null; reactType: string; isSuper: number }[];
}

export function dbListTables(): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(r => r.name);
}

export function dbTablePage(table: string, page: number, pageSize: number): { columns: string[]; rows: unknown[][]; total: number } {
  const allowed = dbListTables();
  if (!allowed.includes(table)) throw new Error(`Unknown table: ${table}`);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).raw().all(pageSize, page * pageSize) as unknown[][];
  const columns = db.prepare(`SELECT * FROM "${table}" LIMIT 0`).columns().map(c => c.name);
  return { columns, rows, total };
}

export function dbSetPhotoCaption(photoId: number, caption: string): void {
  db.prepare("UPDATE photos SET caption = ? WHERE id = ?").run(caption || null, photoId);
}

export function dbSearchPhotos(opts: {
  uploadedById?: string; taggedUserId?: string;
  sort: "newest" | "oldest" | "top" | "newest_taken" | "oldest_taken"; page: number; pageSize: number; userId?: string;
}): { photos: PhotoRow[]; total: number } {
  const { uploadedById, taggedUserId, sort, page, pageSize, userId } = opts;
  const where: string[] = [];
  const params: unknown[] = [];
  if (uploadedById) { where.push("p.uploaded_by_id = ?"); params.push(uploadedById); }
  if (taggedUserId) { where.push("EXISTS (SELECT 1 FROM photo_tagged pt WHERE pt.photo_id = p.id AND pt.user_id = ?)"); params.push(taggedUserId); }
  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
  const orderClause = sort === "oldest" ? "ORDER BY p.id ASC"
    : sort === "top" ? "ORDER BY score DESC, p.id DESC"
    : sort === "newest_taken" ? "ORDER BY CASE WHEN p.taken_at IS NULL THEN 1 ELSE 0 END, p.taken_at DESC, p.id DESC"
    : sort === "oldest_taken" ? "ORDER BY CASE WHEN p.taken_at IS NULL THEN 1 ELSE 0 END, p.taken_at ASC, p.id ASC"
    : "ORDER BY p.id DESC";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM photos p ${whereClause}`).get(...params) as { n: number }).n;
  type RawRow = PhotoRow & { taggedIds: string | null };
  const safeUid = userId?.replace(/'/g, "''");
  const userVoteExpr = userId
    ? `(SELECT react_type FROM photo_votes WHERE photo_id = p.id AND user_id = '${safeUid}') AS userVote, (SELECT is_super FROM photo_votes WHERE photo_id = p.id AND user_id = '${safeUid}') AS userIsSuper,`
    : "NULL AS userVote, NULL AS userIsSuper,";
  const rows = db.prepare(`
    SELECT p.id, p.channel_id AS channelId, p.url, p.filename,
      p.uploaded_by_id AS uploadedById,
      COALESCE(u.first_name, u.display_name) AS uploadedByName,
      p.uploaded_at AS uploadedAt, p.taken_at AS takenAt, p.width, p.height, p.caption, p.location_id AS locationId,
      COALESCE((SELECT SUM(CASE is_super WHEN 1 THEN 3 ELSE 1 END) FROM photo_votes WHERE photo_id = p.id), 0) AS score,
      ${userVoteExpr}
      (SELECT GROUP_CONCAT(pf.user_id) FROM photo_tagged pf WHERE pf.photo_id = p.id) AS taggedIds
    FROM photos p LEFT JOIN users u ON u.user_id = p.uploaded_by_id
    ${whereClause} ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, pageSize, page * pageSize) as RawRow[];
  const photos = rows.map(r => ({ ...r, taggedIds: r.taggedIds ? r.taggedIds.split(",") : [] }));
  return { photos, total };
}

export function dbVotePhoto(photoId: number, userId: string, reactType: string, isSuper: boolean): { score: number; userVote: string | null; userIsSuper: number } {
  const existing = db.prepare("SELECT react_type, is_super FROM photo_votes WHERE photo_id = ? AND user_id = ?").get(photoId, userId) as { react_type: string; is_super: number } | undefined;
  const isSameVote = existing?.react_type === reactType && !!existing?.is_super === isSuper;
  if (isSameVote) {
    db.prepare("DELETE FROM photo_votes WHERE photo_id = ? AND user_id = ?").run(photoId, userId);
  } else {
    db.prepare("INSERT OR REPLACE INTO photo_votes (photo_id, user_id, react_type, is_super) VALUES (?, ?, ?, ?)").run(photoId, userId, reactType, isSuper ? 1 : 0);
  }
  const scoreRow = db.prepare(
    "SELECT COALESCE(SUM(CASE is_super WHEN 1 THEN 3 ELSE 1 END), 0) AS score FROM photo_votes WHERE photo_id = ?"
  ).get(photoId) as { score: number };
  const voteRow = db.prepare("SELECT react_type, is_super FROM photo_votes WHERE photo_id = ? AND user_id = ?").get(photoId, userId) as { react_type: string; is_super: number } | undefined;
  return { score: scoreRow.score, userVote: voteRow?.react_type ?? null, userIsSuper: voteRow?.is_super ?? 0 };
}
