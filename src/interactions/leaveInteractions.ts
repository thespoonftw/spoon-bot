import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  TextChannel,
} from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Guild, Interaction } from "discord.js";
import { eventStates, groupStates, persistState, persistGroupState } from "../state";
import { updateJoinMessage, updateInnerMessage, updateGroupMessages } from "../messageSync";
import { hasAlbum } from "../albums";
import { dbRemoveAlbumMember } from "../db";

type LeaveKind = "event" | "group";

// Leaving an event or group (its Leave button, or /leave in its channel) first asks, in a popup only
// the leaver sees, whether to post "X left." in the channel or to go quietly.
async function showLeaveChoice(interaction: ButtonInteraction | ChatInputCommandInteraction, kind: LeaveKind, channelId: string, name: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`leavechoice_${kind}_loud_${channelId}`).setLabel("Leave").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`leavechoice_${kind}_silent_${channelId}`).setLabel("Leave silently").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: `Leave **${name}**?`, components: [row], flags: MessageFlags.Ephemeral });
}

function leaverName(interaction: Interaction): string {
  const member = interaction.member;
  return (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
}

async function leaveEvent(g: Guild, channelId: string, userId: string, displayName: string, silent: boolean) {
  const channel = g.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await channel.permissionOverwrites.delete(userId);
  const state = eventStates.get(channelId);
  if (state) {
    state.members.delete(userId);
    persistState();
    await updateJoinMessage(g, channelId);
    await updateInnerMessage(g, channelId);
  }
  if (hasAlbum(channelId)) dbRemoveAlbumMember(channelId, userId);
  if (!silent) await channel.send(`**${displayName}** left.`);
}

async function leaveGroup(g: Guild, channelId: string, userId: string, displayName: string, silent: boolean) {
  const state = groupStates.get(channelId);
  if (!state) return;
  state.members.delete(userId);
  persistGroupState();
  const channel = g.channels.cache.get(channelId);
  if (channel?.isTextBased()) {
    await (channel as TextChannel).permissionOverwrites.delete(userId);
    if (!silent) await (channel as TextChannel).send(`**${displayName}** left.`);
  }
  await updateGroupMessages(g, channelId);
}

export async function handleLeaveInteractions(interaction: Interaction): Promise<void> {
  const g = interaction.guild;
  if (!g) return;

  // /leave in an event or group channel
  if (interaction.isChatInputCommand() && interaction.commandName === "leave") {
    const channelId = interaction.channelId;
    const eventState = eventStates.get(channelId);
    if (eventState) {
      if (!eventState.members.has(interaction.user.id)) { await interaction.reply({ content: "You haven't joined this event.", flags: MessageFlags.Ephemeral }); return; }
      await showLeaveChoice(interaction, "event", channelId, eventState.eventName);
      return;
    }
    const groupState = groupStates.get(channelId);
    if (groupState) {
      await showLeaveChoice(interaction, "group", channelId, groupState.groupName);
      return;
    }
    await interaction.reply({ content: "This isn't an event or group channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Event Leave button
  if (interaction.isButton() && interaction.customId.startsWith("leave_event_")) {
    const channelId = interaction.customId.slice("leave_event_".length);
    const channel = g.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) { await interaction.reply({ content: "Event channel not found.", flags: MessageFlags.Ephemeral }); return; }
    const state = eventStates.get(channelId);
    if (state && !state.members.has(interaction.user.id)) { await interaction.reply({ content: "You haven't joined this event.", flags: MessageFlags.Ephemeral }); return; }
    await showLeaveChoice(interaction, "event", channelId, state?.eventName ?? channel.name);
    return;
  }

  // Group Leave button
  if (interaction.isButton() && interaction.customId.startsWith("group_leave_")) {
    const channelId = interaction.customId.slice("group_leave_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    if (!state.members.has(interaction.user.id)) { await interaction.reply({ content: "You're not in this group.", flags: MessageFlags.Ephemeral }); return; }
    await showLeaveChoice(interaction, "group", channelId, state.groupName);
    return;
  }

  // Popup choice: leavechoice_{event|group}_{loud|silent}_{channelId}
  if (interaction.isButton() && interaction.customId.startsWith("leavechoice_")) {
    const [, kind, mode, channelId] = interaction.customId.split("_");
    await interaction.deferUpdate();
    const leave = kind === "group" ? leaveGroup : leaveEvent;
    await leave(g, channelId, interaction.user.id, leaverName(interaction), mode === "silent");
    await interaction.deleteReply().catch(() => {});
    return;
  }
}
