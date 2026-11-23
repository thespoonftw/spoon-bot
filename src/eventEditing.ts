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
        deleteAlbum(channelId);
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
