import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { EventState, RSVPStatus } from "./types";

export const SPACER = "⠀".repeat(40);
export const JOIN_LABEL = "⠀".repeat(12) + "Join" + "⠀".repeat(12);
export const LEAVE_LABEL = "⠀".repeat(11) + "Leave" + "⠀".repeat(12);
export const HALF_JOIN_LABEL = "⠀".repeat(4) + "Join" + "⠀".repeat(4);
export const HALF_LEAVE_LABEL = "⠀".repeat(3) + "Leave" + "⠀".repeat(3);

// Dates are stored as "Sat 5 December 2026, All Day" when there's no time; shown as just the date.
export const displayWhen = (dateText: string) => dateText.endsWith(", All Day") ? dateText.slice(0, -", All Day".length) : dateText;

// The card's "Add to calendar" link: a page on the site that gives each person their own calendar links.
export const calendarPageUrl = (channelId: string) => `${process.env.ALBUM_BASE_URL ?? "http://localhost:3000"}/calendar?event=${channelId}`;

export function buildDescText(description: string, location: string, dateText: string, endDateText?: string, calendarUrl?: string): string {
  const parts: string[] = [];
  const startDisplay = displayWhen(dateText);
  // Only dated events can go in a calendar.
  const calLink = calendarUrl && dateText !== "TBC" ? ` · [Add to calendar](${calendarUrl})` : "";
  if (description) {
    parts.push(description);
    parts.push(`\n📅 **${endDateText ? "From" : "When"}:** ${startDisplay}${calLink}`);
  } else {
    parts.push(`📅 **${endDateText ? "From" : "When"}:** ${startDisplay}${calLink}`);
  }
  if (endDateText) {
    parts.push(`\n🏁 **To:** ${displayWhen(endDateText)}`);
  }
  parts.push(`\n📍 **Where:** ${location}`);
  parts.push(`\n${SPACER}`);
  return parts.join("\n");
}

export function buildJoinContent(state: EventState): string {
  if (!state.joiningEnabled) return "Joining this event is now closed.";
  if (state.creatorId) return `@everyone <@${state.creatorId}> created an event. Click to join!`;
  return "@everyone Click to join!";
}

function buildEventEmbedBase(state: EventState, channelId: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText, state.endDateText, calendarPageUrl(channelId)))
    .setColor(0x5865F2);
  if (state.imageUrl) embed.setImage(state.imageUrl);
  return embed;
}

export const rsvpOn = (state: EventState) => state.rsvpEnabled !== false;

// The text above the pinned card inside the event channel: none, just the card. Edits send "" so older cards lose their old "Click here to RSVP!" line.
export const pinMessageContent = (_state: EventState) => "";

export function buildJoinEmbed(state: EventState, channelId: string) {
  const embed = buildEventEmbedBase(state, channelId);
  if (state.members.size > 0) {
    const mentions = [...state.members.values()].map(m => `<@${m.userId}>`).join(" ");
    embed.addFields({ name: `👥 ${state.members.size} Interested`, value: mentions });
  }
  return embed;
}

export function buildInnerEmbed(state: EventState, channelId: string, albumUrl?: string) {
  const embed = buildEventEmbedBase(state, channelId);

  if (state.members.size > 0 && !rsvpOn(state)) {
    const ids = [...state.members.keys()];
    embed.addFields({ name: "​", value: `**👥 Joined (${ids.length})**\n${ids.map(id => `- <@${id}>`).join("\n")}` });
  } else if (rsvpOn(state) && (state.members.size > 0 || state.placeholders?.length)) {
    // Each RSVP group lists Discord members (mentions) then placeholder people (plain names).
    const groups: Record<RSVPStatus, string[]> = { coming: [], maybe: [], decline: [], lurking: [] };
    for (const m of state.members.values()) groups[m.status]?.push(`- <@${m.userId}>`);
    for (const p of state.placeholders ?? []) groups[p.status]?.push(`- ${p.name}`);

    const formatGroup = (label: string, lines: string[]) =>
      lines.length ? `**${label} (${lines.length})**\n${lines.join("\n")}` : null;

    const sections = [
      formatGroup("✅ Coming", groups.coming),
      formatGroup("❔ Maybe", groups.maybe),
      formatGroup("❌ Declined", groups.decline),
      formatGroup("👀 Lurking", groups.lurking),
    ].filter(Boolean) as string[];

    if (sections.length) embed.addFields({ name: "\u200b", value: sections.join("\n\n") });
  }
  if (albumUrl) embed.addFields({ name: "📸 Photo Album", value: `[View Photos](${albumUrl})` });
  return embed;
}

// The 📅 Subscribe button older cards had (calendarFeed.ts still answers it); cards now link to the calendar page instead.
export const SUBSCRIBE_ID = "cal_subscribe";

export function joinMessageComponents(channelId: string, joiningEnabled: boolean) {
  const buttons = joiningEnabled ? [
    new ButtonBuilder().setCustomId(`join_event_${channelId}`).setLabel(HALF_JOIN_LABEL).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(HALF_LEAVE_LABEL).setStyle(ButtonStyle.Secondary),
  ] : [];
  return buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];
}

export function pinMessageComponents(channelId: string, rsvp = true) {
  return [
    ...(rsvp ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("✅ Coming").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("❔ Maybe").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_lurking_${channelId}`).setLabel("👀 Lurking").setStyle(ButtonStyle.Primary),
    )] : []),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
      // A plain link: the edit page asks people to log in to the website if they aren't already.
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("⚙").setURL(`${process.env.ALBUM_BASE_URL ?? "http://localhost:3000"}/events/${channelId}/edit`),
    ),
  ];
}
