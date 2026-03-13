import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Message,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import dotenv from "dotenv";
import { config } from "./config";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, (message: Message) => {
  if (message.author.bot) return;

  if (process.env.WOOF_ENABLED === "true") {
    const match = message.content.match(/himiko([!?.,]*)/i);
    if (match && message.channel.isSendable()) {
      const word = match[0].replace(/[!?.,]*$/, "");
      const punct = match[1];
      let woof: string;
      if (word === word.toUpperCase()) woof = "WOOF";
      else if (word[0] === word[0].toUpperCase()) woof = "Woof";
      else woof = "woof";
      message.channel.send(woof + punct);
    }
  }
});

// ─── State ────────────────────────────────────────────────────────────────────

type RSVPStatus = "coming" | "maybe" | "interested" | "decline";

type MemberEntry = {
  userId: string;
  displayName: string;
  status: RSVPStatus;
};

type EventState = {
  eventName: string;
  description: string;
  location: string;
  dateText: string;
  joinMessageId: string;
  pinMessageId: string;
  joiningEnabled: boolean;
  scheduledEventId?: string;
  members: Map<string, MemberEntry>;
};

type EditSession = {
  day: number | null;
  month: number | null;
  year: number | null;
  time: string | null;
  dayPage: "low" | "high";
  timePage: "late" | "mid" | "early";
};

const eventStates = new Map<string, EventState>();
const editSessions = new Map<string, EditSession>();

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maxDaysInMonth(month: number | null, year: number | null): number {
  if (!month) return 31;
  return new Date(year ?? 2024, month, 0).getDate();
}

function parseDateText(dateText: string): Date | null {
  try {
    const [datePart, timePart] = dateText.split(", ");
    const [dayStr, monthStr, yearStr] = datePart.split(" ");
    const [hourStr, minuteStr] = timePart.split(":");
    return new Date(parseInt(yearStr), MONTHS.indexOf(monthStr), parseInt(dayStr), parseInt(hourStr), parseInt(minuteStr));
  } catch { return null; }
}

// ─── Embed / component builders ───────────────────────────────────────────────

const SPACER = "⠀".repeat(40);
const JOIN_LABEL = "⠀".repeat(12) + "Join" + "⠀".repeat(12);
const LEAVE_LABEL = "⠀".repeat(11) + "Leave" + "⠀".repeat(12);

function buildDescText(description: string, location: string, dateText: string): string {
  const parts: string[] = [];
  if (description) {
    parts.push(description);
    parts.push(`\n\n\n📅 **When:** ${dateText}`);
  } else {
    parts.push(`📅 **When:** ${dateText}`);
  }
  parts.push(`\n📍 **Where:** ${location}`);
  parts.push(`\n${SPACER}`);
  return parts.join("\n");
}

function buildJoinEmbed(state: EventState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText))
    .setColor(0x5865F2);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (state.members.size > 0) {
    const mentions = [...state.members.values()].map(m => `<@${m.userId}>`).join(" ");
    embed.addFields({ name: `👥 ${state.members.size} Interested`, value: mentions });
  }
  return embed;
}

function buildInnerEmbed(state: EventState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText))
    .setColor(0x5865F2);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  if (state.members.size > 0) {
    const groups: Record<RSVPStatus, string[]> = { coming: [], maybe: [], interested: [], decline: [] };
    for (const m of state.members.values()) groups[m.status].push(m.userId);

    const formatGroup = (label: string, ids: string[]) =>
      ids.length ? `**${label} (${ids.length})**\n${ids.map(id => `- <@${id}>`).join("\n")}` : null;

    const sections = [
      formatGroup("Coming ✅", groups.coming),
      formatGroup("Maybe ❔", groups.maybe),
      formatGroup("Interested 👀", groups.interested),
      formatGroup("Declined ❌", groups.decline),
    ].filter(Boolean) as string[];

    if (sections.length) embed.addFields({ name: "\u200b", value: sections.join("\n\n") });
  }
  return embed;
}

