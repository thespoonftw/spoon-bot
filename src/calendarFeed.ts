import http from "http";
import crypto from "crypto";
import { eventStates } from "./state";
import { config } from "./config";
import { sessionFromDateText } from "./dateUtils";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbGetUserById, dbFindUserByDiscordId, dbGetCalendarToken, dbSetCalendarToken, dbFindUserByCalendarToken } from "./db";
import type { Interaction } from "discord.js";
import type { EventState, RSVPStatus } from "./types";

// Calendar feeds of the brunch events, for subscribing to in Google, Apple or Outlook calendars.
// Each person has two, behind a secret token in the URL (calendar apps fetch feeds without logging in):
//   /calendar/<token>/all.ics   every event with a date
//   /calendar/<token>/mine.ics  just the ones they've said they're coming to (or maybe)
// The feeds are built from the live event list on each fetch, so date changes, RSVPs and deleted
// events reach people's calendars the next time their app checks the feed.

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";
const TZID = "Europe/London";
// How long an event without an end time is shown as lasting (matches the Discord scheduled events).
const DEFAULT_DURATION_MIN = 120;

type Feed = "all" | "mine";
type LocalTime = { y: number; m: number; d: number; hh: number; mm: number; allDay: boolean };

function parseLocal(dateText: string | undefined): LocalTime | null {
  if (!dateText || dateText === "TBC") return null;
  const s = sessionFromDateText(dateText);
  if (!s?.day || !s.month || !s.year) return null;
  if (!s.time || s.time === "All Day") return { y: s.year, m: s.month, d: s.day, hh: 0, mm: 0, allDay: true };
  const [hh, mm] = s.time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return { y: s.year, m: s.month, d: s.day, hh, mm, allDay: false };
}

// Wall-clock arithmetic: the times stay in London local time, so UTC is just a handy calendar here.
function shift(t: LocalTime, minutes: number): LocalTime {
  const dt = new Date(Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mm) + minutes * 60_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), allDay: t.allDay };
}

const pad = (n: number) => String(n).padStart(2, "0");
const icsDate = (t: LocalTime) => `${t.y}${pad(t.m)}${pad(t.d)}`;
const icsDateTime = (t: LocalTime) => `${icsDate(t)}T${pad(t.hh)}${pad(t.mm)}00`;

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// iCalendar lines are at most 75 bytes; longer ones continue on the next line after a space.
function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (curBytes + b > limit) { out.push(cur); cur = ""; curBytes = 0; }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", `TZID:${TZID}`,
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

function attendeeList(state: EventState, status: RSVPStatus): string {
  return [...state.members.values()]
    .filter(m => m.status === status)
    .map(m => m.plusOne > 0 ? `${m.displayName} (+${m.plusOne})` : m.displayName)
    .join(", ");
}

function eventLines(channelId: string, state: EventState, myStatus: RSVPStatus | undefined, stamp: string): string[] | null {
  const start = parseLocal(state.dateText);
  if (!start) return null;
  let end = parseLocal(state.endDateText);
  const lines = ["BEGIN:VEVENT", `UID:event-${channelId}@brunch-projects`, `DTSTAMP:${stamp}`];

  if (start.allDay) {
    // All-day events end (exclusively) the day after their last day.
    const lastDay = end && icsDate(end) >= icsDate(start) ? end : start;
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(shift({ ...lastDay, hh: 0, mm: 0 }, 24 * 60))}`);
  } else {
    if (end?.allDay) end = shift({ ...end, hh: 0, mm: 0, allDay: false }, 24 * 60); // to the end of that day
    if (!end || icsDateTime(end) <= icsDateTime(start)) end = shift(start, DEFAULT_DURATION_MIN);
    lines.push(`DTSTART;TZID=${TZID}:${icsDateTime(start)}`, `DTEND;TZID=${TZID}:${icsDateTime(end)}`);
  }

  const discordUrl = `https://discord.com/channels/${config.guildId}/${channelId}`;
  const coming = attendeeList(state, "coming");
  const maybe = attendeeList(state, "maybe");
  const description = [
    state.description,
    coming && `Coming: ${coming}`,
    maybe && `Maybe: ${maybe}`,
    `Discord: ${discordUrl}`,
  ].filter(Boolean).join("\n\n");

  lines.push(`SUMMARY:${escapeText(state.eventName)}`);
  if (state.location) lines.push(`LOCATION:${escapeText(state.location)}`);
  lines.push(`DESCRIPTION:${escapeText(description)}`, `URL:${discordUrl}`);
  lines.push(`STATUS:${myStatus === "maybe" ? "TENTATIVE" : "CONFIRMED"}`);
  // Only events they're going to make them look busy (the "all" feed has the rest too).
  lines.push(`TRANSP:${myStatus === "coming" || myStatus === "maybe" ? "OPAQUE" : "TRANSPARENT"}`, "END:VEVENT");
  return lines;
}

