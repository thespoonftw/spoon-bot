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
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { config } from "./config";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  loadState();
  if (eventStates.size > 0) {
    const guild = readyClient.guilds.cache.get(config.guildId);
    if (guild) {
      for (const [channelId, state] of eventStates) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          for (const [id, overwrite] of channel.permissionOverwrites.cache) {
            if (overwrite.type !== OverwriteType.Member) continue;
            if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;
            if (state.members.has(id)) continue;
            try {
              const member = await guild.members.fetch(id);
              state.members.set(id, { userId: id, displayName: member.displayName, status: 'lurking', plusOne: 0 });
            } catch {}
          }
        }
      }
      persistState();
      for (const channelId of eventStates.keys()) {
        try { await updateEventMessages(guild, channelId); } catch (e) { console.error(`Failed to refresh ${channelId}:`, e); }
      }
      console.log(`Refreshed ${eventStates.size} event message(s).`);
    }
  }

  loadGroupState();
  if (config.groupsChannelId) {
    const guild = readyClient.guilds.cache.get(config.guildId);
    if (guild) {
      for (const [channelId, state] of groupStates) {
        if (state.members.size === 0) {
          const channel = guild.channels.cache.get(channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            for (const [id, overwrite] of channel.permissionOverwrites.cache) {
              if (overwrite.type !== OverwriteType.Member) continue;
              if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;
              try {
                const member = await guild.members.fetch(id);
                state.members.set(id, { userId: id, displayName: member.displayName });
              } catch {}
            }
          }
        }
      }
      persistGroupState();
      for (const [channelId] of groupStates) {
        await updateGroupMessages(guild, channelId);
      }
      if (groupStates.size > 0) console.log(`Refreshed ${groupStates.size} group message(s).`);
    }
  }

  if (process.env.HEADER_MESSAGE_ID) {
    const headerContent = [
      "Welcome to **brunch-events**.",
      "- Click the buttons to join the events.",
      "- Use the command `/event` to create your own events.",
      "- Use the command `/addevent` in an existing channel to list it here.",
      "- Messages in this channel will be automatically deleted.",
    ].join("\n");
    try {
      const guild = readyClient.guilds.cache.get(config.guildId);
      const channel = guild?.channels.cache.get(config.eventChannelId);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(process.env.HEADER_MESSAGE_ID);
        if (msg.content !== headerContent) await msg.edit(headerContent);
      }
    } catch (e) { console.error("Failed to update header message:", e); }
  }

  if (process.env.GROUPS_HEADER_MESSAGE_ID && config.groupsChannelId) {
    const headerContent = [
      "Welcome to **snek-groups**.",
      "- Click the buttons to join the groups.",
      "- Use the command `/group` to create your own groups.",
      "- Use the command `/addgroup` in an existing channel to list it here.",
      "- Messages in this channel will be automatically deleted.",
    ].join("\n");
    try {
      const guild = readyClient.guilds.cache.get(config.guildId);
      const channel = guild?.channels.cache.get(config.groupsChannelId);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(process.env.GROUPS_HEADER_MESSAGE_ID);
        if (msg.content !== headerContent) await msg.edit(headerContent);
      }
    } catch (e) { console.error("Failed to update groups header message:", e); }
  }
});