function joinMessageComponents(channelId: string, joiningEnabled: boolean) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`join_event_${channelId}`).setLabel(JOIN_LABEL).setStyle(ButtonStyle.Primary).setDisabled(!joiningEnabled),
  )];
}

function rsvpComponents(channelId: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("Coming ✅").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("Maybe ❔").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_interested_${channelId}`).setLabel("Interested 👀").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("Decline ❌").setStyle(ButtonStyle.Primary),
  )];
}

function pinMessageComponents(channelId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("Coming ✅").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("Maybe ❔").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_interested_${channelId}`).setLabel("Interested 👀").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("Decline ❌").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`edit_menu_${channelId}`).setLabel("⚙").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildGearMenuComponents(channelId: string, joiningEnabled: boolean) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`edit_open_date_${channelId}`).setLabel("Edit Date").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`edit_open_desc_${channelId}`).setLabel("Edit Description").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`gear_generate_${channelId}`).setLabel("Generate Event").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`gear_toggle_join_${channelId}`).setLabel(joiningEnabled ? "Disable Joining" : "Enable Joining").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`gear_delete_ask_${channelId}`).setLabel("Delete Event").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`close_edit_${channelId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function backRow(channelId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`gear_back_${channelId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
}

// ─── Edit date picker ─────────────────────────────────────────────────────────

function buildEditDateContent(session: EditSession): string {
  const day = session.day ? `${session.day}` : "?";
  const month = session.month ? MONTHS[session.month - 1] : "?";
  const year = session.year ? `${session.year}` : "?";
  const time = session.time ?? "?";
  return `**Setting date:** ${day} ${month} ${year}, ${time}`;
}

function buildTimeSelect(session: EditSession, channelId: string): StringSelectMenuBuilder {
  const select = new StringSelectMenuBuilder().setCustomId(`edit_time_${channelId}`).setPlaceholder("Time");
  const addTime = (total: number) => {
    const h = Math.floor(total / 60);
    const m = total % 60;
    const t = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel(t).setValue(t).setDefault(session.time === t));
  };
  if (session.timePage === "late") {
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("← Earlier").setValue("earlier"));
    for (let t = 18 * 60; t <= 23 * 60 + 45; t += 15) addTime(t);
  } else if (session.timePage === "mid") {
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("← Earlier").setValue("earlier"));
    for (let t = 12 * 60 + 15; t <= 17 * 60 + 45; t += 15) addTime(t);
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Later →").setValue("later"));
  } else {
    for (let t = 6 * 60 + 30; t <= 12 * 60; t += 15) addTime(t);
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Later →").setValue("later"));
  }
  return select;
}

