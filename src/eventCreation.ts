import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { Client, Guild, TextChannel } from "discord.js";
import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { eventStates, persistState, DATA_DIR } from "./state";
import type { EventState } from "./types";
import { makeMemberEntry } from "./types";
import { buildJoinContent, buildJoinEmbed, buildInnerEmbed, joinMessageComponents, pinMessageComponents, pinMessageContent } from "./eventBuilders";
import { startAlbumForChannel } from "./albums";
import { DAYS, MONTHS } from "./dateUtils";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbGetUserById } from "./db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: Buffer) => { rotate(): { resize(w: number, h: number, o: object): { jpeg(o: object): { toFile(p: string): Promise<unknown> } } } };

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";
const IMAGE_DIR = path.join(DATA_DIR, "event-images");
const IMAGE_NAME = /^[a-f0-9]{32}\.jpg$/;
const MAX_UPLOAD = 15 * 1024 * 1024;

export type NewEvent = {
  eventName: string; description: string; location: string; dateText: string; endDateText?: string;
  imageUrl?: string; rsvpEnabled?: boolean; album?: boolean;
};

// Sets up an event in `channel`: the pinned RSVP card inside it and the join card in the events channel.
export async function setUpEvent(guild: Guild, channel: TextChannel, creatorId: string, creatorName: string, ev: NewEvent): Promise<void> {
  const state: EventState = {
    eventName: ev.eventName, description: ev.description, location: ev.location || "TBC",
    dateText: ev.dateText, endDateText: ev.endDateText,
    joinMessageId: "", pinMessageId: "",
    joiningEnabled: true, members: new Map(),
    creatorId,
    ...(ev.rsvpEnabled === false ? { rsvpEnabled: false } : {}),
    ...(ev.imageUrl ? { imageUrl: ev.imageUrl } : {}),
  };
  state.members.set(creatorId, makeMemberEntry(creatorId, creatorName));
  const dated = ev.dateText !== "TBC";

  const albumUrl = ev.album ? await startAlbumForChannel(channel.id, guild, ev.eventName) : undefined;
  const pinMsg = await channel.send({
    content: pinMessageContent(state) || undefined,
    embeds: [buildInnerEmbed(state, albumUrl)],
    components: pinMessageComponents(channel.id, dated, ev.rsvpEnabled !== false),
  });
  await pinMsg.pin();

  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (announcementChannel?.isSendable()) {
    const joinMsg = await announcementChannel.send({
      content: buildJoinContent(state),
      embeds: [buildJoinEmbed(state)],
      components: joinMessageComponents(channel.id, true, dated),
    });
    state.joinMessageId = joinMsg.id;
  }

  state.pinMessageId = pinMsg.id;
  eventStates.set(channel.id, state);
  persistState();
  if (!dated) await channel.send("Use the ⚙ button to set the event date when you're ready.");
}

// Makes a new private event channel for the creator and sets the event up in it.
export async function createEvent(guild: Guild, creatorId: string, creatorName: string, ev: NewEvent): Promise<TextChannel> {
  const channel = await guild.channels.create({
    name: ev.eventName.toLowerCase().replace(/\s+/g, "-").slice(0, 100),
    type: ChannelType.GuildText,
    parent: config.eventCategoryId,
    topic: ev.description ? ev.description.slice(0, 1024) : undefined,
  });
  await channel.permissionOverwrites.set([
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: creatorId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ]);
  await setUpEvent(guild, channel, creatorId, creatorName, ev);
  return channel;
}

