import { ChannelType } from "discord.js";
import type { Guild, GuildMember } from "discord.js";
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { eventStates, persistState } from "./state";
import type { EventState, RSVPStatus } from "./types";

const RSVP_STATUSES: RSVPStatus[] = ["coming", "maybe", "decline", "lurking"];
import { buildJoinContent, buildJoinEmbed, joinMessageComponents } from "./eventBuilders";
import { updateEventMessages } from "./messageSync";
import { hasAlbum, getAlbumUrl, startAlbumForChannel } from "./albums";
import { dbDeleteAlbum, dbGetUserById } from "./db";
import { PHOTO_STORAGE_PATH } from "./photoStorage";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { parseEventFields, dateTextToFields, sendInvites, getEventGuild } from "./eventCreation";

// The website's Edit Event page (opened from an event's ⚙ button or /edit):
//   GET    /api/events/:id         the event as the form shows it
//   PUT    /api/events/:id         save the form (and send any new invites)
//   DELETE /api/events/:id/album   delete the photo album and its photos
//   DELETE /api/events/:id         delete the event, its channel and its join card

// Anyone with the member role can edit events (as the ⚙ menu allowed), and so can the event's creator.
function canEdit(member: GuildMember, state: EventState): boolean {
  return member.roles.cache.has(config.requiredRoleId) || state.creatorId === member.id;
}

async function postJoinCard(guild: Guild, channelId: string, state: EventState): Promise<void> {
  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (!announcementChannel?.isSendable()) return;
  const joinMsg = await announcementChannel.send({
    content: buildJoinContent(state),
    embeds: [buildJoinEmbed(state)],
    components: joinMessageComponents(channelId, state.joiningEnabled, state.dateText !== "TBC"),
  });
  state.joinMessageId = joinMsg.id;
}

async function removeJoinCard(guild: Guild, state: EventState): Promise<void> {
  if (!state.joinMessageId) return;
  try {
    const announcementChannel = guild.channels.cache.get(config.eventChannelId);
    if (announcementChannel?.type === ChannelType.GuildText) {
      await (await announcementChannel.messages.fetch(state.joinMessageId)).delete();
    }
  } catch (e) { console.error("Failed to delete join message:", e); }
  state.joinMessageId = "";
}

export async function deleteEvent(guild: Guild, channelId: string): Promise<void> {
  const state = eventStates.get(channelId);
  if (state?.scheduledEventId) {
    try { await guild.scheduledEvents.delete(state.scheduledEventId); } catch (e) { console.error("Failed to delete scheduled event:", e); }
  }
  if (state) await removeJoinCard(guild, state);
  try { await guild.channels.cache.get(channelId)?.delete(); } catch (e) { console.error("Failed to delete event channel:", e); }
  eventStates.delete(channelId);
  persistState();
}

function deleteAlbum(channelId: string): void {
  dbDeleteAlbum(channelId);
  try { fs.rmSync(path.join(PHOTO_STORAGE_PATH, channelId), { recursive: true, force: true }); } catch (e) { console.error("Failed to remove album photo directory:", e); }
}

// What an edit can change, captured before and after a save so the channel can be told what changed.
type Snapshot = {
  name: string; description: string; location: string; dateText: string; endDateText?: string; imageUrl?: string;
  rsvp: boolean; private: boolean; joiningEnabled: boolean; album: boolean;
  rsvps: Map<string, { status: RSVPStatus; plusOne: number; name: string }>;
};

function snapshot(channelId: string, state: EventState): Snapshot {
  return {
    name: state.eventName, description: state.description, location: state.location,
    dateText: state.dateText, endDateText: state.endDateText, imageUrl: state.imageUrl,
    rsvp: state.rsvpEnabled !== false, private: !!state.private, joiningEnabled: state.joiningEnabled, album: hasAlbum(channelId),
    rsvps: new Map([...state.members.values()].map(m => [m.userId, { status: m.status, plusOne: m.plusOne, name: m.displayName }])),
  };
}

const STATUS_LABELS: Record<RSVPStatus, string> = { coming: "✅ Coming", maybe: "❔ Maybe", decline: "❌ Declined", lurking: "👀 Lurking" };
const shortWhen = (t: string | undefined) => !t ? "none" : t.endsWith(", All Day") ? t.slice(0, -", All Day".length) + " (all day)" : t;