function buildFeed(feed: Feed, discordId: string): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const name = feed === "all" ? "Brunch events" : "My brunch events";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brunch Projects//Brunch events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${name}`, `X-WR-TIMEZONE:${TZID}`,
    // Hints for how often to re-check (Apple and Outlook take some notice; Google ignores them).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
  ];
  for (const [channelId, state] of eventStates) {
    const myStatus = state.members.get(discordId)?.status;
    if (feed === "mine" && myStatus !== "coming" && myStatus !== "maybe") continue;
    const ev = eventLines(channelId, state, myStatus, stamp);
    if (ev) lines.push(...ev);
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function feedUrls(token: string) {
  const base = getBaseUrl().replace(/\/$/, "");
  return { all: `${base}/calendar/${token}/all.ics`, mine: `${base}/calendar/${token}/mine.ics` };
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

// The upcoming events, for the calendar page to list (with the viewer's own RSVP).
function upcomingEvents(discordId: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZID }).replace(/-/g, "");
  return [...eventStates.entries()]
    .map(([channelId, s]) => ({ channelId, s, start: parseLocal(s.dateText), end: parseLocal(s.endDateText) }))
    .filter(e => e.start && icsDate(e.end ?? e.start!) >= today)
    .sort((a, b) => icsDateTime(a.start!).localeCompare(icsDateTime(b.start!)))
    .map(({ channelId, s }) => {
      const status = s.members.get(discordId)?.status;
      return {
        channelId, name: s.eventName, dateText: s.dateText, endDateText: s.endDateText ?? null, location: s.location || null,
        myStatus: status === "coming" || status === "maybe" ? status : null,
      };
    });
}

export function handleCalendarRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  const feedMatch = url.match(/^\/calendar\/([A-Za-z0-9_-]{16,64})\/(all|mine)\.ics$/);
  if (feedMatch && (method === "GET" || method === "HEAD")) {
    const user = dbFindUserByCalendarToken(feedMatch[1]);
    // Hidden (level 0) users and anyone no longer linked to Discord lose their feeds.
    if (!user || (user.level ?? 0) < 1 || !user.discordId) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return true; }
    const body = buildFeed(feedMatch[2] as Feed, user.discordId);
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="brunch-${feedMatch[2]}.ics"`,
      "Cache-Control": "no-cache",
    });
    res.end(method === "HEAD" ? undefined : body);
    return true;
  }

  if (url === "/api/calendar" && method === "GET") {
    const session = getSessionUser(getTokenFromRequest(req));
    if (!session) { send401(res); return true; }
    const user = dbGetUserById(session.userId);
    if (!user?.discordId) { sendJson(res, 200, { linked: false, events: [] }); return true; }
    let token = dbGetCalendarToken(user.userId);
    if (!token) { token = newToken(); dbSetCalendarToken(user.userId, token); }
    sendJson(res, 200, { linked: true, feeds: feedUrls(token), events: upcomingEvents(user.discordId) }, { "Cache-Control": "no-store" });
    return true;
  }

  // A new token, for if the links were shared by mistake. Calendars subscribed with the old ones stop updating.
  if (url === "/api/calendar/reset" && method === "POST") {
    const session = getSessionUser(getTokenFromRequest(req));
    if (!session) { send401(res); return true; }
    const user = dbGetUserById(session.userId);
    if (!user?.discordId) { sendJson(res, 400, { error: "Your account isn't linked to Discord." }); return true; }
    const token = newToken();
    dbSetCalendarToken(user.userId, token);
    sendJson(res, 200, { feeds: feedUrls(token) });
    return true;
  }

  return false;
}

// /calendar in Discord: the person's own subscribe links, visible only to them. Discord only makes
// http(s) links clickable, so Apple's webcal:// subscribe is left to the calendar page.
export async function handleCalendarInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "calendar") return false;
  const page = `${getBaseUrl().replace(/\/$/, "")}/calendar`;
  const user = dbFindUserByDiscordId(interaction.user.id);
  if (!user || (user.level ?? 0) < 1) {
    await interaction.reply({ content: `You need a Brunch Projects account to subscribe to the brunch calendar. Ask an admin to add you, then see ${page}`, ephemeral: true });
    return true;
  }
  let token = dbGetCalendarToken(user.userId);
  if (!token) { token = newToken(); dbSetCalendarToken(user.userId, token); }
  const feeds = feedUrls(token);
  const webcal = (u: string) => u.replace(/^https?:\/\//, "webcal://");
  const google = (u: string) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal(u))}`;
  const outlook = (u: string, name: string) => `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(u)}&name=${encodeURIComponent(name)}`;
  const content = [
    "**📅 Brunch Calendar**: subscribe once and the events appear in your own calendar, keeping up with changes.",
    "",
    `**My brunch events** (ones you're coming to or maybe): [Google](<${google(feeds.mine)}>) · [Outlook](<${outlook(feeds.mine, "My brunch events")}>)`,
    `**All brunch events**: [Google](<${google(feeds.all)}>) · [Outlook](<${outlook(feeds.all, "All brunch events")}>)`,
    "",
    `iPhone / Apple Calendar, and the links to copy: <${page}>`,
    "These links are private to you, so don't share them.",
  ].join("\n");
  await interaction.reply({ content, ephemeral: true });
  return true;
}
