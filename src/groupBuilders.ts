import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { GroupState } from "./types";
import { HALF_JOIN_LABEL, HALF_LEAVE_LABEL, LEAVE_LABEL } from "./eventBuilders";

export function buildGroupJoinContent(state: GroupState): string {
  const header = state.description ? `**${state.groupName}:** ${state.description}` : `**${state.groupName}**`;
  const members = state.members.size === 0 ? "" : `\n\n👥 **${state.members.size} Member${state.members.size === 1 ? "" : "s"}:** ${[...state.members.values()].map(m => m.displayName).join(", ")}`;
  return `${header}${members}\n⠀`;
}

export function buildGroupPinContent(state: GroupState): string {
  return `Welcome to **${state.groupName}**.`;
}

export function groupJoinComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`group_join_${channelId}`).setLabel(HALF_JOIN_LABEL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(HALF_LEAVE_LABEL).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`group_spacer_${channelId}`).setLabel("⠀").setStyle(ButtonStyle.Secondary).setDisabled(true),
    ),
  ];
}

export function groupLeaveComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`group_edit_${channelId}`).setLabel("⚙").setStyle(ButtonStyle.Secondary),
  )];
}