client.on(Events.MessageCreate, (message: Message) => {
  if (message.author.bot) return;

  if (process.env.HEADER_MESSAGE_ID && message.channelId === config.eventChannelId) {
    message.delete().catch(() => {});
    return;
  }

  if (config.groupsChannelId && message.channelId === config.groupsChannelId) {
    message.delete().catch(() => {});
    return;
  }

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

type RSVPStatus = "coming" | "maybe" | "decline" | "lurking";

type MemberEntry = {
  userId: string;
  displayName: string;
  status: RSVPStatus;
  plusOne: number;
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
  endDateText?: string;
  creatorId?: string;
  members: Map<string, MemberEntry>;
};

type EditSession = {
  day: number | null;
  month: number | null;
  year: number | null;
  time: string | null;       // "HH:MM", "All Day", or null
  timeHour: number | null;   // null = show hour dropdown; 0-23 = show minute dropdown
  dayPage: "low" | "high";
};

const eventStates = new Map<string, EventState>();
const editSessions = new Map<string, EditSession>();

type GroupMemberEntry = {
  userId: string;
  displayName: string;
};

type GroupState = {
  groupName: string;
  description: string;
  joinMessageId: string;
  pinMessageId: string;
  members: Map<string, GroupMemberEntry>;
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Persistence ──────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "..", process.env.DATA_DIR ?? "data");
const STATE_FILE = path.join(DATA_DIR, "events.json");
const GROUP_STATE_FILE = path.join(DATA_DIR, "groups.json");
const groupStates = new Map<string, GroupState>();

function loadGroupState() {
  if (!fs.existsSync(GROUP_STATE_FILE)) return;
  const raw = JSON.parse(fs.readFileSync(GROUP_STATE_FILE, "utf-8")) as [string, any][];
  for (const [channelId, s] of raw) {
    groupStates.set(channelId, { ...s, members: new Map(s.members) });
  }
  console.log(`Loaded ${groupStates.size} group(s) from disk.`);
}

function persistGroupState() {
  const serializable = [...groupStates.entries()].map(([id, s]) => [id, { ...s, members: [...s.members.entries()] }]);
  fs.writeFileSync(GROUP_STATE_FILE, JSON.stringify(serializable, null, 2));
}

function persistState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj: Record<string, any> = {};
    for (const [channelId, state] of eventStates) {
      obj[channelId] = { ...state, members: [...state.members.entries()] };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) { console.error("Failed to persist state:", e); }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    for (const [channelId, data] of Object.entries(raw) as [string, any][]) {
      eventStates.set(channelId, { ...data, members: new Map(data.members) });
    }
    console.log(`Loaded ${eventStates.size} event(s) from disk.`);
  } catch (e) { console.error("Failed to load state:", e); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maxDaysInMonth(month: number | null, year: number | null): number {
  if (!month) return 31;
  return new Date(year ?? 2024, month, 0).getDate();
}

function parseDateText(dateText: string): Date | null {
  try {
    const [datePart, timePart] = dateText.split(", ");
    const [dayStr, monthStr, yearStr] = datePart.split(" ");
    if (timePart === "All Day") {
      return new Date(parseInt(yearStr), MONTHS.indexOf(monthStr), parseInt(dayStr), 12, 0);
    }
    const [hourStr, minuteStr] = timePart.split(":");
    return new Date(parseInt(yearStr), MONTHS.indexOf(monthStr), parseInt(dayStr), parseInt(hourStr), parseInt(minuteStr));
  } catch { return null; }
}

function sessionFromDateText(dateText: string): EditSession | null {
  if (dateText === "TBC") return null;
  try {
    const commaIdx = dateText.lastIndexOf(", ");
    const datePart = dateText.slice(0, commaIdx);
    const timePart = dateText.slice(commaIdx + 2);
    const parts = datePart.split(" ");
    const day = parseInt(parts[1]);
    const month = MONTHS.indexOf(parts[2]) + 1;
    const year = parseInt(parts[3]);
    if (!day || !month || !year) return null;
    return { day, month, year, time: timePart, timeHour: null, dayPage: day > 24 ? "high" : "low" };
  } catch { return null; }
}

// ─── Embed / component builders ───────────────────────────────────────────────

const SPACER = "⠀".repeat(40);
const JOIN_LABEL = "⠀".repeat(12) + "Join" + "⠀".repeat(12);
const LEAVE_LABEL = "⠀".repeat(11) + "Leave" + "⠀".repeat(12);
const HALF_JOIN_LABEL = "⠀".repeat(6) + "Join" + "⠀".repeat(6);
const HALF_LEAVE_LABEL = "⠀".repeat(5) + "Leave" + "⠀".repeat(5);

function buildDescText(description: string, location: string, dateText: string, endDateText?: string): string {
  const parts: string[] = [];
  let startDisplay = dateText;
  if (endDateText && dateText.endsWith(", All Day")) {
    startDisplay = dateText.slice(0, dateText.lastIndexOf(", All Day"));
  }
  if (description) {
    parts.push(description);
    parts.push(`\n📅 **${endDateText ? "From" : "When"}:** ${startDisplay}`);
  } else {
    parts.push(`📅 **${endDateText ? "From" : "When"}:** ${startDisplay}`);
  }
  if (endDateText) {
    parts.push(`\n🏁 **To:** ${endDateText}`);
  }
  parts.push(`\n📍 **Where:** ${location}`);
  parts.push(`\n${SPACER}`);
  return parts.join("\n");
}

function buildJoinContent(state: EventState): string {
  if (!state.joiningEnabled) return "Joining this event is now closed.";
  if (state.creatorId) return `@everyone <@${state.creatorId}> created an event. Click to join!`;
  return "@everyone Click to join!";
}

function buildJoinEmbed(state: EventState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText, state.endDateText))
    .setColor(0x5865F2);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (state.members.size > 0) {
    const mentions = [...state.members.values()].map(m => `<@${m.userId}>`).join(" ");
    const totalCount = state.members.size;
    embed.addFields({ name: `👥 ${totalCount} Interested`, value: mentions });
  }
  return embed;
}

