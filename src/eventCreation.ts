import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from "discord.js";
import type { Client, Guild, Interaction, TextChannel, User } from "discord.js";
import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { eventStates, persistState, DATA_DIR } from "./state";
import type { EventState } from "./types";
import { makeMemberEntry } from "./types";
import { buildJoinContent, buildJoinEmbed, buildInnerEmbed, joinMessageComponents, pinMessageComponents, pinMessageContent } from "./eventBuilders";
import { startAlbumForChannel, hasAlbum } from "./albums";
import { updateJoinMessage, updateInnerMessage } from "./messageSync";
import { DAYS, MONTHS } from "./dateUtils";
import { parseLocal } from "./calendarFeed";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbGetUserById, dbUpsertUser, dbAddAlbumMember } from "./db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: Buffer) => { rotate(): { resize(w: number, h: number, o: object): { jpeg(o: object): { toFile(p: string): Promise<unknown> } } } };

const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";
const IMAGE_DIR = path.join(DATA_DIR, "event-images");
const IMAGE_NAME = /^[a-f0-9]{32}\.jpg$/;
const MAX_UPLOAD = 15 * 1024 * 1024;

export type NewEvent = {
  eventName: string; description: string; location: string; dateText: string; endDateText?: string;
  imageUrl?: string; rsvpEnabled?: boolean; album?: boolean; private?: boolean;
};

// Lets someone into an event channel and adds them to its cards and album.
export async function joinEvent(guild: Guild, channelId: string, user: User, displayName: string): Promise<"joined" | "already" | "missing"> {
  const state = eventStates.get(channelId);
  const channel = guild.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return "missing";
  if (state?.members.has(user.id)) return "already";
  await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });
  if (state) {
    state.members.set(user.id, makeMemberEntry(user.id, displayName));
    persistState();
    if (hasAlbum(channelId)) {
      dbUpsertUser(user.id, displayName, user.displayAvatarURL({ extension: "png", size: 128 }));
      dbAddAlbumMember(channelId, user.id);
    }
    await updateJoinMessage(guild, channelId);
    await updateInnerMessage(guild, channelId);
  }
  await channel.send(`**${displayName}** joined.`);
  return "joined";
}

export const INVITE_JOIN_PREFIX = "invite_join_";

