import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, Interaction } from "discord.js";
import { config } from "../config";
import { eventStates, persistState } from "../state";
import type { EventState, RSVPStatus } from "../types";
import { makeMemberEntry } from "../types";
import {
  buildJoinContent,
  buildJoinEmbed,
  buildInnerEmbed,
  joinMessageComponents,
  pinMessageComponents,
} from "../eventBuilders";
import { updateJoinMessage, updateInnerMessage, updateEventMessages } from "../messageSync";
import { hasAlbum, getAlbumUrl, handleAlbumInteractions, startAlbumForChannel } from "../albums";
import { dbAddAlbumMember, dbRemoveAlbumMember, dbUpsertUser } from "../db";
import { handleGearMenuInteractions, buildEventModalComponents } from "./gearMenuInteractions";

function getDisplayName(interaction: Interaction): string {
  const member = interaction.member;
  return (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
}

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

  if (await handleGearMenuInteractions(interaction)) return;

  // /event — open modal (only in the event announcement channel)
  if (interaction.isChatInputCommand() && interaction.commandName === "event") {
    if (interaction.channelId !== config.eventChannelId) {
      await interaction.reply({ content: `This command can only be used in <#${config.eventChannelId}>.`, ephemeral: true });
      return;
    }
    const modal = new ModalBuilder().setCustomId("event_modal").setTitle("Create Event");
    modal.addComponents(...buildEventModalComponents());
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
    state.members.set(interaction.user.id, makeMemberEntry(interaction.user.id, creatorName));

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
    modal.addComponents(...buildEventModalComponents({ eventName: channel.name.replace(/-/g, " ") }));
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
    state.members.set(interaction.user.id, makeMemberEntry(interaction.user.id, creatorName));

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
      const displayName = getDisplayName(interaction);
      state.members.set(interaction.user.id, makeMemberEntry(interaction.user.id, displayName));
      persistState();
      if (hasAlbum(channelId)) {
        dbUpsertUser(interaction.user.id, displayName, interaction.user.displayAvatarURL({ extension: "png", size: 128 }));
        dbAddAlbumMember(channelId, interaction.user.id);
      }
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

    if (hasAlbum(channelId)) dbRemoveAlbumMember(channelId, interaction.user.id);

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
      const displayName = getDisplayName(interaction);
      state.members.set(interaction.user.id, makeMemberEntry(interaction.user.id, displayName, "lurking", count));
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

    await interaction.reply({ ephemeral: true, content: `Your RSVP has been updated to **${RSVP_LABELS[statusStr]}**.` });

    const state = eventStates.get(channelId);
    if (state) {
      const existing = state.members.get(interaction.user.id);
      if (existing) {
        existing.status = statusStr;
      } else {
        const displayName = getDisplayName(interaction);
        state.members.set(interaction.user.id, makeMemberEntry(interaction.user.id, displayName, statusStr));
      }
      persistState();
      await updateInnerMessage(g, channelId);
    }
    return;
  }

  // /album — start photo album for this channel
  if (interaction.isChatInputCommand() && interaction.commandName === "album") {
    const channelId = interaction.channelId;
    if (!hasRole()) {
      await interaction.reply({ content: "You don't have permission.", ephemeral: true });
      return;
    }
    if (hasAlbum(channelId)) {
      await interaction.reply({ content: `This channel's album is available at ${getAlbumUrl(channelId)}.` });
      return;
    }
    if (!interaction.guild) return;
    await interaction.deferReply();
    const ch = interaction.channel;
    const channelName = ch && "name" in ch && ch.name ? ch.name : channelId;
    const eventState = eventStates.get(channelId);
    const albumName = eventState?.eventName ?? channelName;
    const albumUrl = await startAlbumForChannel(channelId, interaction.guild, albumName);
    await interaction.editReply(`📸 Photo album started for **${albumName}**! ${albumUrl}`);
    const reply = await interaction.fetchReply();
    try { await reply.pin(); } catch (e) { console.error("Failed to pin album message:", e); }
    if (eventState) await updateEventMessages(interaction.guild, channelId);
    return;
  }

  const albumChannelId = await handleAlbumInteractions(interaction);
  if (albumChannelId && interaction.guild) {
    await updateEventMessages(interaction.guild, albumChannelId);
  }
}
