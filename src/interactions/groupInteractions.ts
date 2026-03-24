import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, Interaction } from "discord.js";
import { config } from "../config";
import { eventStates, groupStates, persistState, persistGroupState } from "../state";
import type { GroupState } from "../types";
import { buildGroupJoinEmbed, buildGroupPinEmbed, groupJoinComponents, groupLeaveComponents } from "../groupBuilders";
import { updateJoinMessage, updateInnerMessage, updateGroupMessages } from "../messageSync";

function buildGroupModalComponents(prefill?: GroupState): ActionRowBuilder<TextInputBuilder>[] {
  return [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Group Name").setStyle(TextInputStyle.Short).setRequired(true).setValue(prefill?.groupName ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(prefill?.description ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("imageUrl").setLabel("Image URL (leave blank to use server icon)").setStyle(TextInputStyle.Short).setRequired(false).setValue(prefill?.imageUrl ?? "")
    ),
  ];
}

export async function handleGroupInteractions(interaction: Interaction, guild: Guild | null): Promise<void> {
  // /group — open modal
  if (interaction.isChatInputCommand() && interaction.commandName === "group") {
    if (!config.groupsChannelId) { await interaction.reply({ content: "Groups not configured on this server.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId("group_create_modal").setTitle("New Group");
    modal.addComponents(...buildGroupModalComponents());
    await interaction.showModal(modal);
    return;
  }

  // group_create_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "group_create_modal") {
    const groupName = interaction.fields.getTextInputValue("name");
    const description = interaction.fields.getTextInputValue("description") ?? "";
    const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim() || undefined;
    await interaction.deferReply({ ephemeral: true });
    const g = interaction.guild!;
    const channelName = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const channel = await g.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.groupsCategoryId ?? null,
    });
    const channelId = channel.id;
    const tempState: GroupState = { groupName, description, imageUrl, joinMessageId: "", pinMessageId: "", members: new Map() };
    const groupsChannel = g.channels.cache.get(config.groupsChannelId!);
    if (!groupsChannel?.isTextBased()) { await interaction.editReply("Groups channel not found."); return; }
    const thumbnailUrl = imageUrl || g.iconURL();
    const joinMsg = await (groupsChannel as TextChannel).send({ embeds: [buildGroupJoinEmbed(tempState, thumbnailUrl)], components: groupJoinComponents(channelId) });
    const pinMsg = await channel.send({ embeds: [buildGroupPinEmbed(tempState, thumbnailUrl)], components: groupLeaveComponents(channelId) });
    tempState.joinMessageId = joinMsg.id;
    tempState.pinMessageId = pinMsg.id;
    groupStates.set(channelId, tempState);
    persistGroupState();
    await interaction.editReply({ content: `Group **${groupName}** created!` });
    return;
  }

  // /addgroup — open modal
  if (interaction.isChatInputCommand() && interaction.commandName === "addgroup") {
    if (!config.groupsChannelId) { await interaction.reply({ content: "Groups not configured on this server.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId(`addgroup_modal_${interaction.channelId}`).setTitle("Add Group");
    modal.addComponents(...buildGroupModalComponents());
    await interaction.showModal(modal);
    return;
  }

  // addgroup_modal_ submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("addgroup_modal_")) {
    const channelId = interaction.customId.slice("addgroup_modal_".length);
    const groupName = interaction.fields.getTextInputValue("name");
    const description = interaction.fields.getTextInputValue("description") ?? "";
    const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim() || undefined;
    await interaction.deferReply({ ephemeral: true });
    const g = interaction.guild!;
    const tempState: GroupState = { groupName, description, imageUrl, joinMessageId: "", pinMessageId: "", members: new Map() };
    const groupsChannel = g.channels.cache.get(config.groupsChannelId!);
    if (!groupsChannel?.isTextBased()) { await interaction.editReply("Groups channel not found."); return; }
    const groupChannel = g.channels.cache.get(channelId);
    if (!groupChannel?.isTextBased()) { await interaction.editReply("Could not find this channel."); return; }
    const thumbnailUrl = imageUrl || g.iconURL();
    const joinMsg = await (groupsChannel as TextChannel).send({ embeds: [buildGroupJoinEmbed(tempState, thumbnailUrl)], components: groupJoinComponents(channelId) });
    const pinMsg = await (groupChannel as TextChannel).send({ embeds: [buildGroupPinEmbed(tempState, thumbnailUrl)], components: groupLeaveComponents(channelId) });
    tempState.joinMessageId = joinMsg.id;
    tempState.pinMessageId = pinMsg.id;
    groupStates.set(channelId, tempState);
    persistGroupState();
    await interaction.editReply({ content: `Group **${groupName}** set up!` });
    return;
  }

  // /edit in a group channel
  if (interaction.isChatInputCommand() && interaction.commandName === "edit") {
    const channelId = interaction.channelId;
    const state = groupStates.get(channelId);
    if (!state) return; // not a group channel — let event handler deal with it
    const modal = new ModalBuilder().setCustomId(`group_edit_modal_${channelId}`).setTitle("Edit Group");
    modal.addComponents(...buildGroupModalComponents(state));
    await interaction.showModal(modal);
    return;
  }

  // /leave command (group branch)
  if (interaction.isChatInputCommand() && interaction.commandName === "leave") {
    const channelId = interaction.channelId;
    const g = interaction.guild;
    if (!g) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Event leave
    const eventState = eventStates.get(channelId);
    if (eventState) {
      const channel = g.channels.cache.get(channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.permissionOverwrites.delete(interaction.user.id);
        eventState.members.delete(interaction.user.id);
        persistState();
        await updateJoinMessage(g, channelId);
        await updateInnerMessage(g, channelId);
        await channel.send(`**${interaction.user.displayName}** left.`);
      }
      await interaction.deleteReply();
      return;
    }

    // Group leave
    const groupState = groupStates.get(channelId);
    if (groupState) {
      const channel = g.channels.cache.get(channelId);
      groupState.members.delete(interaction.user.id);
      persistGroupState();
      if (channel?.isTextBased()) {
        await (channel as TextChannel).permissionOverwrites.delete(interaction.user.id);
      }
      await updateGroupMessages(g, channelId);
      await interaction.deleteReply();
      return;
    }

    await interaction.editReply({ content: "This isn't an event or group channel." });
    return;
  }

  // group_join_ button
  if (interaction.isButton() && interaction.customId.startsWith("group_join_")) {
    console.log(`group_join received: ${interaction.customId} by ${interaction.user.tag}`);
    const channelId = interaction.customId.slice("group_join_".length);
    const state = groupStates.get(channelId);
    if (!state) { console.log(`group not found for channelId: ${channelId}`); await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const userId = interaction.user.id;
    if (state.members.has(userId)) { console.log('already member'); await interaction.reply({ content: "You're already in this group.", flags: MessageFlags.Ephemeral }); return; }
    const member = interaction.guild?.members.cache.get(userId);
    const displayName = member?.displayName ?? interaction.user.displayName;
    state.members.set(userId, { userId, displayName });
    persistGroupState();
    await interaction.deferUpdate().catch((e) => { console.error('deferUpdate failed (join):', e); });
    console.log('join deferUpdate done');
    const groupChannel = interaction.guild?.channels.cache.get(channelId);
    if (groupChannel?.isTextBased()) {
      await (groupChannel as TextChannel).permissionOverwrites.edit(userId, { ViewChannel: true });
      await (groupChannel as TextChannel).send(`**${interaction.user.displayName}** joined.`);
    }
    await updateGroupMessages(interaction.guild!, channelId);
    return;
  }

  // group_leave_ button
  if (interaction.isButton() && interaction.customId.startsWith("group_leave_")) {
    const channelId = interaction.customId.slice("group_leave_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const userId = interaction.user.id;
    state.members.delete(userId);
    persistGroupState();
    await interaction.deferUpdate().catch((e) => { console.error('deferUpdate failed (leave):', e); });
    console.log('leave deferUpdate done');
    const groupChannel = interaction.guild?.channels.cache.get(channelId);
    if (groupChannel?.isTextBased()) {
      await (groupChannel as TextChannel).permissionOverwrites.delete(userId);
    }
    await updateGroupMessages(interaction.guild!, channelId);
    return;
  }

  // group_edit_ gear button
  if (interaction.isButton() && interaction.customId.startsWith("group_edit_")) {
    const channelId = interaction.customId.slice("group_edit_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId(`group_edit_modal_${channelId}`).setTitle("Edit Group");
    modal.addComponents(...buildGroupModalComponents(state));
    await interaction.showModal(modal);
    return;
  }

  // group_edit_modal_ submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("group_edit_modal_")) {
    const channelId = interaction.customId.slice("group_edit_modal_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    state.groupName = interaction.fields.getTextInputValue("name");
    state.description = interaction.fields.getTextInputValue("description") ?? "";
    state.imageUrl = interaction.fields.getTextInputValue("imageUrl").trim() || undefined;
    persistGroupState();
    await interaction.deferReply({ ephemeral: true });
    await updateGroupMessages(interaction.guild!, channelId);
    await interaction.deleteReply();
    return;
  }
}
