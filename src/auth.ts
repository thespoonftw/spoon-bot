import type { Client } from "discord.js";
import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./state";
import { dbUpsertUser, dbUpdateUserLastLogin, dbGetAllUsers } from "./db";

const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const ALLOWED_USER_IDS = (process.env.AUTH_USER_IDS ?? "148516020007600128").split(",");

type UserInfo = { userId: string; displayName: string; avatarUrl: string };
type MagicToken = { userId: string; expires: number };

let discordClient: Client | null = null;
const userInfoCache = new Map<string, UserInfo>();
const magicTokens = new Map<string, MagicToken>();
// token → userId
let sessions = new Map<string, string>();

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
    // Support old format (array of tokens) — migrate to map
    if (Array.isArray(raw)) {
      sessions = new Map(raw.map((t: string) => [t, ALLOWED_USER_IDS[0]]));
    } else {
      sessions = new Map(Object.entries(raw));
    }
    console.log(`Loaded ${sessions.size} session(s) from disk.`);
  } catch (e) { console.error("Failed to load sessions:", e); }
}

function persistSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
}

export async function initAuth(client: Client) {
  discordClient = client;
  loadSessions();
  for (const userId of ALLOWED_USER_IDS) {
    try {
      const user = await client.users.fetch(userId);
      const info = { userId, displayName: user.displayName, avatarUrl: user.displayAvatarURL({ extension: "png", size: 128 }) };
      userInfoCache.set(userId, info);
      dbUpsertUser(userId, info.displayName, info.avatarUrl);
    } catch (e) {
      console.error(`Failed to fetch user ${userId}:`, e);
      userInfoCache.set(userId, { userId, displayName: userId, avatarUrl: "" });
    }
  }
}

export function isValidSession(token: string): boolean {
  return sessions.has(token);
}

export function getSessionUser(token: string): UserInfo | null {
  const userId = sessions.get(token);
  if (!userId) return null;
  if (userInfoCache.has(userId)) return userInfoCache.get(userId)!;
  const dbUser = dbGetAllUsers().find(u => u.userId === userId);
  if (dbUser) return { userId, displayName: dbUser.displayName, avatarUrl: dbUser.avatarUrl ?? "" };
  return { userId, displayName: userId, avatarUrl: "" };
}

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

// Returns true if the request was handled
export function handleAuthRoutes(req: IncomingMessage, res: ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  if (url === "/api/users" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(dbGetAllUsers()));
    return true;
  }

  if (url === "/api/auth/request" && method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { userId } = JSON.parse(body);
        const allUsers = dbGetAllUsers();
        if (!allUsers.some(u => u.userId === userId)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not allowed" })); return;
        }
        const token = crypto.randomBytes(32).toString("hex");
        magicTokens.set(token, { userId, expires: Date.now() + 15 * 60 * 1000 });
        const link = `${getBaseUrl()}/auth/verify/${token}`;
        const user = await discordClient!.users.fetch(userId);
        await user.send(`🔗 Click here to log in to the Snek site:\n${link}\n\n*This link expires in 15 minutes.*`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error("Auth request error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to send DM" }));
      }
    });
    return true;
  }

  if (url.startsWith("/api/auth/verify/") && method === "GET") {
    const token = url.slice("/api/auth/verify/".length);
    const magic = magicTokens.get(token);
    if (!magic || magic.expires < Date.now()) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired token" })); return true;
    }
    magicTokens.delete(token);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionToken, magic.userId);
    persistSessions();
    dbUpdateUserLastLogin(magic.userId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessionToken, userId: magic.userId }));
    return true;
  }

  if (url === "/api/auth/check" && method === "GET") {
    const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
    const userId = sessions.get(token);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ valid: false }));
    } else {
      const user = userInfoCache.get(userId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ valid: true, userId, displayName: user?.displayName ?? userId, avatarUrl: user?.avatarUrl ?? "" }));
    }
    return true;
  }

  if (url === "/api/site-users" && method === "GET") {
    const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
    if (!sessions.has(token)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(dbGetAllUsers()));
    return true;
  }

  if (url === "/api/auth/logout" && method === "POST") {
    const token = (req.headers["authorization"] ?? "").replace("Bearer ", "");
    sessions.delete(token);
    persistSessions();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}