function buildInnerEmbed(state: EventState, thumbnailUrl?: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText, state.endDateText))
    .setColor(0x5865F2);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  if (state.members.size > 0) {
    const groups: Record<RSVPStatus, string[]> = { coming: [], maybe: [], decline: [], lurking: [] };
    for (const m of state.members.values()) groups[m.status]?.push(m.userId);

    const formatGroup = (label: string, ids: string[]) => {
      if (!ids.length) return null;
      const total = ids.reduce((sum, id) => sum + 1 + (state.members.get(id)?.plusOne ?? 0), 0);
      const lines = ids.map(id => {
        const m = state.members.get(id);
        return m?.plusOne ? `- <@${id}> +${m.plusOne}` : `- <@${id}>`;
      });
      return `**${label} (${total})**\n${lines.join("\n")}`;
    };

    const sections = [
      formatGroup("✅ Coming", groups.coming),
      formatGroup("❔ Maybe", groups.maybe),
      formatGroup("❌ Declined", groups.decline),
      formatGroup("👀 Lurking", groups.lurking),
    ].filter(Boolean) as string[];

    if (sections.length) embed.addFields({ name: "\u200b", value: sections.join("\n\n") });
  }
  return embed;
}

function joinMessageComponents(channelId: string, joiningEnabled: boolean) {
  if (!joiningEnabled) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`join_event_${channelId}`).setLabel(JOIN_LABEL).setStyle(ButtonStyle.Primary),
  )];
}