// DMs each person the event card with a Join button. Returns the IDs whose DMs are closed.
export async function sendInvites(guild: Guild, channelId: string, inviterName: string, ids: string[]): Promise<string[]> {
  const state = eventStates.get(channelId);
  if (!state) return ids;
  const failed: string[] = [];
  for (const id of ids) {
    if (state.members.has(id)) continue;
    try {
      const member = await guild.members.fetch(id);
      if (member.user.bot) continue;
      await member.send({
        content: `💌 **${inviterName}** invited you to **${state.eventName}**${state.private ? " (a private event)" : ""}.`,
        embeds: [buildJoinEmbed(state)],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${INVITE_JOIN_PREFIX}${channelId}`).setLabel("Join").setEmoji("✅").setStyle(ButtonStyle.Success))],
      });
      if (!state.invitedIds?.includes(id)) (state.invitedIds ??= []).push(id);
    } catch {
      failed.push(id);
    }
  }
  persistState();
  return failed;
}

// The Join button on an invite DM. An invite gets you in even when the event is private or joining is closed.
export async function handleInviteInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(INVITE_JOIN_PREFIX)) return false;
  const channelId = interaction.customId.slice(INVITE_JOIN_PREFIX.length);
  const guild = interaction.client.guilds.cache.get(config.guildId);
  const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  if (!guild || !member || !eventStates.has(channelId)) {
    await interaction.update({ content: "This event no longer exists.", components: [] });
    return true;
  }
  await interaction.deferUpdate();
  const result = await joinEvent(guild, channelId, interaction.user, member.displayName);
  const link = `https://discord.com/channels/${guild.id}/${channelId}`;
  const done = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open the event").setURL(link));
  await interaction.editReply({
    content: result === "missing" ? "This event no longer exists." : `✅ You've joined **${eventStates.get(channelId)?.eventName}**.`,
    components: result === "missing" ? [] : [done],
  });
  return true;
}

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
    ...(ev.private ? { private: true } : {}),
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
  if (!ev.private && announcementChannel?.isSendable()) {
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

export type EventFields = { eventName: string; description: string; location: string; dateText: string; endDateText?: string; imageUrl: string };

// Checks the fields the Create/Edit Event form sends (name, description, location, date/time, end, image link).
export function parseEventFields(b: Record<string, unknown>): EventFields | { error: string } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const eventName = str(b.name), description = str(b.description), location = str(b.location);
  const date = str(b.date), time = str(b.time), endDate = str(b.endDate), endTime = str(b.endTime);
  const imageUrl = str(b.imageUrl);
  if (imageUrl && (imageUrl.length > 1000 || !/^https?:\/\/\S+$/i.test(imageUrl))) return { error: "The image link should start with https://" };
  if (!eventName) return { error: "Give the event a name." };
  if (eventName.length > 100) return { error: "The name can be at most 100 characters." };
  if (description.length > 3500) return { error: "The description can be at most 3500 characters." };
  if (location.length > 200) return { error: "The location can be at most 200 characters." };

  let dateText = "TBC";
  let endDateText: string | undefined;
  if (date) {
    const t = toDateText(date, time);
    if (!t) return { error: "That start date or time isn't valid." };
    dateText = t;
    if (endDate) {
      const e = toDateText(endDate, endTime);
      if (!e) return { error: "That end date or time isn't valid." };
      if (`${endDate}T${endTime || "23:59"}` < `${date}T${time || "00:00"}`) return { error: "The event can't end before it starts." };
      endDateText = e;
    }
  }
  return { eventName, description, location, dateText, endDateText, imageUrl };
}

// The other way: a stored date text as the form's "2026-12-05" and "19:30" (or "" for all day / TBC).
export function dateTextToFields(dateText: string | undefined): { date: string; time: string } {
  const t = parseLocal(dateText);
  if (!t) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${t.y}-${pad(t.m)}-${pad(t.d)}`, time: t.allDay ? "" : `${pad(t.hh)}:${pad(t.mm)}` };
}

let discordClient: Client | null = null;
export function setEventDiscordClient(client: Client) { discordClient = client; }
export const getEventGuild = () => discordClient?.guilds.cache.get(config.guildId);

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

  // GET /api/events/people — server members to pick invitees from.
  if (url === "/api/events/people" && req.method === "GET") {
    const user = getSessionUser(getTokenFromRequest(req));
    if (!user) { send401(res); return true; }
    const me = dbGetUserById(user.userId)?.discordId;
    const guild = discordClient?.guilds.cache.get(config.guildId);
    if (!guild) { sendJson(res, 503, { error: "The bot isn't connected to Discord right now." }); return true; }
    guild.members.fetch().then(members => {
      const people = [...members.values()]
        .filter(m => !m.user.bot && m.id !== me)
        .map(m => ({ id: m.id, name: m.displayName, username: m.user.username, avatarUrl: m.displayAvatarURL({ extension: "png", size: 64 }) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, people);
    }).catch(e => {
      console.error("Listing server members failed:", e);
      sendJson(res, 500, { error: "Couldn't load the server members." });
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
      const parsed = parseEventFields(b);
      if ("error" in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
      const { eventName, description, location, dateText, endDateText, imageUrl } = parsed;

      const discordId = dbGetUserById(user.userId)?.discordId;
      const guild = discordClient?.guilds.cache.get(config.guildId);
      if (!guild) { sendJson(res, 503, { error: "The bot isn't connected to Discord right now. Try again in a minute." }); return; }
      const member = discordId ? await guild.members.fetch(discordId).catch(() => null) : null;
      if (!member) { sendJson(res, 403, { error: "Only members of the Discord server can create events." }); return; }

      const channel = await createEvent(guild, member.id, member.displayName, {
        eventName, description, location, dateText, endDateText,
        imageUrl: imageUrl || undefined, rsvpEnabled: b.rsvp !== false, album: b.album === true, private: b.private === true,
      });
      const invites = Array.isArray(b.invites) ? [...new Set(b.invites.filter((i): i is string => typeof i === "string" && /^\d{5,25}$/.test(i)))].slice(0, 100) : [];
      const failed = await sendInvites(guild, channel.id, member.displayName, invites.filter(id => id !== member.id));
      const failedNames = failed.map(id => guild.members.cache.get(id)?.displayName ?? id);
      sendJson(res, 201, { channelId: channel.id, channelName: channel.name, invited: invites.length - failed.length, failedInvites: failedNames, albumUrl: b.album === true ? `${getBaseUrl()}/archives/albums/${channel.id}` : undefined, discordUrl: `https://discord.com/channels/${guild.id}/${channel.id}` });
    } catch (e) {
      console.error("Create event from website failed:", e);
      sendJson(res, 500, { error: "Something went wrong creating the event. Try again." });
    }
  });
  return true;
}
