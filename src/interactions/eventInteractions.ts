import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, Interaction } from "discord.js";
import { config } from "../config";
import { eventStates, editSessions, pendingGearMenus, persistState } from "../state";
import type { EventState, RSVPStatus } from "../types";
import {
  buildJoinContent,
  buildJoinEmbed,
  buildInnerEmbed,
  joinMessageComponents,
  pinMessageComponents,
  buildGearMenuComponents,
  backRow,
} from "../eventBuilders";
import { parseDateText } from "../dateUtils";
import { updateJoinMessage, updateInnerMessage, updateEventMessages } from "../messageSync";
import { hasAlbum, handleAlbumInteractions } from "../albums";

const RSVP_LABELS: Record<RSVPStatus, string> = {
  coming: "✅ Coming",
  maybe: "❔ Maybe",
  decline: "❌ Decline",
  lurking: "👀 Lurking",
};

export async function handleEventInteractions(interaction: Interaction, guild: Guild | null): Promise<void> {
  const hasRole = () => {
    const roles = interaction.member?.roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes(config.requiredRoleId);
    return roles.cache.has(config.requiredRoleId);
  };

  // /event — open modal (only in the event announcement channel)
  if (interaction.isChatInputCommand() && interaction.commandName === "event") {
    if (interaction.channelId !== config.eventChannelId) {
      await interaction.reply({ content: `This command can only be used in <#${config.eventChannelId}>.`, ephemeral: true });
      return;
    }
    const modal = new ModalBuilder().setCustomId("event_modal").setTitle("Create Event");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_name").setLabel("Event name").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Optional")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_image").setLabel("Image URL").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Optional — replaces server icon in embed")
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // event_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "event_modal") {
    const eventName = interaction.fields.getTextInputValue("event_name").trim();
    const description = interaction.fields.getTextInputValue("event_desc").trim();
    const location = interaction.fields.getTextInputValue("event_location").trim();
    const imageUrl = interaction.fields.getTextInputValue("event_image").trim() || undefined;
    const g = interaction.guild;
    if (!g) return;

    await interaction.deferReply({ ephemeral: true });

    const eventChannel = await g.channels.create({
      name: eventName.toLowerCase().replace(/\s+/g, "-"),
      type: ChannelType.GuildText,
      parent: config.eventCategoryId,
      topic: description || undefined,
    });

    await eventChannel.permissionOverwrites.set([
      { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ]);

    const iconUrl = imageUrl || g.iconURL();
    const creator = g.members.cache.get(interaction.user.id);
    const creatorName = creator?.displayName ?? interaction.user.displayName;

    const state: EventState = {
      eventName, description, location, dateText: "TBC",
      joinMessageId: "", pinMessageId: "",
      joiningEnabled: true, members: new Map(), imageUrl,
    };
    state.creatorId = interaction.user.id;
    state.members.set(interaction.user.id, { userId: interaction.user.id, displayName: creatorName, status: "lurking", plusOne: 0 });

    const pinMsg = await eventChannel.send({
      content: "Please use the buttons to RSVP!",
      embeds: [buildInnerEmbed(state, iconUrl)],
      components: pinMessageComponents(eventChannel.id),
    });
    await pinMsg.pin();

    const announcementChannel = g.channels.cache.get(config.eventChannelId);
    let joinMsgId = "";
    if (announcementChannel && announcementChannel.isSendable()) {
      const joinMsg = await announcementChannel.send({
        content: buildJoinContent(state),
        embeds: [buildJoinEmbed(state, iconUrl)],
        components: joinMessageComponents(eventChannel.id, true),
      });
      joinMsgId = joinMsg.id;
    }

    state.joinMessageId = joinMsgId;
    state.pinMessageId = pinMsg.id;
    eventStates.set(eventChannel.id, state);
    persistState();
    await interaction.editReply({ content: "Done!" });
    await eventChannel.send("Use the ⚙ button to set the event date when you're ready.");
    return;
  }

  // /addevent — open modal (only in a channel inside the event category)
  if (interaction.isChatInputCommand() && interaction.commandName === "addevent") {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText || channel.parentId !== config.eventCategoryId) {
      await interaction.reply({ content: "This command can only be used inside an existing event channel.", ephemeral: true });
      return;
    }
    if (eventStates.has(interaction.channelId)) {
      await interaction.reply({ content: "This channel already has an event set up.", ephemeral: true });
      return;
    }
    const modal = new ModalBuilder().setCustomId("addevent_modal").setTitle("Add Event to Channel");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_name").setLabel("Event name").setStyle(TextInputStyle.Short).setRequired(true).setValue(channel.name.replace(/-/g, " "))
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Optional")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_image").setLabel("Image URL").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Optional — replaces server icon in embed")
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // addevent_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "addevent_modal") {
    const eventName = interaction.fields.getTextInputValue("event_name").trim();
    const description = interaction.fields.getTextInputValue("event_desc").trim();
    const location = interaction.fields.getTextInputValue("event_location").trim();
    const imageUrl = interaction.fields.getTextInputValue("event_image").trim() || undefined;
    const g = interaction.guild;
    const channel = interaction.channel;
    if (!g || !channel || channel.type !== ChannelType.GuildText) return;

    await interaction.deferReply({ ephemeral: true });

    if (description) await channel.setTopic(description);

    const iconUrl = imageUrl || g.iconURL();
    const creator = g.members.cache.get(interaction.user.id);
    const creatorName = creator?.displayName ?? interaction.user.displayName;

    const state: EventState = {
      eventName, description, location, dateText: "TBC",
      joinMessageId: "", pinMessageId: "",
      joiningEnabled: true, members: new Map(), imageUrl,
    };
    state.creatorId = interaction.user.id;
    state.members.set(interaction.user.id, { userId: interaction.user.id, displayName: creatorName, status: "lurking", plusOne: 0 });

    const pinMsg = await channel.send({
      content: "Please use the buttons to RSVP!",
      embeds: [buildInnerEmbed(state, iconUrl)],
      components: pinMessageComponents(channel.id),
    });
    await pinMsg.pin();

    const announcementChannel = g.channels.cache.get(config.eventChannelId);
    let joinMsgId = "";
    if (announcementChannel && announcementChannel.isSendable()) {
      const joinMsg = await announcementChannel.send({
        content: buildJoinContent(state),
        embeds: [buildJoinEmbed(state, iconUrl)],
        components: joinMessageComponents(channel.id, true),
      });
      joinMsgId = joinMsg.id;
    }

    state.joinMessageId = joinMsgId;
    state.pinMessageId = pinMsg.id;
    eventStates.set(channel.id, state);
    persistState();
    await interaction.editReply({ content: "Done!" });
    await channel.send("Use the ⚙ button to set the event date when you're ready.");
    return;
  }

  // /edit command
  if (interaction.isChatInputCommand() && interaction.commandName === "edit") {
    const channelId = interaction.channelId;
    if (!hasRole()) {
      await interaction.reply({ content: "You don't have permission.", ephemeral: true });
      return;
    }
    const state = eventStates.get(channelId);
    if (!state) {
      await interaction.reply({ content: "This command can only be used in an event channel.", ephemeral: true });
      return;
    }
    await interaction.reply({
      ephemeral: true,
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state.joiningEnabled, state.dateText, hasAlbum(channelId)),
    });
    pendingGearMenus.set(channelId, interaction);
    return;
  }

  // ⚙ gear menu
  if (interaction.isButton() && interaction.customId.startsWith("edit_menu_")) {
    const channelId = interaction.customId.slice("edit_menu_".length);
    if (!hasRole()) {
      await interaction.reply({ content: "You don't have permission.", ephemeral: true });
      return;
    }
    const state = eventStates.get(channelId);
    await interaction.reply({
      ephemeral: true,
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    pendingGearMenus.set(channelId, interaction);
    return;
  }

  // Close gear menu
  if (interaction.isButton() && interaction.customId.startsWith("close_edit_")) {
    await interaction.deferUpdate();
    await interaction.deleteReply();
    return;
  }

  // Back to gear menu
  if (interaction.isButton() && interaction.customId.startsWith("gear_back_")) {
    const channelId = interaction.customId.slice("gear_back_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    return;
  }

  // Generate Event
  if (interaction.isButton() && interaction.customId.startsWith("gear_generate_")) {
    const channelId = interaction.customId.slice("gear_generate_".length);
    const state = eventStates.get(channelId);

    if (!state || state.dateText === "TBC") {
      await interaction.update({
        content: "Please set the event date before generating the event.",
        components: [backRow(channelId)],
      });
      return;
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
    return;
  }

  // Toggle joining
  if (interaction.isButton() && interaction.customId.startsWith("gear_toggle_join_")) {
    const channelId = interaction.customId.slice("gear_toggle_join_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) return;

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
    return;
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
    return;
  }

  // Delete Event — confirm
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_confirm_")) {
    const channelId = interaction.customId.slice("gear_delete_confirm_".length);
    const state = eventStates.get(channelId);
    if (!interaction.guild) return;

    await interaction.deferUpdate();

    // Delete Discord scheduled event
    if (state?.scheduledEventId) {
      try { await interaction.guild.scheduledEvents.delete(state.scheduledEventId); } catch (e) { console.error("Failed to delete scheduled event:", e); }
    }

    // Delete join message in announcements
    if (state?.joinMessageId) {
      try {
        const announcementChannel = interaction.guild.channels.cache.get(config.eventChannelId);
        if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
          const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
          await joinMsg.delete();
        }
      } catch (e) { console.error("Failed to delete join message:", e); }
    }

    // Delete the event channel
    try {
      const eventChannel = interaction.guild.channels.cache.get(channelId);
      if (eventChannel) await eventChannel.delete();
    } catch (e) { console.error("Failed to delete event channel:", e); }

    eventStates.delete(channelId);
    persistState();

    try { await interaction.editReply({ content: "✅ Event deleted.", components: [] }); } catch { /* ephemeral may be gone */ }
    return;
  }

  // Delete Event — cancel
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_cancel_")) {
    const channelId = interaction.customId.slice("gear_delete_cancel_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC", hasAlbum(channelId)),
    });
    return;
  }

  // Edit Description
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_desc_")) {
    const channelId = interaction.customId.slice("edit_open_desc_".length);
    const state = eventStates.get(channelId);
    const modal = new ModalBuilder().setCustomId(`edit_desc_modal_${channelId}`).setTitle("Edit Event");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_name").setLabel("Event name").setStyle(TextInputStyle.Short).setRequired(true).setValue(state?.eventName ?? "")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(state?.description ?? "")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(true).setValue(state?.location ?? "")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_image").setLabel("Image URL").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Optional — replaces server icon in embed").setValue(state?.imageUrl ?? "")
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // Edit Description modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("edit_desc_modal_")) {
    const channelId = interaction.customId.slice("edit_desc_modal_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) {
      await interaction.reply({ content: "Event state not found — was the bot restarted?", ephemeral: true });
      return;
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
    return;
  }

  // Join button
  if (interaction.isButton() && interaction.customId.startsWith("join_event_")) {
    const channelId = interaction.customId.slice("join_event_".length);
    const g = interaction.guild;
    if (!g) return;

    const state = eventStates.get(channelId);
    if (state && !state.joiningEnabled) {
      await interaction.reply({ content: "Joining is currently disabled for this event.", ephemeral: true });
      return;
    }

    const channel = g.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Event channel not found.", ephemeral: true });
      return;
    }

    if (state?.members.has(interaction.user.id)) {
      await interaction.reply({ content: "You've already joined this event.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });

    if (state) {
      const member = interaction.member;
      const displayName = (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
      state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: "lurking", plusOne: 0 });
      persistState();
      await updateJoinMessage(g, channelId);
      await updateInnerMessage(g, channelId);
    }

    await channel.send(`**${interaction.user.displayName}** joined.`);
    return;
  }

  // Leave button
  if (interaction.isButton() && interaction.customId.startsWith("leave_event_")) {
    const channelId = interaction.customId.slice("leave_event_".length);
    const g = interaction.guild;
    if (!g) return;

    const channel = g.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Event channel not found.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    await channel.permissionOverwrites.delete(interaction.user.id);

    const state = eventStates.get(channelId);
    if (state) {
      state.members.delete(interaction.user.id);
      persistState();
      await updateJoinMessage(g, channelId);
      await updateInnerMessage(g, channelId);
    }

    await channel.send(`**${interaction.user.displayName}** left.`);
    return;
  }

  // +1 button — open modal
  if (interaction.isButton() && interaction.customId.startsWith("plusone_")) {
    const channelId = interaction.customId.slice("plusone_".length);
    const state = eventStates.get(channelId);
    const existing = state?.members.get(interaction.user.id);
    const modal = new ModalBuilder().setCustomId(`plusone_modal_${channelId}`).setTitle("Bring guests?");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("plusone_count")
          .setLabel("How many guests are you bringing? (0–5)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(existing?.plusOne ? `${existing.plusOne}` : "0")
      )
    );
    await interaction.showModal(modal);
    return;
  }

  // +1 modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("plusone_modal_")) {
    const channelId = interaction.customId.slice("plusone_modal_".length);
    const raw = interaction.fields.getTextInputValue("plusone_count").trim();
    const count = parseInt(raw);
    if (isNaN(count) || count < 0 || count > 5) {
      await interaction.reply({ ephemeral: true, content: "Please enter a number between 0 and 5." });
      return;
    }
    const state = eventStates.get(channelId);
    const g = interaction.guild;
    if (!state || !g) return;

    const existing = state.members.get(interaction.user.id);
    if (existing) {
      existing.plusOne = count;
    } else {
      const member = interaction.member;
      const displayName = (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
      state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: "lurking", plusOne: count });
    }
    persistState();
    await interaction.deferReply({ ephemeral: true });
    await updateInnerMessage(g, channelId);
    await updateJoinMessage(g, channelId);
    await interaction.editReply({ content: count === 0 ? "Your +1 has been removed." : `You're bringing ${count} guest${count > 1 ? "s" : ""}.` });
    return;
  }

  // RSVP buttons
  if (interaction.isButton() && interaction.customId.startsWith("rsvp_")) {
    const parts = interaction.customId.split("_");
    const statusStr = parts[1] as RSVPStatus;
    const channelId = parts.slice(2).join("_");
    const g = interaction.guild;
    if (!g) return;

    // Send confirmation to user FIRST, then update the embed
    await interaction.reply({ ephemeral: true, content: `Your RSVP has been updated to **${RSVP_LABELS[statusStr]}**.` });

    const state = eventStates.get(channelId);
    if (state) {
      const existing = state.members.get(interaction.user.id);
      if (existing) {
        existing.status = statusStr;
      } else {
        const member = interaction.member;
        const displayName = (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
        state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: statusStr, plusOne: 0 });
      }
      persistState();
      await updateInnerMessage(g, channelId);
    }
    return;
  }

  await handleAlbumInteractions(interaction);
}