function rsvpComponents(channelId: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("✅ Coming").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("❔ Maybe").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_lurking_${channelId}`).setLabel("👀 Lurking").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`plusone_${channelId}`).setLabel("👥 +1").setStyle(ButtonStyle.Secondary),
  )];
}

function pinMessageComponents(channelId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("✅ Coming").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("❔ Maybe").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_lurking_${channelId}`).setLabel("👀 Lurking").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`plusone_${channelId}`).setLabel("👥 +1").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`edit_menu_${channelId}`).setLabel("⚙").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildGearMenuComponents(channelId: string, joiningEnabled: boolean, dateText: string) {
  const row1: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(`edit_open_date_${channelId}`).setLabel("Edit Date/Time").setStyle(ButtonStyle.Primary),
  ];
  if (dateText !== "TBC") {
    row1.push(new ButtonBuilder().setCustomId(`edit_open_enddate_${channelId}`).setLabel("Edit End Date/Time").setStyle(ButtonStyle.Primary));
  }
  row1.push(
    new ButtonBuilder().setCustomId(`edit_open_desc_${channelId}`).setLabel("Edit Description").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gear_generate_${channelId}`).setLabel("Generate Discord Event").setStyle(ButtonStyle.Primary),
  );
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...row1),
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

function buildEditDateContent(session: EditSession, endMode: boolean = false): string {
  const day = session.day ? `${session.day}` : "?";
  const month = session.month ? MONTHS[session.month - 1] : "?";
  const year = session.year ? `${session.year}` : "?";
  const time = session.time ?? (session.timeHour !== null ? `${session.timeHour.toString().padStart(2, "0")}:?` : "?");
  return `**Setting ${endMode ? "end " : ""}date:** ${day} ${month} ${year}, ${time}`;
}

function buildHourSelect(session: EditSession, channelId: string, endMode: boolean): StringSelectMenuBuilder {
  const customId = `edit_${endMode ? "end" : ""}time_${channelId}`;
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select time");
  const currentHour = (session.time && session.time !== "All Day") ? parseInt(session.time.split(":")[0]) : null;
  select.addOptions(new StringSelectMenuOptionBuilder().setLabel("All Day").setValue("allday").setDefault(session.time === "All Day"));
  for (let h = 0; h <= 23; h++) {
    const label = `${h.toString().padStart(2, "0")}:00`;
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel(label).setValue(`hour_${h}`).setDefault(currentHour === h && session.timeHour === null));
  }
  return select;
}

function buildMinuteSelect(session: EditSession, channelId: string, endMode: boolean): StringSelectMenuBuilder {
  const customId = `edit_${endMode ? "end" : ""}time_${channelId}`;
  const h = session.timeHour!;
  const hStr = h.toString().padStart(2, "0");
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select minutes");
  select.addOptions(new StringSelectMenuOptionBuilder().setLabel("← Return").setValue("return"));
  for (const m of [0, 15, 30, 45]) {
    const t = `${hStr}:${m.toString().padStart(2, "0")}`;
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel(t).setValue(t).setDefault(session.time === t));
  }
  return select;
}

function buildEditDateComponents(session: EditSession, channelId: string, endMode: boolean = false) {
  const p = endMode ? "end" : "";
  const maxDays = maxDaysInMonth(session.month, session.year);
  const daySelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}day_${channelId}`).setPlaceholder("Day");
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

  const monthSelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}month_${channelId}`).setPlaceholder("Month");
  MONTHS.forEach((m, i) => monthSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(m).setValue(`${i + 1}`).setDefault(session.month === i + 1)));

  const currentYear = new Date().getFullYear();
  const yearSelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}year_${channelId}`).setPlaceholder("Year");
  for (let y = currentYear; y <= currentYear + 4; y++) {
    yearSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${y}`).setValue(`${y}`).setDefault(session.year === y));
  }

  const timeRow = session.timeHour !== null
    ? new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildMinuteSelect(session, channelId, endMode))
    : new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildHourSelect(session, channelId, endMode));

  const confirmId = endMode ? `edit_endconfirm_${channelId}` : `edit_confirm_${channelId}`;
  const removeId = endMode ? `edit_endremove_${channelId}` : `edit_tbc_${channelId}`;
  const cancelId = endMode ? `edit_endcancel_${channelId}` : `edit_cancel_${channelId}`;
  const removeLabel = endMode ? "Remove End Date" : "Set to TBC";

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(daySelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(monthSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(yearSelect),
    timeRow,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(removeId).setLabel(removeLabel).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Group builders ───────────────────────────────────────────────────────────

function buildGroupJoinContent(state: GroupState): string {
  const header = state.description ? `**${state.groupName}:** ${state.description}` : `**${state.groupName}**`;
  const members = state.members.size === 0 ? "" : `\n\n👥 **${state.members.size} Member${state.members.size === 1 ? "" : "s"}:** ${[...state.members.values()].map(m => m.displayName).join(", ")}`;
  return `${header}${members}\n⠀`;
}

function buildGroupPinContent(state: GroupState): string {
  return `Welcome to **${state.groupName}**.`;
}

function groupJoinComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`group_join_${channelId}`).setLabel(HALF_JOIN_LABEL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(HALF_LEAVE_LABEL).setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`group_spacer_${channelId}`).setLabel("⠀").setStyle(ButtonStyle.Secondary).setDisabled(true),
    ),
  ];
}

function groupLeaveComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`group_leave_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`group_edit_${channelId}`).setLabel("⚙").setStyle(ButtonStyle.Secondary),
  )];
}

// ─── Message sync ─────────────────────────────────────────────────────────────