function buildEditDateComponents(session: EditSession, channelId: string) {
  const maxDays = maxDaysInMonth(session.month, session.year);
  const daySelect = new StringSelectMenuBuilder().setCustomId(`edit_day_${channelId}`).setPlaceholder("Day");
  if (session.dayPage === "low") {
    const limit = Math.min(24, maxDays);
    for (let i = 1; i <= limit; i++) {
      daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${i}`).setValue(`${i}`).setDefault(session.day === i));
    }
    if (maxDays > 24) daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel("25+").setValue("more"));
  } else {
    for (let i = 25; i <= maxDays; i++) {
      daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${i}`).setValue(`${i}`).setDefault(session.day === i));
    }
    daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel("← 1–24").setValue("back"));
  }

  const monthSelect = new StringSelectMenuBuilder().setCustomId(`edit_month_${channelId}`).setPlaceholder("Month");
  MONTHS.forEach((m, i) => monthSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(m).setValue(`${i + 1}`).setDefault(session.month === i + 1)));

  const currentYear = new Date().getFullYear();
  const yearSelect = new StringSelectMenuBuilder().setCustomId(`edit_year_${channelId}`).setPlaceholder("Year");
  for (let y = currentYear; y <= currentYear + 4; y++) {
    yearSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${y}`).setValue(`${y}`).setDefault(session.year === y));
  }

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(daySelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(monthSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(yearSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildTimeSelect(session, channelId)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`edit_confirm_${channelId}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`edit_tbc_${channelId}`).setLabel("Set to TBC").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`edit_cancel_${channelId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Message sync ─────────────────────────────────────────────────────────────

async function updateJoinMessage(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ embeds: [buildJoinEmbed(state, guild.iconURL())], components: joinMessageComponents(channelId, state.joiningEnabled) });
    } catch (e) { console.error("Failed to update join message:", e); }
  }
}

async function updateInnerMessage(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const eventChannel = guild.channels.cache.get(channelId);
  if (eventChannel && eventChannel.type === ChannelType.GuildText) {
    try {
      const pinMsg = await eventChannel.messages.fetch(state.pinMessageId);
      await pinMsg.edit({ embeds: [buildInnerEmbed(state, guild.iconURL())], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

async function updateEventMessages(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const iconUrl = guild.iconURL();

  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ embeds: [buildJoinEmbed(state, iconUrl)], components: joinMessageComponents(channelId, state.joiningEnabled) });
    } catch (e) { console.error("Failed to update join message:", e); }
  }

  const eventChannel = guild.channels.cache.get(channelId);
  if (eventChannel && eventChannel.type === ChannelType.GuildText) {
    try {
      await eventChannel.setTopic(state.description || null);
      const pinMsg = await eventChannel.messages.fetch(state.pinMessageId);
      await pinMsg.edit({ embeds: [buildInnerEmbed(state, iconUrl)], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

// ─── Interactions ─────────────────────────────────────────────────────────────

const RSVP_LABELS: Record<RSVPStatus, string> = {
  coming: "Coming ✅",
  maybe: "Maybe ❔",
  interested: "Interested 👀",
  decline: "Decline ❌",
};

client.on(Events.InteractionCreate, async (interaction) => {
  try {
  const hasRole = () => {
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    return member?.roles.cache.has(config.requiredRoleId) ?? false;
  };

  if (interaction.isChatInputCommand() && !hasRole()) {
    await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
    return;
  }

  // /event — open modal
  if (interaction.isChatInputCommand() && interaction.commandName === "event") {
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
    );
    await interaction.showModal(modal);
  }

  // event_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "event_modal") {
    const eventName = interaction.fields.getTextInputValue("event_name").trim();
    const description = interaction.fields.getTextInputValue("event_desc").trim();
    const location = interaction.fields.getTextInputValue("event_location").trim();
    const guild = interaction.guild;
    if (!guild) return;

    await interaction.deferReply({ ephemeral: true });

    const eventChannel = await guild.channels.create({
      name: eventName.toLowerCase().replace(/\s+/g, "-"),
      type: ChannelType.GuildText,
      parent: config.eventCategoryId,
      topic: description || undefined,
    });

    await eventChannel.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ]);

    const iconUrl = guild.iconURL();
    const creator = guild.members.cache.get(interaction.user.id);
    const creatorName = creator?.displayName ?? interaction.user.displayName;

    const state: EventState = {
      eventName, description, location, dateText: "TBC",
      joinMessageId: "", pinMessageId: "",
      joiningEnabled: true, members: new Map(),
    };

    const pinMsg = await eventChannel.send({
      content: "Please use the buttons to RSVP!",
      embeds: [buildInnerEmbed(state, iconUrl)],
      components: pinMessageComponents(eventChannel.id),
    });
    await pinMsg.pin();

    const announcementChannel = guild.channels.cache.get(config.eventChannelId);
    let joinMsgId = "";
    if (announcementChannel && announcementChannel.isSendable()) {
      const joinMsg = await announcementChannel.send({
        content: `**${creatorName}** created an event. Click to join!`,
        embeds: [buildJoinEmbed(state, iconUrl)],
        components: joinMessageComponents(eventChannel.id, true),
      });
      joinMsgId = joinMsg.id;
    }

    state.joinMessageId = joinMsgId;
    state.pinMessageId = pinMsg.id;
    eventStates.set(eventChannel.id, state);
    await interaction.editReply({ content: "Event created! Use the ⚙ button inside the channel to set the date when you're ready." });
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
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true),
    });
  }

  // Close gear menu
  if (interaction.isButton() && interaction.customId.startsWith("close_edit_")) {
    await interaction.deferUpdate();
    await interaction.deleteReply();
  }

  // Back to gear menu
  if (interaction.isButton() && interaction.customId.startsWith("gear_back_")) {
    const channelId = interaction.customId.slice("gear_back_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true),
    });
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
  }

  // Toggle joining
  if (interaction.isButton() && interaction.customId.startsWith("gear_toggle_join_")) {
    const channelId = interaction.customId.slice("gear_toggle_join_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) return;

    state.joiningEnabled = !state.joiningEnabled;
    await updateJoinMessage(interaction.guild, channelId);

    await interaction.update({
      content: `Joining is now **${state.joiningEnabled ? "enabled" : "disabled"}**.`,
      components: [backRow(channelId)],
    });
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

    try { await interaction.editReply({ content: "✅ Event deleted.", components: [] }); } catch { /* ephemeral may be gone */ }
  }

  // Delete Event — cancel
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_cancel_")) {
    const channelId = interaction.customId.slice("gear_delete_cancel_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true),
    });
  }

  // Edit Date
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_date_")) {
    const channelId = interaction.customId.slice("edit_open_date_".length);
    const now = new Date();
    const defaultDay = now.getDate();
    const session: EditSession = {
      day: defaultDay,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      time: "18:00",
      dayPage: defaultDay > 24 ? "high" : "low",
      timePage: "late",
    };
    editSessions.set(channelId, session);
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Edit Description
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_desc_")) {
    const channelId = interaction.customId.slice("edit_open_desc_".length);
    const state = eventStates.get(channelId);
    const modal = new ModalBuilder().setCustomId(`edit_desc_modal_${channelId}`).setTitle("Edit Event");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(state?.description ?? "")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(true).setValue(state?.location ?? "")
      ),
    );
    await interaction.showModal(modal);
  }

  // Edit Description modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("edit_desc_modal_")) {
    const channelId = interaction.customId.slice("edit_desc_modal_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) {
      await interaction.reply({ content: "Event state not found — was the bot restarted?", ephemeral: true });
      return;
    }
    state.description = interaction.fields.getTextInputValue("event_desc").trim();
    state.location = interaction.fields.getTextInputValue("event_location").trim();
    await interaction.deferReply({ ephemeral: true });
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();
  }

  // Day select
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_day_")) {
    const channelId = interaction.customId.slice("edit_day_".length);
    const session = editSessions.get(channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "more") { session.dayPage = "high"; }
    else if (value === "back") { session.dayPage = "low"; session.day = null; }
    else { session.day = parseInt(value); }
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Month select
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_month_")) {
    const channelId = interaction.customId.slice("edit_month_".length);
    const session = editSessions.get(channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.month = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Year select
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_year_")) {
    const channelId = interaction.customId.slice("edit_year_".length);
    const session = editSessions.get(channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.year = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Time select (handles Earlier/Later navigation too)
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_time_")) {
    const channelId = interaction.customId.slice("edit_time_".length);
    const session = editSessions.get(channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "earlier") {
      if (session.timePage === "late") session.timePage = "mid";
      else if (session.timePage === "mid") session.timePage = "early";
    } else if (value === "later") {
      if (session.timePage === "early") session.timePage = "mid";
      else if (session.timePage === "mid") session.timePage = "late";
    } else {
      session.time = value;
    }
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Confirm date
  if (interaction.isButton() && interaction.customId.startsWith("edit_confirm_")) {
    const channelId = interaction.customId.slice("edit_confirm_".length);
    const session = editSessions.get(channelId);
    if (!session || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    if (!session.day || !session.month || !session.year || !session.time) {
      await interaction.update({ content: "Please select a day, month, year, and time first.", components: buildEditDateComponents(session, channelId) });
      return;
    }

    const [hour, minute] = session.time.split(":").map(Number);
    const startDate = new Date(session.year, session.month - 1, session.day, hour, minute);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
    const dateText = `${session.day} ${MONTHS[session.month - 1]} ${session.year}, ${session.time}`;

    await interaction.deferUpdate();

    const state = eventStates.get(channelId);
    editSessions.delete(channelId);
    if (state) state.dateText = dateText;
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();

    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      await eventChannel.send(`📅 The event date has been set to **${dateText}**.`);
    }
  }

  // Set date to TBC
  if (interaction.isButton() && interaction.customId.startsWith("edit_tbc_")) {
    const channelId = interaction.customId.slice("edit_tbc_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }

    editSessions.delete(channelId);
    const hadDate = state.dateText !== "TBC";
    state.dateText = "TBC";
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();

    if (hadDate) {
      const eventChannel = interaction.guild.channels.cache.get(channelId);
      if (eventChannel && eventChannel.type === ChannelType.GuildText) {
        await eventChannel.send(`📅 The event date has been reset to **TBC**.`);
      }
    }
  }

  // Cancel date
  if (interaction.isButton() && interaction.customId.startsWith("edit_cancel_")) {
    const channelId = interaction.customId.slice("edit_cancel_".length);
    editSessions.delete(channelId);
    await interaction.deferUpdate();
    await interaction.deleteReply();
  }

  // Join button
  if (interaction.isButton() && interaction.customId.startsWith("join_event_")) {
    const channelId = interaction.customId.slice("join_event_".length);
    const guild = interaction.guild;
    if (!guild) return;

    const state = eventStates.get(channelId);
    if (state && !state.joiningEnabled) {
      await interaction.reply({ content: "Joining is currently disabled for this event.", ephemeral: true });
      return;
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Event channel not found.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });

    if (state && !state.members.has(interaction.user.id)) {
      const member = guild.members.cache.get(interaction.user.id);
      const displayName = member?.displayName ?? interaction.user.displayName;
      state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: "interested" });
      await updateJoinMessage(guild, channelId);
      await updateInnerMessage(guild, channelId);
    }

    await channel.send(`**${interaction.user.displayName}** joined.`);
  }

  // Leave button
  if (interaction.isButton() && interaction.customId.startsWith("leave_event_")) {
    const channelId = interaction.customId.slice("leave_event_".length);
    const guild = interaction.guild;
    if (!guild) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Event channel not found.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    await channel.permissionOverwrites.delete(interaction.user.id);

    const state = eventStates.get(channelId);
    if (state) {
      state.members.delete(interaction.user.id);
      await updateJoinMessage(guild, channelId);
      await updateInnerMessage(guild, channelId);
    }

    await channel.send(`**${interaction.user.displayName}** left.`);
  }

  // RSVP buttons
  if (interaction.isButton() && interaction.customId.startsWith("rsvp_")) {
    const parts = interaction.customId.split("_");
    const statusStr = parts[1] as RSVPStatus;
    const channelId = parts.slice(2).join("_");
    const guild = interaction.guild;
    if (!guild) return;

    // Send confirmation to user FIRST, then update the embed
    await interaction.reply({ ephemeral: true, content: `Your RSVP has been updated to **${RSVP_LABELS[statusStr]}**.` });

    const state = eventStates.get(channelId);
    if (state) {
      const existing = state.members.get(interaction.user.id);
      if (existing) {
        existing.status = statusStr;
      } else {
        const member = guild.members.cache.get(interaction.user.id);
        const displayName = member?.displayName ?? interaction.user.displayName;
        state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: statusStr });
      }
      await updateInnerMessage(guild, channelId);
    }
  }

  } catch (error) {
    console.error("Unhandled interaction error:", error);
    try {
      const msg = { content: "Something went wrong. Check the debug log.", ephemeral: true };
      if (interaction.isRepliable()) {
        if ((interaction as any).deferred || (interaction as any).replied) {
          await (interaction as any).followUp(msg);
        } else {
          await (interaction as any).reply(msg);
        }
      }
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