// One line per change, plus who to ping: people whose RSVP or guests were changed are @mentioned;
// everyone else is just named, so the rest of an edit doesn't ping anyone.
function describeChanges(guild: Guild, a: Snapshot, b: Snapshot, invitedIds: string[]): { lines: string[]; ping: string[] } {
  const out: string[] = [];
  const ping: string[] = [];
  if (a.name !== b.name) out.push(`📝 Name: ${a.name} → **${b.name}**`);
  if (a.dateText !== b.dateText) out.push(`📅 When: ${shortWhen(a.dateText)} → **${shortWhen(b.dateText)}**`);
  if (a.endDateText !== b.endDateText) {
    out.push(!b.endDateText ? "🏁 Removed the end time" : !a.endDateText
      ? `🏁 Ends: **${shortWhen(b.endDateText)}**` : `🏁 Ends: ${shortWhen(a.endDateText)} → **${shortWhen(b.endDateText)}**`);
  }
  if (a.location !== b.location) out.push(`📍 Where: ${a.location} → **${b.location}**`);
  if (a.description !== b.description) out.push("📄 Changed the description");
  if (a.imageUrl !== b.imageUrl) out.push(!b.imageUrl ? "🖼️ Removed the image" : a.imageUrl ? "🖼️ Changed the image" : "🖼️ Added an image");
  if (a.private !== b.private) out.push(b.private ? "🔒 Made the event private" : "🌍 Made the event public");
  if (a.joiningEnabled !== b.joiningEnabled) out.push(b.joiningEnabled ? "✅ Re-opened joining" : "🚫 Closed joining");
  if (a.rsvp !== b.rsvp) out.push(b.rsvp ? "🙋 Turned RSVPs on" : "🙋 Turned RSVPs off");
  if (!a.album && b.album) out.push("📸 Started a photo album");
  for (const [id, after] of b.rsvps) {
    const prev = a.rsvps.get(id);
    if (!prev) continue;
    const name = `<@${id}>`;
    if (prev.status !== after.status || prev.plusOne !== after.plusOne) ping.push(id);
    if (prev.status !== after.status) out.push(`🙋 ${name}: ${STATUS_LABELS[prev.status]} → **${STATUS_LABELS[after.status]}**`);
    if (prev.plusOne !== after.plusOne) out.push(`👥 ${name}: ${after.plusOne ? `bringing **${after.plusOne}** guest${after.plusOne > 1 ? "s" : ""}` : "**no guests**"}`);
  }
  if (invitedIds.length) out.push(`💌 Invited ${invitedIds.map(id => guild.members.cache.get(id)?.displayName ?? id).join(", ")}`);
  return { lines: out, ping };
}

async function postToEvent(guild: Guild, channelId: string, text: string, ping: string[] = []): Promise<void> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return;
  // Discord's 2000-character limit; a huge batch of RSVP edits gets cut short rather than failing.
  await channel.send({ content: text.length > 1990 ? text.slice(0, 1980) + "\n…" : text, allowedMentions: { parse: [], users: ping } })
    .catch(e => console.error("Posting event change summary failed:", e));
}

function eventForForm(guild: Guild, channelId: string, state: EventState) {
  const start = dateTextToFields(state.dateText);
  const end = dateTextToFields(state.endDateText);
  const albumUrl = getAlbumUrl(channelId);
  return {
    channelId,
    name: state.eventName, description: state.description,
    location: state.location === "TBC" ? "" : state.location,
    date: start.date, time: start.time, endDate: end.date, endTime: end.time,
    imageUrl: state.imageUrl ?? "",
    rsvp: state.rsvpEnabled !== false,
    private: !!state.private,
    joiningEnabled: state.joiningEnabled,
    albumUrl: albumUrl ? new URL(albumUrl).pathname : null,
    members: [...state.members.values()].map(m => ({
      id: m.userId, name: guild.members.cache.get(m.userId)?.displayName ?? m.displayName,
      avatarUrl: guild.members.cache.get(m.userId)?.displayAvatarURL({ extension: "png", size: 64 }) ?? "",
      status: m.status, plusOne: m.plusOne,
    })),
    invitedIds: state.invitedIds ?? [],
    discordUrl: `https://discord.com/channels/${guild.id}/${channelId}`,
  };
}