// "2026-12-05" + "19:30" (or "") → "Sat 5 December 2026, 19:30" / "…, All Day", the format the bot stores.
function toDateText(date: string, time: string): string | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${DAYS[d.getDay()]} ${day} ${MONTHS[month - 1]} ${year}, ${time || "All Day"}`;
}

let discordClient: Client | null = null;
export function setEventDiscordClient(client: Client) { discordClient = client; }

// POST /api/events — the website's Create Event form (opened from /event in Discord).
export function handleEventRoutes(req: IncomingMessage, res: ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];

  // GET /event-images/:name — public, because Discord fetches it to show on the event cards.
  if (url.startsWith("/event-images/") && req.method === "GET") {
    const name = url.slice("/event-images/".length);
    const file = path.join(IMAGE_DIR, name);
    if (!IMAGE_NAME.test(name) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  // POST /api/events/image — the raw image file as the body; it comes back as a hosted link for the form.
  if (url === "/api/events/image" && req.method === "POST") {
    if (!getSessionUser(getTokenFromRequest(req))) { send401(res); return true; }
    if (!String(req.headers["content-type"] ?? "").startsWith("image/")) { sendJson(res, 400, { error: "That isn't an image." }); return true; }
    const chunks: Buffer[] = [];
    let size = 0, tooBig = false;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_UPLOAD) tooBig = true; else chunks.push(c); });
    req.on("end", async () => {
      if (tooBig) { sendJson(res, 413, { error: "That image is too big (15 MB max)." }); return; }
      try {
        fs.mkdirSync(IMAGE_DIR, { recursive: true });
        const name = `${crypto.randomBytes(16).toString("hex")}.jpg`;
        await sharp(Buffer.concat(chunks)).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(IMAGE_DIR, name));
        sendJson(res, 201, { url: `${getBaseUrl()}/event-images/${name}` });
      } catch (e) {
        console.error("Event image upload failed:", e);
        sendJson(res, 400, { error: "Couldn't read that image. Try a JPG or PNG." });
      }
    });
    return true;
  }

  if (url !== "/api/events" || req.method !== "POST") return false;

  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) { send401(res); return true; }
  let body = "";
  req.on("data", chunk => { body += chunk; if (body.length > 20_000) req.destroy(); });
  req.on("end", async () => {
    try {
      const b = JSON.parse(body) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const eventName = str(b.name), description = str(b.description), location = str(b.location);
      const date = str(b.date), time = str(b.time), endDate = str(b.endDate), endTime = str(b.endTime);
      const imageUrl = str(b.imageUrl);
      if (imageUrl && (imageUrl.length > 1000 || !/^https?:\/\/\S+$/i.test(imageUrl))) { sendJson(res, 400, { error: "The image link should start with https://" }); return; }

      if (!eventName) { sendJson(res, 400, { error: "Give the event a name." }); return; }
      if (eventName.length > 100) { sendJson(res, 400, { error: "The name can be at most 100 characters." }); return; }
      if (description.length > 3500) { sendJson(res, 400, { error: "The description can be at most 3500 characters." }); return; }
      if (location.length > 200) { sendJson(res, 400, { error: "The location can be at most 200 characters." }); return; }

      let dateText = "TBC";
      let endDateText: string | undefined;
      if (date) {
        const t = toDateText(date, time);
        if (!t) { sendJson(res, 400, { error: "That start date or time isn't valid." }); return; }
        dateText = t;
        if (endDate) {
          const e = toDateText(endDate, endTime);
          if (!e) { sendJson(res, 400, { error: "That end date or time isn't valid." }); return; }
          if (`${endDate}T${endTime || "23:59"}` < `${date}T${time || "00:00"}`) { sendJson(res, 400, { error: "The event can't end before it starts." }); return; }
          endDateText = e;
        }
      }

      const discordId = dbGetUserById(user.userId)?.discordId;
      const guild = discordClient?.guilds.cache.get(config.guildId);
      if (!guild) { sendJson(res, 503, { error: "The bot isn't connected to Discord right now. Try again in a minute." }); return; }
      const member = discordId ? await guild.members.fetch(discordId).catch(() => null) : null;
      if (!member) { sendJson(res, 403, { error: "Only members of the Discord server can create events." }); return; }

      const channel = await createEvent(guild, member.id, member.displayName, {
        eventName, description, location, dateText, endDateText,
        imageUrl: imageUrl || undefined, rsvpEnabled: b.rsvp !== false, album: b.album === true,
      });
      sendJson(res, 201, { channelId: channel.id, channelName: channel.name, albumUrl: b.album === true ? `${getBaseUrl()}/archives/albums/${channel.id}` : undefined, discordUrl: `https://discord.com/channels/${guild.id}/${channel.id}` });
    } catch (e) {
      console.error("Create event from website failed:", e);
      sendJson(res, 500, { error: "Something went wrong creating the event. Try again." });
    }
  });
  return true;
}
