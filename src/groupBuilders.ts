import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { GroupState } from "./types";
import { HALF_JOIN_LABEL, HALF_LEAVE_LABEL, LEAVE_LABEL } from "./eventBuilders";

function addMembersField(embed: EmbedBuilder, state: GroupState): void {
  if (state.members.size > 0) {
    const mentions = [...state.members.values()].map(m => `<@${m.userId}>`).join(" ");
    embed.addFields({ name: `👥 ${state.members.size} Member${state.members.size === 1 ? "" : "s"}`, value: mentions });
  }
}

export function buildGroupJoinEmbed(state: GroupState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder().setTitle(state.groupName).setColor(0x5865F2);
  if (state.description) embed.setDescription(state.description);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  addMembersField(embed, state);
  return embed;
}

export function buildGroupPinEmbed(state: GroupState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(state.groupName)
    .setDescription(`Welcome to **${state.groupName}**.${state.description ? `\n\n${state.description}` : ""}`)
    .setColor(0x5865F2);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  addMembersField(embed, state);
  return embed;
}

export function groupJoinComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`group_join_${channelId}`).setLabel(HALF_JOIN_LABEL).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(HALF_LEAVE_LABEL).setStyle(ButtonStyle.Secondary),
  )];
}

export function groupLeaveComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`group_edit_${channelId}`).setLabel("⚙").setStyle(ButtonStyle.Secondary),
  )];
}