export function handleEventEditRoutes(req: IncomingMessage, res: ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const m = url.match(/^\/api\/events\/(\d{5,25})(\/album)?$/);
  if (!m) return false;
  const channelId = m[1];
  const isAlbum = !!m[2];
  const method = req.method ?? "GET";
  if (isAlbum ? method !== "DELETE" : !["GET", "PUT", "DELETE"].includes(method)) return false;

  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) { send401(res); return true; }

  let body = "";
  req.on("data", chunk => { body += chunk; if (body.length > 20_000) req.destroy(); });
  req.on("end", async () => {
    try {
      const guild = getEventGuild();
      if (!guild) { sendJson(res, 503, { error: "The bot isn't connected to Discord right now. Try again in a minute." }); return; }
      const state = eventStates.get(channelId);
      if (!state) { sendJson(res, 404, { error: "This event doesn't exist any more." }); return; }
      const discordId = dbGetUserById(user.userId)?.discordId;
      const member = discordId ? await guild.members.fetch(discordId).catch(() => null) : null;
      if (!member || !canEdit(member, state)) { sendJson(res, 403, { error: "You don't have permission to edit this event." }); return; }

      if (method === "GET") { sendJson(res, 200, eventForForm(guild, channelId, state)); return; }

      if (isAlbum) {
        const had = hasAlbum(channelId);
        deleteAlbum(channelId);
        if (had) await postToEvent(guild, channelId, `🗑️ **${member.displayName}** deleted the event's photo album.`);
        await updateEventMessages(guild, channelId);
        sendJson(res, 200, eventForForm(guild, channelId, state));
        return;
      }

      if (method === "DELETE") {
        await deleteEvent(guild, channelId);
        sendJson(res, 200, { ok: true });
        return;
      }

      // PUT: save the form
      const b = JSON.parse(body || "{}") as Record<string, unknown>;
      const parsed = parseEventFields(b);
      if ("error" in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
      const renamed = parsed.eventName !== state.eventName;
      const before = snapshot(channelId, state);
      state.eventName = parsed.eventName;
      state.description = parsed.description;
      state.location = parsed.location || "TBC";
      state.dateText = parsed.dateText;
      state.endDateText = parsed.endDateText;
      state.imageUrl = parsed.imageUrl || undefined;
      state.rsvpEnabled = b.rsvp === false ? false : undefined;
      state.joiningEnabled = b.joiningEnabled !== false;

      // RSVPs set by the organiser: [{ id, status, plusOne }] for people already in the event.
      if (state.rsvpEnabled !== false && Array.isArray(b.rsvps)) {
        for (const r of b.rsvps as { id?: unknown; status?: unknown; plusOne?: unknown }[]) {
          const entry = typeof r?.id === "string" ? state.members.get(r.id) : undefined;
          if (!entry) continue;
          if (typeof r.status === "string" && RSVP_STATUSES.includes(r.status as RSVPStatus)) entry.status = r.status as RSVPStatus;
          if (Number.isInteger(r.plusOne) && (r.plusOne as number) >= 0 && (r.plusOne as number) <= 5) entry.plusOne = r.plusOne as number;
        }
      }

      const makePrivate = b.private === true;
      if (makePrivate && !state.private) await removeJoinCard(guild, state);
      if (!makePrivate && state.private) { state.private = undefined; await postJoinCard(guild, channelId, state); }
      state.private = makePrivate || undefined;

      if (b.album === true && !hasAlbum(channelId)) await startAlbumForChannel(channelId, guild, state.eventName);
      persistState();
      await updateEventMessages(guild, channelId);

      if (renamed) {
        // Discord only allows a couple of channel renames per 10 minutes, so this can lag; don't hold the save up.
        const channel = guild.channels.cache.get(channelId);
        const newName = state.eventName.toLowerCase().replace(/\s+/g, "-").slice(0, 100);
        if (channel?.type === ChannelType.GuildText) channel.setName(newName).catch(e => console.error("Rename event channel failed:", e));
      }

      const invites = state.private && Array.isArray(b.invites)
        ? [...new Set(b.invites.filter((i): i is string => typeof i === "string" && /^\d{5,25}$/.test(i)))].slice(0, 100) : [];
      const failed = await sendInvites(guild, channelId, member.displayName, invites.filter(id => id !== member.id));

      const sentTo = invites.filter(id => id !== member.id && !failed.includes(id));
      const changes = describeChanges(guild, before, snapshot(channelId, state), sentTo);
      if (changes.lines.length) {
        await postToEvent(guild, channelId, `✏️ **${member.displayName}** updated the event:\n${changes.lines.map(c => `- ${c}`).join("\n")}`, changes.ping);
      }

      sendJson(res, 200, {
        ...eventForForm(guild, channelId, state),
        invited: invites.length - failed.length,
        failedInvites: failed.map(id => guild.members.cache.get(id)?.displayName ?? id),
      });
    } catch (e) {
      console.error("Edit event from website failed:", e);
      sendJson(res, 500, { error: "Something went wrong saving the event. Try again." });
    }
  });
  return true;
}
