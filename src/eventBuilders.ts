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

export function buildDescText(description: string, location: string, dateText: string, endDateText?: string): string {
  const parts: string[] = [];
  const startDisplay = displayWhen(dateText);
  if (description) {
    parts.push(description);
    parts.push(`\n📅 **${endDateText ? "From" : "When"}:** ${startDisplay}`);
  } else {
    parts.push(`📅 **${endDateText ? "From" : "When"}:** ${startDisplay}`);
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

function buildEventEmbedBase(state: EventState): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(state.eventName)
    .setDescription(buildDescText(state.description, state.location, state.dateText, state.endDateText))
    .setColor(0x5865F2);
  if (state.imageUrl) embed.setImage(state.imageUrl);
  return embed;
}

export const rsvpOn = (state: EventState) => state.rsvpEnabled !== false;

// The text above the pinned card inside the event channel: none, just the card. Edits send "" so older cards lose their old "Click here to RSVP!" line.
export const pinMessageContent = (_state: EventState) => "";

export function buildJoinEmbed(state: EventState) {
  const embed = buildEventEmbedBase(state);
  if (state.members.size > 0) {
    const mentions = [...state.members.values()].map(m => `<@${m.userId}>`).join(" ");
    embed.addFields({ name: `👥 ${state.members.size} Interested`, value: mentions });
  }
  return embed;
}

export function buildInnerEmbed(state: EventState, albumUrl?: string) {
  const embed = buildEventEmbedBase(state);

  if (state.members.size > 0 && !rsvpOn(state)) {
    const ids = [...state.members.keys()];
    embed.addFields({ name: "​", value: `**👥 Joined (${ids.length})**\n${ids.map(id => `- <@${id}>`).join("\n")}` });
  } else if (state.members.size > 0) {
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
  if (albumUrl) embed.addFields({ name: "📸 Photo Album", value: `[View Photos](${albumUrl})` });
  return embed;
}

// Events with a date get a button for subscribing to the brunch events in your own calendar (calendarFeed.ts).
export const SUBSCRIBE_ID = "cal_subscribe";
const subscribeButton = () => new ButtonBuilder().setCustomId(SUBSCRIBE_ID).setLabel("📅 Subscribe").setStyle(ButtonStyle.Secondary);

export function joinMessageComponents(channelId: string, joiningEnabled: boolean, hasDate = false) {
  const buttons = joiningEnabled ? [
    new ButtonBuilder().setCustomId(`join_event_${channelId}`).setLabel(HALF_JOIN_LABEL).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(HALF_LEAVE_LABEL).setStyle(ButtonStyle.Secondary),
  ] : [];
  if (hasDate) buttons.push(subscribeButton());
  return buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];
}

export function pinMessageComponents(channelId: string, hasDate = false, rsvp = true) {
  return [
    ...(rsvp ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("✅ Coming").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("❔ Maybe").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rsvp_lurking_${channelId}`).setLabel("👀 Lurking").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`plusone_${channelId}`).setLabel("👥 +1").setStyle(ButtonStyle.Secondary),
    )] : []),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`leave_event_${channelId}`).setLabel(LEAVE_LABEL).setStyle(ButtonStyle.Danger),
      // A plain link: the edit page asks people to log in to the website if they aren't already.
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("⚙").setURL(`${process.env.ALBUM_BASE_URL ?? "http://localhost:3000"}/events/${channelId}/edit`),
      ...(hasDate ? [subscribeButton()] : []),
    ),
  ];
}
