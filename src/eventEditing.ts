import { ChannelType } from "discord.js";
import type { Guild, GuildMember } from "discord.js";
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { config } from "./config";
import { eventStates, persistState } from "./state";
import type { EventState, PlaceholderPerson, RSVPStatus } from "./types";

const RSVP_STATUSES: RSVPStatus[] = ["coming", "maybe", "decline", "lurking"];
import { buildJoinContent, buildJoinEmbed, joinMessageComponents, displayWhen } from "./eventBuilders";
import { leaveEvent } from "./interactions/leaveInteractions";
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
  rsvps: Map<string, { status: RSVPStatus; name: string }>;
  placeholders: Map<string, { status: RSVPStatus; name: string }>;
};

function snapshot(channelId: string, state: EventState): Snapshot {
  return {
    name: state.eventName, description: state.description, location: state.location,
    dateText: state.dateText, endDateText: state.endDateText, imageUrl: state.imageUrl,
    rsvp: state.rsvpEnabled !== false, private: !!state.private, joiningEnabled: state.joiningEnabled, album: hasAlbum(channelId),
    rsvps: new Map([...state.members.values()].map(m => [m.userId, { status: m.status, name: m.displayName }])),
    placeholders: new Map((state.placeholders ?? []).map(p => [p.id, { status: p.status, name: p.name }])),
  };
}

const STATUS_LABELS: Record<RSVPStatus, string> = { coming: "✅ Coming", maybe: "❔ Maybe", decline: "❌ Declined", lurking: "👀 Lurking" };
const shortWhen = (t: string | undefined) => !t ? "none" : displayWhen(t);

// One line per change, plus who to ping: people whose RSVP was changed are @mentioned;
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
    if (prev.status === after.status) continue;
    ping.push(id);
    out.push(`🙋 ${name}: ${STATUS_LABELS[prev.status]} → **${STATUS_LABELS[after.status]}**`);
  }
  for (const [id, after] of b.placeholders) {
    const prev = a.placeholders.get(id);
    if (!prev) out.push(`➕ Added ${after.name} (${STATUS_LABELS[after.status]})`);
    else {
      if (prev.name !== after.name) out.push(`✏️ Renamed ${prev.name} → **${after.name}**`);
      if (prev.status !== after.status) out.push(`🙋 ${after.name}: ${STATUS_LABELS[prev.status]} → **${STATUS_LABELS[after.status]}**`);
    }
  }
  for (const [id, prev] of a.placeholders) if (!b.placeholders.has(id)) out.push(`➖ Removed ${prev.name}`);
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
      status: m.status,
    })),
    placeholders: state.placeholders ?? [],
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

      // RSVPs set by the organiser: [{ id, status }] for people already in the event.
      if (state.rsvpEnabled !== false && Array.isArray(b.rsvps)) {
        for (const r of b.rsvps as { id?: unknown; status?: unknown }[]) {
          const entry = typeof r?.id === "string" ? state.members.get(r.id) : undefined;
          if (!entry) continue;
          if (typeof r.status === "string" && RSVP_STATUSES.includes(r.status as RSVPStatus)) entry.status = r.status as RSVPStatus;
        }
      }

      // Placeholder people (no Discord): the form sends the whole list, [{ id?, name, status }]; new ones get an ID here.
      // Only while RSVPs are on, so turning RSVPs off and on again keeps them.
      if (state.rsvpEnabled !== false && Array.isArray(b.placeholders)) {
        const known = new Set((state.placeholders ?? []).map(p => p.id));
        const list: PlaceholderPerson[] = [];
        for (const p of (b.placeholders as { id?: unknown; name?: unknown; status?: unknown }[]).slice(0, 50)) {
          const name = typeof p?.name === "string" ? p.name.trim().slice(0, 60) : "";
          if (!name) continue;
          const status = typeof p.status === "string" && RSVP_STATUSES.includes(p.status as RSVPStatus) ? p.status as RSVPStatus : "coming";
          const id = typeof p.id === "string" && known.has(p.id) ? p.id : crypto.randomBytes(6).toString("hex");
          list.push({ id, name, status });
        }
        state.placeholders = list.length ? list : undefined;
      }

      // People the organiser removed: out of the channel (quietly, the summary below says so) and its album.
      // Dropping them from the invite list also stops an old invite DM letting them back into a private event.
      const removedNames: string[] = [];
      if (Array.isArray(b.remove)) {
        for (const id of new Set(b.remove as unknown[])) {
          const entry = typeof id === "string" ? state.members.get(id) : undefined;
          if (!entry) continue;
          removedNames.push(guild.members.cache.get(entry.userId)?.displayName ?? entry.displayName);
          await leaveEvent(guild, channelId, entry.userId, entry.displayName, true);
          state.invitedIds = state.invitedIds?.filter(i => i !== entry.userId);
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
      if (removedNames.length) changes.lines.push(`🚪 Removed ${removedNames.join(", ")}`);
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
