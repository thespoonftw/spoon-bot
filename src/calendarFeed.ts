import http from "http";
import crypto from "crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Interaction } from "discord.js";
import { eventStates } from "./state";
import { config } from "./config";
import { sessionFromDateText } from "./dateUtils";
import { SUBSCRIBE_ID } from "./eventBuilders";
import { dbGetCalendarToken, dbSetCalendarToken, dbFindDiscordIdByCalendarToken } from "./db";
import type { EventState, RSVPStatus } from "./types";

// Calendar feeds of the brunch events, for subscribing to in Google, Apple or Outlook calendars.
// Each Discord member has two, behind a secret token in the URL (calendar apps fetch feeds without logging in):
//   /calendar/<token>/all.ics     every event with a date
//   /calendar/<token>/joined.ics  just the events whose channels they've joined
// The feeds are built from the live event list on each fetch, so date changes, RSVPs and deleted
// events reach people's calendars the next time their app checks the feed. People get their links
// from the 📅 Subscribe button on an event, or /calendar.

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";
const TZID = "Europe/London";
// How long an event without an end time is shown as lasting (matches the Discord scheduled events).
const DEFAULT_DURATION_MIN = 120;

type Feed = "all" | "joined";
const FEED_NAMES: Record<Feed, string> = { all: "All brunch events", joined: "Events I've joined" };
type LocalTime = { y: number; m: number; d: number; hh: number; mm: number; allDay: boolean };

function parseLocal(dateText: string | undefined): LocalTime | null {
  if (!dateText || dateText === "TBC") return null;
  const s = sessionFromDateText(dateText);
  if (!s?.day || !s.month || !s.year) return null;
  const allDay = { y: s.year, m: s.month, d: s.day, hh: 0, mm: 0, allDay: true };
  if (!s.time || s.time === "All Day") return allDay;
  // Times typed in /event are free text ("19:00", "7pm", "7.30 pm", "10am"); anything else shows as all day.
  const t = s.time.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (!t) return allDay;
  let hh = parseInt(t[1]);
  const mm = t[2] ? parseInt(t[2]) : 0;
  const ampm = t[3]?.toLowerCase();
  if (ampm === "pm" && hh < 12) hh += 12;
  if (ampm === "am" && hh === 12) hh = 0;
  if (hh > 23 || mm > 59 || (!ampm && !t[2])) return allDay; // a bare "7" is too ambiguous
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
  lines.push(`STATUS:${myStatus === "maybe" || myStatus === "lurking" ? "TENTATIVE" : "CONFIRMED"}`);
  // Only events they've joined make them look busy (the "all" feed has the rest too).
  lines.push(`TRANSP:${isJoined(myStatus) ? "OPAQUE" : "TRANSPARENT"}`, "END:VEVENT");
  return lines;
}

// A joined event is one whose channel they're in, unless they've declined it.
const isJoined = (status: RSVPStatus | undefined) => !!status && status !== "decline";

function buildFeed(feed: Feed, discordId: string): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brunch Projects//Brunch events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${FEED_NAMES[feed]}`, `X-WR-TIMEZONE:${TZID}`,
    // Hints for how often to re-check (Apple and Outlook take some notice; Google ignores them).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
  ];
  for (const [channelId, state] of eventStates) {
    const myStatus = state.members.get(discordId)?.status;
    if (feed === "joined" && !isJoined(myStatus)) continue;
    if (state.private && !state.members.has(discordId) && !state.invitedIds?.includes(discordId)) continue;
    const ev = eventLines(channelId, state, myStatus, stamp);
    if (ev) lines.push(...ev);
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

function tokenFor(discordId: string): string {
  let token = dbGetCalendarToken(discordId);
  if (!token) { token = newToken(); dbSetCalendarToken(discordId, token); }
  return token;
}

export function handleCalendarRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  // /calendar/<token>/<feed>.ics is the feed; /calendar/<token>/<feed>/apple sends Apple devices on to
  // its webcal:// address (Discord buttons can only link to http(s), and webcal is what opens Apple Calendar).
  const m = url.match(/^\/calendar\/([A-Za-z0-9_-]{16,64})\/(all|joined)(\.ics|\/apple)$/);
  if (!m) return false;
  const discordId = dbFindDiscordIdByCalendarToken(m[1]);
  if (!discordId) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return true; }
  const feed = m[2] as Feed;

  if (m[3] === "/apple") {
    res.writeHead(302, { Location: webcalUrl(feedUrl(m[1], feed)), "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  res.writeHead(200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="brunch-${feed}.ics"`,
    "Cache-Control": "no-cache",
  });
  res.end(method === "HEAD" ? undefined : buildFeed(feed, discordId));
  return true;
}

// ── Discord: the 📅 Subscribe button on events (and /calendar) ──────────────────────────────────────

const feedUrl = (token: string, feed: Feed) => `${getBaseUrl().replace(/\/$/, "")}/calendar/${token}/${feed}.ics`;
const webcalUrl = (url: string) => url.replace(/^https?:\/\//, "webcal://");

function subscribeMessage(discordId: string) {
  const token = tokenFor(discordId);
  const row = (feed: Feed) => {
    const url = feedUrl(token, feed);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cal_label_${feed}`).setLabel(FEED_NAMES[feed]).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Google").setURL(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Apple").setURL(url.replace(/\.ics$/, "/apple")),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Outlook").setURL(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(FEED_NAMES[feed])}`),
    );
  };
  return {
    content: [
      "**📅 Add the brunch events to your calendar**",
      "Subscribe once and they stay up to date as events change (Google can take up to a day to catch up).",
      `- **${FEED_NAMES.all}:** every event with a date.`,
      `- **${FEED_NAMES.joined}:** just the events whose channels you've joined (leaving out any you've declined).`,
      "",
      "-# These links are just for you. If you've shared one by mistake, reset them; calendars using the old ones stop updating.",
    ].join("\n"),
    components: [
      row("all"),
      row("joined"),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("cal_reset").setLabel("Reset my links").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

export async function handleCalendarInteraction(interaction: Interaction): Promise<boolean> {
  if ((interaction.isButton() && interaction.customId === SUBSCRIBE_ID) || (interaction.isChatInputCommand() && interaction.commandName === "calendar")) {
    await interaction.reply({ ...subscribeMessage(interaction.user.id), ephemeral: true });
    return true;
  }
  if (interaction.isButton() && interaction.customId === "cal_reset") {
    dbSetCalendarToken(interaction.user.id, newToken());
    await interaction.update(subscribeMessage(interaction.user.id));
    return true;
  }
  return false;
}
