import http from "http";
import { PresenceUpdateStatus, type Client, type Guild, type Message, type Role } from "discord.js";
import { config } from "./config";
import { sendJson, send401, isValidSession, getSessionUser, getTokenFromRequest } from "./auth";
import { getBirthday } from "./birthdays";
import { dbCountDiscordMessage, dbRecordDiscordSamples, dbGetDiscordMembers, dbSetDiscordMemberNote, dbSetDiscordMemberRemoval, dbGetRealNamesByDiscordId, dbGetUserById, dbFindUserByDiscordId, dbAddDiscordUser, dbUpdateUserFirstName, dbUpdateUserSurname, REMOVAL_FLAGS, type RemovalFlag } from "./db";

// The member list on the site's /snek page, and the stats behind it. Discord keeps no history of
// who was online or in voice, so the bot samples everyone once a minute and adds it up itself.

const SAMPLE_INTERVAL_S = 60;
const MAX_NOTE_LENGTH = 500;
const MAX_NAME_LENGTH = 60;

let client: Client | null = null;
let presenceTracking = false;

// Discord only sends presences to bots that have the Presence intent switched on in the Developer
// Portal, and asking for it without that refuses the login. So check before asking.
export async function hasPresenceIntent(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://discord.com/api/v10/applications/@me", { headers: { Authorization: `Bot ${token}` } });
    if (!res.ok) return false;
    const flags = Number(((await res.json()) as { flags?: number }).flags ?? 0);
    const GATEWAY_PRESENCE = 1 << 12, GATEWAY_PRESENCE_LIMITED = 1 << 13;
    return (flags & (GATEWAY_PRESENCE | GATEWAY_PRESENCE_LIMITED)) !== 0;
  } catch { return false; }
}

export function startSnekTracking(readyClient: Client, withPresences: boolean) {
  client = readyClient;
  presenceTracking = withPresences;
  console.log(`Snek member tracking started (${withPresences ? "with" : "without"} presences).`);
  const guild = readyClient.guilds.cache.get(config.guildId);
  // Load everyone (and their status) into the cache, so the sampler and the page see the whole server.
  guild?.members.fetch({ withPresences }).catch(e => console.error("Snek member fetch failed:", e));
  setInterval(sample, SAMPLE_INTERVAL_S * 1000);
}

function sample() {
  const guild = client?.guilds.cache.get(config.guildId);
  if (!guild) return;
  const samples = [...guild.members.cache.values()].filter(m => !m.user.bot).map(m => ({
    discordId: m.id,
    online: presenceTracking ? !!m.presence && m.presence.status !== PresenceUpdateStatus.Offline : null,
    inVoice: !!m.voice.channelId && m.voice.channelId !== guild.afkChannelId,
  }));
  try { dbRecordDiscordSamples(samples, SAMPLE_INTERVAL_S); } catch (e) { console.error("Snek sample failed:", e); }
}

export function countSnekMessage(message: Message) {
  if (message.guildId !== config.guildId || message.author.bot) return;
  try { dbCountDiscordMessage(message.author.id); } catch (e) { console.error("Snek message count failed:", e); }
}

// Who counts as a Snek: SNEK_ROLE_ID if set, otherwise the role called "Snek" or "Sneks".
function snekRole(guild: Guild): Role | undefined {
  const id = process.env.SNEK_ROLE_ID;
  if (id) return guild.roles.cache.get(id);
  return guild.roles.cache.find(r => /^sneks?$/i.test(r.name));
}

// Real names are the site's, shared with the Users page, so only admins change them (as there).
const isAdmin = (userId: string) => (dbGetUserById(userId)?.level ?? 0) >= 2;

// Who made a change, as shown on hover: their first name on the site, else their Discord name.
function editorName(token: string): string {
  const user = getSessionUser(token)!;
  return dbGetUserById(user.userId)?.firstName || user.displayName;
}

