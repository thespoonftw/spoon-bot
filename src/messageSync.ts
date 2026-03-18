import { ChannelType } from "discord.js";
import type { Guild } from "discord.js";
import { config } from "./config";
import { eventStates, groupStates, persistState, persistGroupState } from "./state";
import { buildJoinContent, buildJoinEmbed, buildInnerEmbed, joinMessageComponents, pinMessageComponents } from "./eventBuilders";
import { getAlbumUrl } from "./albums";
import { buildGroupJoinEmbed, buildGroupPinEmbed, groupJoinComponents, groupLeaveComponents } from "./groupBuilders";

export async function updateJoinMessage(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: buildJoinContent(state), embeds: [buildJoinEmbed(state, state.imageUrl || guild.iconURL())], components: joinMessageComponents(channelId, state.joiningEnabled) });
    } catch (e) { console.error("Failed to update join message:", e); }
  }
}

export async function updateInnerMessage(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const eventChannel = guild.channels.cache.get(channelId);
  if (eventChannel && eventChannel.type === ChannelType.GuildText) {
    try {
      const pinMsg = await eventChannel.messages.fetch(state.pinMessageId);
      const albumUrl = getAlbumUrl(channelId) ?? undefined;
      await pinMsg.edit({ content: 'Please use the buttons to RSVP!', embeds: [buildInnerEmbed(state, state.imageUrl || guild.iconURL(), albumUrl)], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

export async function updateEventMessages(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) { console.error(`updateEventMessages: no state for ${channelId}`); return; }
  const iconUrl = state.imageUrl || guild.iconURL();

  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (!announcementChannel) { console.error(`updateEventMessages: announcement channel ${config.eventChannelId} not in cache`); }
  else if (announcementChannel.type !== ChannelType.GuildText) { console.error(`updateEventMessages: announcement channel wrong type ${announcementChannel.type}`); }
  else {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: buildJoinContent(state), embeds: [buildJoinEmbed(state, iconUrl)], components: joinMessageComponents(channelId, state.joiningEnabled) });
    } catch (e: any) {
      if (e.code === 10008) { eventStates.delete(channelId); persistState(); return; }
      console.error("Failed to update join message:", e);
    }
  }

  const eventChannel = guild.channels.cache.get(channelId);
  if (!eventChannel) { console.error(`updateEventMessages: event channel ${channelId} not in cache`); }
  else if (eventChannel.type !== ChannelType.GuildText) { console.error(`updateEventMessages: event channel wrong type ${eventChannel.type}`); }
  else {
    try {
      await eventChannel.setTopic(state.description || null);
      const pinMsg = await eventChannel.messages.fetch(state.pinMessageId);
      const albumUrl = getAlbumUrl(channelId) ?? undefined;
      await pinMsg.edit({ content: 'Please use the buttons to RSVP!', embeds: [buildInnerEmbed(state, iconUrl, albumUrl)], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

export async function updateGroupMessages(guild: Guild, channelId: string) {
  const state = groupStates.get(channelId);
  if (!state || !config.groupsChannelId) return;
  const thumbnailUrl = state.imageUrl || guild.iconURL();
  const groupsChannel = guild.channels.cache.get(config.groupsChannelId);
  if (groupsChannel?.isTextBased()) {
    try {
      const joinMsg = await groupsChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: "", embeds: [buildGroupJoinEmbed(state, thumbnailUrl)], components: groupJoinComponents(channelId) });
    } catch (e: any) {
      if (e.code === 10008) { groupStates.delete(channelId); persistGroupState(); return; }
      console.error("Failed to update group join message:", e);
    }
  }
  const groupChannel = guild.channels.cache.get(channelId);
  if (groupChannel?.isTextBased()) {
    try {
      const pinMsg = await groupChannel.messages.fetch(state.pinMessageId);
      await pinMsg.edit({ content: "", embeds: [buildGroupPinEmbed(state, thumbnailUrl)], components: groupLeaveComponents(channelId) });
    } catch (e) { console.error("Failed to update group pin message:", e); }
  }
}