async function updateJoinMessage(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) return;
  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (announcementChannel && announcementChannel.type === ChannelType.GuildText) {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: buildJoinContent(state), embeds: [buildJoinEmbed(state, guild.iconURL())], components: joinMessageComponents(channelId, state.joiningEnabled) });
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
      await pinMsg.edit({ content: 'Please use the buttons to RSVP!', embeds: [buildInnerEmbed(state, guild.iconURL())], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

async function updateEventMessages(guild: Guild, channelId: string) {
  const state = eventStates.get(channelId);
  if (!state) { console.error(`updateEventMessages: no state for ${channelId}`); return; }
  const iconUrl = guild.iconURL();

  const announcementChannel = guild.channels.cache.get(config.eventChannelId);
  if (!announcementChannel) { console.error(`updateEventMessages: announcement channel ${config.eventChannelId} not in cache`); }
  else if (announcementChannel.type !== ChannelType.GuildText) { console.error(`updateEventMessages: announcement channel wrong type ${announcementChannel.type}`); }
  else {
    try {
      const joinMsg = await announcementChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: buildJoinContent(state), embeds: [buildJoinEmbed(state, iconUrl)], components: joinMessageComponents(channelId, state.joiningEnabled) });
    } catch (e: any) {
      if (e.code === 10008) { eventStates.delete(channelId); persistState(); return; }
      console.error("Failed to update join message:", e);
    }
  }

  const eventChannel = guild.channels.cache.get(channelId);
  if (!eventChannel) { console.error(`updateEventMessages: event channel ${channelId} not in cache`); }
  else if (eventChannel.type !== ChannelType.GuildText) { console.error(`updateEventMessages: event channel wrong type ${eventChannel.type}`); }
  else {
    try {
      await eventChannel.setTopic(state.description || null);
      const pinMsg = await eventChannel.messages.fetch(state.pinMessageId);
      await pinMsg.edit({ content: 'Please use the buttons to RSVP!', embeds: [buildInnerEmbed(state, iconUrl)], components: pinMessageComponents(channelId) });
    } catch (e) { console.error("Failed to update inner message:", e); }
  }
}

async function updateGroupMessages(guild: Guild, channelId: string) {
  const state = groupStates.get(channelId);
  if (!state || !config.groupsChannelId) return;
  const groupsChannel = guild.channels.cache.get(config.groupsChannelId);
  if (groupsChannel?.isTextBased()) {
    try {
      const joinMsg = await groupsChannel.messages.fetch(state.joinMessageId);
      await joinMsg.edit({ content: buildGroupJoinContent(state), components: groupJoinComponents(channelId) });
    } catch (e: any) {
      if (e.code === 10008) { groupStates.delete(channelId); persistGroupState(); return; }
      console.error("Failed to update group join message:", e);
    }
  }
  const groupChannel = guild.channels.cache.get(channelId);
  if (groupChannel?.isTextBased()) {
    try {
      const pinMsg = await groupChannel.messages.fetch(state.pinMessageId);
      await pinMsg.edit({ content: buildGroupPinContent(state), components: groupLeaveComponents(channelId) });
    } catch (e) { console.error("Failed to update group pin message:", e); }
  }
}

// ─── Interactions ─────────────────────────────────────────────────────────────

const RSVP_LABELS: Record<RSVPStatus, string> = {
  coming: "✅ Coming",
  maybe: "❔ Maybe",
  decline: "❌ Decline",
  lurking: "👀 Lurking",
};