function listMembers(viewerId: string) {
  const guild = client?.guilds.cache.get(config.guildId);
  if (!guild) return null;
  const role = snekRole(guild);
  const stats = new Map(dbGetDiscordMembers().map(s => [s.discordId, s]));
  const realNames = dbGetRealNamesByDiscordId();
  const trackingSince = [...stats.values()].reduce<string | null>((min, s) => !min || s.firstTrackedAt < min ? s.firstTrackedAt : min, null);
  const latest = (...dates: (string | null | undefined)[]) => dates.filter((d): d is string => !!d).sort().pop() ?? null;

  const members = [...guild.members.cache.values()].filter(m => !m.user.bot).map(m => {
    const s = stats.get(m.id);
    const name = realNames.get(m.id);
    return {
      discordId: m.id,
      displayName: m.displayName,
      username: m.user.username,
      avatarUrl: m.displayAvatarURL({ extension: "png", size: 64 }),
      isSnek: !!role && m.roles.cache.has(role.id),
      joinedAt: m.joinedAt?.toISOString() ?? null,
      birthday: getBirthday(m.id) ?? null,
      realName: name ? [name.firstName, name.surname].filter(Boolean).join(" ") : null,
      status: presenceTracking ? (m.presence?.status ?? "offline") : null,
      note: s?.note ?? null,
      noteBy: s?.noteBy ?? null,
      noteAt: s?.noteAt ?? null,
      removal: (Object.keys(REMOVAL_FLAGS) as RemovalFlag[]).find(k => REMOVAL_FLAGS[k] === s?.removalFlag) ?? null,
      removalBy: s?.removalBy ?? null,
      removalAt: s?.removalAt ?? null,
      messageCount: s?.messageCount ?? 0,
      voiceSeconds: s?.voiceSeconds ?? 0,
      onlinePct: s && s.presenceSeconds > 0 ? Math.round(100 * s.onlineSeconds / s.presenceSeconds) : null,
      lastSeenAt: latest(s?.lastOnlineAt, s?.lastMessageAt, s?.lastVoiceAt),
    };
  });
  return { snekRole: role?.name ?? null, presenceTracking, trackingSince, canEditNames: isAdmin(viewerId), members };
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// GET /api/snek/members and PUT /api/snek/members/:id/(note|removal|name), for
// web/src/views/SnekView.vue. Any logged-in user can read the list and set the notes and removal
// flags, which everyone sees; names are admin-only.
export function handleSnekRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  if (!url.startsWith("/api/snek/")) return false;
  const method = req.method ?? "GET";
  const token = getTokenFromRequest(req);
  if (!isValidSession(token)) { send401(res); return true; }

  if (url === "/api/snek/members" && method === "GET") {
    const list = listMembers(getSessionUser(token)!.userId);
    if (!list) sendJson(res, 503, { error: "The bot isn't connected to the server right now." });
    else sendJson(res, 200, list);
    return true;
  }

  const noteMatch = url.match(/^\/api\/snek\/members\/(\d+)\/note$/);
  if (noteMatch && method === "PUT") {
    readJson(req).then(body => {
      const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
      const by = editorName(token);
      dbSetDiscordMemberNote(noteMatch[1], note || null, by);
      sendJson(res, 200, { note: note || null, noteBy: by, noteAt: new Date().toISOString() });
    }).catch(() => sendJson(res, 400, { error: "Bad request" }));
    return true;
  }

  // { removal: "delete" | "maybe" | null }: the "thinking of removing them" flag.
  const removalMatch = url.match(/^\/api\/snek\/members\/(\d+)\/removal$/);
  if (removalMatch && method === "PUT") {
    readJson(req).then(body => {
      const flag = body.removal === "delete" || body.removal === "maybe" ? body.removal : null;
      const by = editorName(token);
      dbSetDiscordMemberRemoval(removalMatch[1], flag, by);
      sendJson(res, 200, { removal: flag, removalBy: flag ? by : null, removalAt: flag ? new Date().toISOString() : null });
    }).catch(() => sendJson(res, 400, { error: "Bad request" }));
    return true;
  }

  // { name: "First Surname" }: the first word is the first name, the rest the surname. A member the
  // site doesn't know yet gets a site user, the same as adding them on the Users page.
  const nameMatch = url.match(/^\/api\/snek\/members\/(\d+)\/name$/);
  if (nameMatch && method === "PUT") {
    if (!isAdmin(getSessionUser(token)!.userId)) { sendJson(res, 403, { error: "Only admins can edit names" }); return true; }
    readJson(req).then(body => {
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) : "";
      const discordId = nameMatch[1];
      let userId = dbFindUserByDiscordId(discordId)?.userId;
      if (!userId) {
        const member = client?.guilds.cache.get(config.guildId)?.members.cache.get(discordId);
        if (!member) { sendJson(res, 404, { error: "Not a member of the server" }); return; }
        dbAddDiscordUser(discordId, member.user.displayName, member.user.displayAvatarURL({ extension: "png", size: 128 }));
        userId = discordId;
      }
      const [firstName, ...rest] = name ? name.split(" ") : [];
      dbUpdateUserFirstName(userId, firstName ?? null);
      dbUpdateUserSurname(userId, rest.join(" ") || null);
      sendJson(res, 200, { realName: name || null });
    }).catch(() => sendJson(res, 400, { error: "Bad request" }));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
