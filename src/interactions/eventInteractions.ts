import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
} from "discord.js";
import type { Guild, Interaction } from "discord.js";
import { config } from "../config";
import { eventStates, persistState } from "../state";
import type { RSVPStatus } from "../types";
import { makeMemberEntry } from "../types";
import { updateInnerMessage, updateEventMessages } from "../messageSync";
import { hasAlbum, getAlbumUrl, handleAlbumInteractions, startAlbumForChannel } from "../albums";
import { handleGearMenuInteractions, buildEventModalComponents } from "./gearMenuInteractions";
import { parseCreateDateText } from "../dateUtils";
import { createDiscordLoginLink } from "../auth";
import { setUpEvent, joinEvent } from "../eventCreation";

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

  // /event — a private link to the website's Create Event form, signed in as them
  if (interaction.isChatInputCommand() && interaction.commandName === "event") {
    if (interaction.channelId !== config.eventChannelId) {
      await interaction.reply({ content: `This command can only be used in <#${config.eventChannelId}>.`, ephemeral: true });
      return;
    }
    const link = createDiscordLoginLink(
      interaction.user.id, getDisplayName(interaction),
      interaction.user.displayAvatarURL({ extension: "png", size: 128 }), "/events/new");
    if (!link) {
      await interaction.reply({ content: "Your account can't sign in to the website — ask an admin.", ephemeral: true });
      return;
    }
    await interaction.reply({
      content: "Fill in your event on the website. The link signs you in and works once, for 15 minutes.",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Create event").setEmoji("📅").setURL(link))],
      ephemeral: true,
    });
    return;
  }

  // /rsvp — ping everyone who RSVP'd Maybe or Lurking
  if (interaction.isChatInputCommand() && interaction.commandName === "rsvp") {
    const channelId = interaction.channelId;
    const state = eventStates.get(channelId);
    if (!state) {
      await interaction.reply({ content: "This command can only be used in an event channel.", ephemeral: true });
      return;
    }
    const targets = [...state.members.values()].filter(m => m.status === "maybe" || m.status === "lurking");
    if (!targets.length) {
      await interaction.reply({ content: "No one has RSVP'd Maybe or Lurking.", ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) return;
    const mentions = targets.map(m => `<@${m.userId}>`).join(" ");
    const content = `${mentions}\nReminder to RSVP for ${state.eventName}!`;
    await interaction.deferReply({ ephemeral: true });
    try {
      const pinMsg = await channel.messages.fetch(state.pinMessageId);
      await pinMsg.reply(content);
    } catch (e) {
      console.error("Failed to fetch pin message for /rsvp reply:", e);
      if (channel.isSendable()) await channel.send(content);
    }
    await interaction.deleteReply();
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
    const location = interaction.fields.getTextInputValue("event_location").trim() || "TBC";
    const dateText = parseCreateDateText(
      interaction.fields.getTextInputValue("event_date").trim(),
      interaction.fields.getTextInputValue("event_time").trim()
    );
    const g = interaction.guild;
    const channel = interaction.channel;
    if (!g || !channel || channel.type !== ChannelType.GuildText) return;

    await interaction.deferReply({ ephemeral: true });

    if (description) await channel.setTopic(description.slice(0, 1024));
    const creatorName = g.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
    await setUpEvent(g, channel, interaction.user.id, creatorName, { eventName, description, location, dateText });
    await interaction.editReply({ content: "Done!" });
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

    if (state?.members.has(interaction.user.id)) {
      await interaction.reply({ content: "You've already joined this event.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    const result = await joinEvent(g, channelId, interaction.user, getDisplayName(interaction));
    if (result === "missing") await interaction.followUp({ content: "Event channel not found.", ephemeral: true });
    return;
  }

  // RSVP buttons
  if (interaction.isButton() && interaction.customId.startsWith("rsvp_")) {
    const parts = interaction.customId.split("_");
    const statusStr = parts[1] as RSVPStatus;
    const channelId = parts.slice(2).join("_");
    const g = interaction.guild;
    if (!g) return;

    await interaction.deferUpdate();

    const channel = g.channels.cache.get(channelId);

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

    if (channel && channel.type === ChannelType.GuildText) {
      await channel.send(`**${interaction.user.displayName}** RSVP'd ${RSVP_LABELS[statusStr]}.`);
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
