import {
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextChannel,
} from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Guild, Interaction } from "discord.js";
import { eventStates, groupStates, persistState, persistGroupState } from "../state";
import { updateJoinMessage, updateInnerMessage, updateGroupMessages } from "../messageSync";
import { hasAlbum } from "../albums";
import { dbRemoveAlbumMember } from "../db";

// Leaving an event (its Leave button, or /leave in its channel) first opens a modal asking whether
// to post "X left." in the channel or to go quietly. Closing the modal leaves nothing. Groups are
// always left silently, straight away.
async function showEventLeaveChoice(interaction: ButtonInteraction | ChatInputCommandInteraction, channelId: string, name: string) {
  const title = `Leave ${name}?`;
  const modal = new ModalBuilder()
    .setCustomId(`leavemodal_${channelId}`)
    .setTitle(title.length > 45 ? `${title.slice(0, 43)}…?` : title);
  modal.addLabelComponents(
    new LabelBuilder().setLabel("Tell the channel you left?").setStringSelectMenuComponent(
      new StringSelectMenuBuilder().setCustomId("mode").addOptions(
        { label: `Post "${leaverName(interaction)} left."`, value: "loud", default: true },
        { label: "Leave silently", value: "silent" },
      ),
    ),
  );
  await interaction.showModal(modal);
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

async function leaveGroup(g: Guild, channelId: string, userId: string) {
  const state = groupStates.get(channelId);
  if (!state) return;
  state.members.delete(userId);
  persistGroupState();
  const channel = g.channels.cache.get(channelId);
  if (channel?.isTextBased()) await (channel as TextChannel).permissionOverwrites.delete(userId);
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
      await showEventLeaveChoice(interaction, channelId, eventState.eventName);
      return;
    }
    if (groupStates.has(channelId)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await leaveGroup(g, channelId, interaction.user.id);
      await interaction.deleteReply();
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
    await showEventLeaveChoice(interaction, channelId, state?.eventName ?? channel.name);
    return;
  }

  // Group Leave button
  if (interaction.isButton() && interaction.customId.startsWith("group_leave_")) {
    const channelId = interaction.customId.slice("group_leave_".length);
    if (!groupStates.has(channelId)) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferUpdate().catch((e) => { console.error('deferUpdate failed (leave):', e); });
    await leaveGroup(g, channelId, interaction.user.id);
    return;
  }

  // Event leave modal submit: leavemodal_{channelId}
  if (interaction.isModalSubmit() && interaction.customId.startsWith("leavemodal_")) {
    const channelId = interaction.customId.slice("leavemodal_".length);
    const silent = interaction.fields.getStringSelectValues("mode")[0] === "silent";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await leaveEvent(g, channelId, interaction.user.id, leaverName(interaction), silent);
    await interaction.deleteReply().catch(() => {});
    return;
  }
}
