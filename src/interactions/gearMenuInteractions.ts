import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Interaction } from "discord.js";
import { config } from "../config";
import { eventStates, pendingGearMenus, persistState } from "../state";
import { buildGearMenuComponents, backRow } from "../eventBuilders";
import { parseDateText } from "../dateUtils";
import { updateJoinMessage, updateEventMessages } from "../messageSync";
import { hasAlbum } from "../albums";

type EventModalPrefill = { eventName?: string; description?: string; location?: string; imageUrl?: string };
export function buildEventModalComponents(prefill?: EventModalPrefill): ActionRowBuilder<TextInputBuilder>[] {
  return [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_name").setLabel("Event name").setStyle(TextInputStyle.Short).setRequired(true).setValue(prefill?.eventName ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Optional").setValue(prefill?.description ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(true).setValue(prefill?.location ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_image").setLabel("Image URL").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Optional — replaces server icon in embed").setValue(prefill?.imageUrl ?? "")
    ),
  ];
}

function hasRole(interaction: Interaction): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(config.requiredRoleId);
  return roles.cache.has(config.requiredRoleId);
}

// Returns true if the interaction was handled
export async function handleGearMenuInteractions(interaction: Interaction): Promise<boolean> {
  // /edit command
  if (interaction.isChatInputCommand() && interaction.commandName === "edit") {
    const channelId = interaction.channelId;
    if (!hasRole(interaction)) {
      await interaction.reply({ content: "You don't have permission.", ephemeral: true });
      return true;
    }
    const state = eventStates.get(channelId);
    if (!state) {
      await interaction.reply({ content: "This command can only be used in an event channel.", ephemeral: true });
      return true;
    }
    await interaction.reply({
      ephemeral: true,
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state.joiningEnabled, state.dateText, hasAlbum(channelId)),
    });
    pendingGearMenus.set(channelId, interaction);
    return true;
  }

  // ⚙ gear menu button
  if (interaction.isButton() && interaction.customId.startsWith("edit_menu_")) {
    const channelId = interaction.customId.slice("edit_menu_".length);
    if (!hasRole(interaction)) {
      await interaction.reply({ content: "You don't have permission.", ephemeral: true });
      return true;
    }
    const state = eventStates.get(channelId);
    await interaction.reply({
      ephemeral: true,
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    pendingGearMenus.set(channelId, interaction);
    return true;
  }

  // Close gear menu
  if (interaction.isButton() && interaction.customId.startsWith("close_edit_")) {
    await interaction.deferUpdate();
    await interaction.deleteReply();
    return true;
  }

  // Back to gear menu
  if (interaction.isButton() && interaction.customId.startsWith("gear_back_")) {
    const channelId = interaction.customId.slice("gear_back_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    return true;
  }

  // Generate Discord scheduled event
  if (interaction.isButton() && interaction.customId.startsWith("gear_generate_")) {
    const channelId = interaction.customId.slice("gear_generate_".length);
    const state = eventStates.get(channelId);
    if (!state || state.dateText === "TBC") {
      await interaction.update({ content: "Please set the event date before generating the event.", components: [backRow(channelId)] });
      return true;
    }
    try {
      const startDate = parseDateText(state.dateText);
      if (!startDate) throw new Error("Failed to parse date");
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
      const event = await interaction.guild!.scheduledEvents.create({
        name: state.eventName,
        scheduledStartTime: startDate,
        scheduledEndTime: endDate,
        entityType: GuildScheduledEventEntityType.External,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityMetadata: { location: state.location },
        description: state.description || undefined,
      });
      state.scheduledEventId = event.id;
    } catch (e) {
      console.error("Failed to generate event:", e);
    }
    await interaction.deferUpdate();
    await interaction.deleteReply();
    return true;
  }

  // Toggle joining
  if (interaction.isButton() && interaction.customId.startsWith("gear_toggle_join_")) {
    const channelId = interaction.customId.slice("gear_toggle_join_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) return true;
    state.joiningEnabled = !state.joiningEnabled;
    persistState();
    await updateJoinMessage(interaction.guild, channelId);
    await interaction.deferUpdate();
    await interaction.deleteReply();
    const member = interaction.guild.members.cache.get(interaction.user.id);
    const displayName = member?.displayName ?? interaction.user.displayName;
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      await eventChannel.send(state.joiningEnabled
        ? `✅ **${displayName}** has re-opened joining for this event.`
        : `🚫 **${displayName}** has closed joining for this event.`);
    }
    return true;
  }

  // Delete Event — show confirmation
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_ask_")) {
    const channelId = interaction.customId.slice("gear_delete_ask_".length);
    await interaction.update({
      content: "⚠️ Are you sure you want to delete this event? This cannot be undone.",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`gear_delete_confirm_${channelId}`).setLabel("Yes, Delete").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`gear_delete_cancel_${channelId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      )],
    });
    return true;
  }

  // Delete Event — confirm
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_confirm_")) {
    const channelId = interaction.customId.slice("gear_delete_confirm_".length);
    const state = eventStates.get(channelId);
    if (!interaction.guild) return true;
    await interaction.deferUpdate();
    if (state?.scheduledEventId) {
      try { await interaction.guild.scheduledEvents.delete(state.scheduledEventId); } catch (e) { console.error("Failed to delete scheduled event:", e); }
    }
    if (state?.joinMessageId) {
      try {
        const announcementChannel = interaction.guild.channels.cache.get(config.eventChannelId);
        if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
          const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
          await joinMsg.delete();
        }
      } catch (e) { console.error("Failed to delete join message:", e); }
    }
    try {
      const eventChannel = interaction.guild.channels.cache.get(channelId);
      if (eventChannel) await eventChannel.delete();
    } catch (e) { console.error("Failed to delete event channel:", e); }
    eventStates.delete(channelId);
    persistState();
    try { await interaction.editReply({ content: "✅ Event deleted.", components: [] }); } catch { /* ephemeral may be gone */ }
    return true;
  }

  // Delete Event — cancel
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_cancel_")) {
    const channelId = interaction.customId.slice("gear_delete_cancel_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    return true;
  }

  // Edit description — open modal
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_desc_")) {
    const channelId = interaction.customId.slice("edit_open_desc_".length);
    const state = eventStates.get(channelId);
    const modal = new ModalBuilder().setCustomId(`edit_desc_modal_${channelId}`).setTitle("Edit Event");
    modal.addComponents(...buildEventModalComponents(state));
    await interaction.showModal(modal);
    return true;
  }

  // Edit description — modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("edit_desc_modal_")) {
    const channelId = interaction.customId.slice("edit_desc_modal_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) {
      await interaction.reply({ content: "Event state not found — was the bot restarted?", ephemeral: true });
      return true;
    }
    state.eventName = interaction.fields.getTextInputValue("event_name").trim();
    state.description = interaction.fields.getTextInputValue("event_desc").trim();
    state.location = interaction.fields.getTextInputValue("event_location").trim();
    state.imageUrl = interaction.fields.getTextInputValue("event_image").trim() || undefined;
    persistState();
    await interaction.deferReply({ ephemeral: true });
    await updateEventMessages(interaction.guild, channelId);
    await interaction.editReply({ content: "✅ Updated!" });
    try { await pendingGearMenus.get(channelId)?.deleteReply(); } catch {}
    pendingGearMenus.delete(channelId);
    return true;
  }

  return false;
}