client.on(Events.InteractionCreate, async (interaction) => {
  try {
  const hasRole = () => {
    const roles = interaction.member?.roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes(config.requiredRoleId);
    return roles.cache.has(config.requiredRoleId);
  };

  if (interaction.isChatInputCommand() && !hasRole()) {
    await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
    return;
  }

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
    state.creatorId = interaction.user.id;
    state.members.set(interaction.user.id, { userId: interaction.user.id, displayName: creatorName, status: "lurking", plusOne: 0 });

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
    );
    await interaction.showModal(modal);
  }

  // addevent_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "addevent_modal") {
    const eventName = interaction.fields.getTextInputValue("event_name").trim();
    const description = interaction.fields.getTextInputValue("event_desc").trim();
    const location = interaction.fields.getTextInputValue("event_location").trim();
    const guild = interaction.guild;
    const channel = interaction.channel;
    if (!guild || !channel || channel.type !== ChannelType.GuildText) return;

    await interaction.deferReply({ ephemeral: true });

    if (description) await channel.setTopic(description);

    const iconUrl = guild.iconURL();
    const creator = guild.members.cache.get(interaction.user.id);
    const creatorName = creator?.displayName ?? interaction.user.displayName;

    const state: EventState = {
      eventName, description, location, dateText: "TBC",
      joinMessageId: "", pinMessageId: "",
      joiningEnabled: true, members: new Map(),
    };
    state.creatorId = interaction.user.id;
    state.members.set(interaction.user.id, { userId: interaction.user.id, displayName: creatorName, status: "lurking", plusOne: 0 });

    const pinMsg = await channel.send({
      content: "Please use the buttons to RSVP!",
      embeds: [buildInnerEmbed(state, iconUrl)],
      components: pinMessageComponents(channel.id),
    });
    await pinMsg.pin();

    const announcementChannel = guild.channels.cache.get(config.eventChannelId);
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
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC"),
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
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC"),
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
    persistState();

    try { await interaction.editReply({ content: "✅ Event deleted.", components: [] }); } catch { /* ephemeral may be gone */ }
  }

  // Delete Event — cancel
  if (interaction.isButton() && interaction.customId.startsWith("gear_delete_cancel_")) {
    const channelId = interaction.customId.slice("gear_delete_cancel_".length);
    const state = eventStates.get(channelId);
    await interaction.update({
      content: "What would you like to do?",
      components: buildGearMenuComponents(channelId, state?.joiningEnabled ?? true, state?.dateText ?? "TBC"),
    });
  }

  // Edit Date
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_date_")) {
    const channelId = interaction.customId.slice("edit_open_date_".length);
    const state = eventStates.get(channelId);
    const existing = state ? sessionFromDateText(state.dateText) : null;
    const session: EditSession = existing ?? {
      day: null, month: null, year: null, time: null, timeHour: null, dayPage: "low",
    };
    editSessions.set(channelId, session);
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  // Edit End Date
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_enddate_")) {
    const channelId = interaction.customId.slice("edit_open_enddate_".length);
    const state = eventStates.get(channelId);
    const existing = state?.endDateText ? sessionFromDateText(state.endDateText) : null;
    const session: EditSession = existing ?? sessionFromDateText(state?.dateText ?? "TBC") ?? {
      day: null, month: null, year: null, time: null, timeHour: null, dayPage: "low",
    };
    editSessions.set(`end_${channelId}`, session);
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
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
    state.eventName = interaction.fields.getTextInputValue("event_name").trim();
    state.description = interaction.fields.getTextInputValue("event_desc").trim();
    state.location = interaction.fields.getTextInputValue("event_location").trim();
    persistState();
    await interaction.deferReply({ ephemeral: true });
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();
    const member = interaction.guild.members.cache.get(interaction.user.id);
    const displayName = member?.displayName ?? interaction.user.displayName;
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      await eventChannel.send(`✏️ **${displayName}** updated the event details.`);
    }
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_endday_")) {
    const channelId = interaction.customId.slice("edit_endday_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "more") { session.dayPage = "high"; }
    else if (value === "back") { session.dayPage = "low"; session.day = null; }
    else { session.day = parseInt(value); }
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_endmonth_")) {
    const channelId = interaction.customId.slice("edit_endmonth_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.month = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_endyear_")) {
    const channelId = interaction.customId.slice("edit_endyear_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.year = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
  }

  // Time select
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_time_")) {
    const channelId = interaction.customId.slice("edit_time_".length);
    const session = editSessions.get(channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "allday") {
      session.time = "All Day";
      session.timeHour = null;
    } else if (value.startsWith("hour_")) {
      const h = parseInt(value.slice(5));
      if (session.time && session.time !== "All Day" && parseInt(session.time.split(":")[0]) !== h) {
        session.time = null;
      } else if (!session.time || session.time === "All Day") {
        session.time = null;
      }
      session.timeHour = h;
    } else if (value === "return") {
      session.timeHour = null;
    } else {
      session.time = value;
    }
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("edit_endtime_")) {
    const channelId = interaction.customId.slice("edit_endtime_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "allday") {
      session.time = "All Day";
      session.timeHour = null;
    } else if (value.startsWith("hour_")) {
      const h = parseInt(value.slice(5));
      if (session.time && session.time !== "All Day" && parseInt(session.time.split(":")[0]) !== h) {
        session.time = null;
      } else if (!session.time || session.time === "All Day") {
        session.time = null;
      }
      session.timeHour = h;
    } else if (value === "return") {
      session.timeHour = null;
    } else {
      session.time = value;
    }
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
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

    let dayOfWeek: string;
    let dateText: string;
    if (session.time === "All Day") {
      const d = new Date(session.year, session.month - 1, session.day);
      dayOfWeek = DAYS[d.getDay()];
      dateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, All Day`;
    } else {
      const [hour, minute] = session.time.split(":").map(Number);
      const startDate = new Date(session.year, session.month - 1, session.day, hour, minute);
      dayOfWeek = DAYS[startDate.getDay()];
      dateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, ${session.time}`;
    }

    const state = eventStates.get(channelId);
    editSessions.delete(channelId);
    if (state) state.dateText = dateText;
    persistState();

    try { await interaction.deferUpdate(); } catch {}
    await updateEventMessages(interaction.guild, channelId);
    try { await interaction.deleteReply(); } catch {}

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const displayName = member?.displayName ?? interaction.user.displayName;
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      await eventChannel.send(`📅 **${displayName}** updated the event date to **${dateText}**.`);
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
    persistState();
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

  // Confirm end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endconfirm_")) {
    const channelId = interaction.customId.slice("edit_endconfirm_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    if (!session.day || !session.month || !session.year || !session.time) {
      await interaction.update({ content: "Please select a day, month, year, and time first.", components: buildEditDateComponents(session, channelId, true) });
      return;
    }
    const d = session.time === "All Day"
      ? new Date(session.year, session.month - 1, session.day)
      : (() => { const [h, m] = session.time!.split(":").map(Number); return new Date(session.year, session.month - 1, session.day, h, m); })();
    const dayOfWeek = DAYS[d.getDay()];
    const endDateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, ${session.time}`;
    const state = eventStates.get(channelId);
    editSessions.delete(`end_${channelId}`);
    if (state) state.endDateText = endDateText;
    persistState();
    try { await interaction.deferUpdate(); } catch {}
    await updateEventMessages(interaction.guild, channelId);
    try { await interaction.deleteReply(); } catch {}
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      const displayName = member?.displayName ?? interaction.user.displayName;
      await eventChannel.send(`🏁 **${displayName}** set the end date to **${endDateText}**.`);
    }
  }

  // Remove end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endremove_")) {
    const channelId = interaction.customId.slice("edit_endremove_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    editSessions.delete(`end_${channelId}`);
    state.endDateText = undefined;
    persistState();
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();
  }

  // Cancel end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endcancel_")) {
    const channelId = interaction.customId.slice("edit_endcancel_".length);
    editSessions.delete(`end_${channelId}`);
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
      persistState();
      await updateJoinMessage(guild, channelId);
      await updateInnerMessage(guild, channelId);
    }

    await channel.send(`**${interaction.user.displayName}** left.`);
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
    const guild = interaction.guild;
    if (!state || !guild) return;

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
    await updateInnerMessage(guild, channelId);
    await updateJoinMessage(guild, channelId);
    await interaction.editReply({ content: count === 0 ? "Your +1 has been removed." : `You're bringing ${count} guest${count > 1 ? "s" : ""}.` });
  }

  // /group — open modal
  if (interaction.isChatInputCommand() && interaction.commandName === "group") {
    if (!config.groupsChannelId) { await interaction.reply({ content: "Groups not configured on this server.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId("group_create_modal").setTitle("New Group");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Group Name").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false)
      ),
    );
    await interaction.showModal(modal);
  }

  // group_create_modal submit
  if (interaction.isModalSubmit() && interaction.customId === "group_create_modal") {
    const groupName = interaction.fields.getTextInputValue("name");
    const description = interaction.fields.getTextInputValue("description") ?? "";
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild!;
    const channelName = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.groupsCategoryId ?? null,
    });
    const channelId = channel.id;
    const tempState: GroupState = { groupName, description, joinMessageId: "", pinMessageId: "", members: new Map() };
    const groupsChannel = guild.channels.cache.get(config.groupsChannelId!);
    if (!groupsChannel?.isTextBased()) { await interaction.editReply("Groups channel not found."); return; }
    const joinMsg = await (groupsChannel as TextChannel).send({ content: buildGroupJoinContent(tempState), components: groupJoinComponents(channelId) });
    const pinMsg = await channel.send({ content: buildGroupPinContent(tempState), components: groupLeaveComponents(channelId) });
    tempState.joinMessageId = joinMsg.id;
    tempState.pinMessageId = pinMsg.id;
    groupStates.set(channelId, tempState);
    persistGroupState();
    await interaction.editReply({ content: `Group **${groupName}** created!` });
  }

  // /addgroup — open modal
  if (interaction.isChatInputCommand() && interaction.commandName === "addgroup") {
    if (!config.groupsChannelId) { await interaction.reply({ content: "Groups not configured on this server.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId(`addgroup_modal_${interaction.channelId}`).setTitle("Add Group");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Group Name").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false)
      ),
    );
    await interaction.showModal(modal);
  }

  // addgroup_modal_ submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("addgroup_modal_")) {
    const channelId = interaction.customId.slice("addgroup_modal_".length);
    const groupName = interaction.fields.getTextInputValue("name");
    const description = interaction.fields.getTextInputValue("description") ?? "";
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild!;
    const tempState: GroupState = { groupName, description, joinMessageId: "", pinMessageId: "", members: new Map() };
    const groupsChannel = guild.channels.cache.get(config.groupsChannelId!);
    if (!groupsChannel?.isTextBased()) { await interaction.editReply("Groups channel not found."); return; }
    const groupChannel = guild.channels.cache.get(channelId);
    if (!groupChannel?.isTextBased()) { await interaction.editReply("Could not find this channel."); return; }
    const joinMsg = await (groupsChannel as TextChannel).send({ content: buildGroupJoinContent(tempState), components: groupJoinComponents(channelId) });
    const pinMsg = await (groupChannel as TextChannel).send({ content: buildGroupPinContent(tempState), components: groupLeaveComponents(channelId) });
    tempState.joinMessageId = joinMsg.id;
    tempState.pinMessageId = pinMsg.id;
    groupStates.set(channelId, tempState);
    persistGroupState();
    await interaction.editReply({ content: `Group **${groupName}** set up!` });
  }

  // group_join_ button
  if (interaction.isButton() && interaction.customId.startsWith("group_join_")) {
    const channelId = interaction.customId.slice("group_join_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const userId = interaction.user.id;
    if (state.members.has(userId)) { await interaction.reply({ content: "You're already in this group.", flags: MessageFlags.Ephemeral }); return; }
    const member = interaction.guild?.members.cache.get(userId);
    const displayName = member?.displayName ?? interaction.user.displayName;
    state.members.set(userId, { userId, displayName });
    persistGroupState();
    await updateGroupMessages(interaction.guild!, channelId);
    await interaction.deferUpdate().catch(() => {});
  }

  // group_leave_ button
  if (interaction.isButton() && interaction.customId.startsWith("group_leave_")) {
    const channelId = interaction.customId.slice("group_leave_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const userId = interaction.user.id;
    state.members.delete(userId);
    persistGroupState();
    await updateGroupMessages(interaction.guild!, channelId);
    await interaction.deferUpdate().catch(() => {});
  }

  // group_edit_ gear button
  if (interaction.isButton() && interaction.customId.startsWith("group_edit_")) {
    const channelId = interaction.customId.slice("group_edit_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    const modal = new ModalBuilder().setCustomId(`group_edit_modal_${channelId}`).setTitle("Edit Group");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Group Name").setStyle(TextInputStyle.Short).setRequired(true).setValue(state.groupName)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(state.description)
      ),
    );
    await interaction.showModal(modal);
  }

  // group_edit_modal_ submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("group_edit_modal_")) {
    const channelId = interaction.customId.slice("group_edit_modal_".length);
    const state = groupStates.get(channelId);
    if (!state) { await interaction.reply({ content: "Group not found.", flags: MessageFlags.Ephemeral }); return; }
    state.groupName = interaction.fields.getTextInputValue("name");
    state.description = interaction.fields.getTextInputValue("description") ?? "";
    persistGroupState();
    await interaction.deferReply({ ephemeral: true });
    await updateGroupMessages(interaction.guild!, channelId);
    await interaction.deleteReply();
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
        const member = interaction.member;
        const displayName = (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
        state.members.set(interaction.user.id, { userId: interaction.user.id, displayName, status: statusStr, plusOne: 0 });
      }
      persistState();
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
