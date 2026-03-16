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

export function buildDescText(description: string, location: string, dateText: string, endDateText?: string): string {
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

export function buildJoinContent(state: EventState): string {
  if (!state.joiningEnabled) return "Joining this event is now closed.";
  if (state.creatorId) return `@everyone <@${state.creatorId}> created an event. Click to join!`;
  return "@everyone Click to join!";
}

export function buildJoinEmbed(state: EventState, thumbnailUrl?: string | null) {
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

export function buildInnerEmbed(state: EventState, thumbnailUrl?: string | null) {
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

export function joinMessageComponents(channelId: string, joiningEnabled: boolean) {
  if (!joiningEnabled) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`join_event_${channelId}`).setLabel(JOIN_LABEL).setStyle(ButtonStyle.Primary),
  )];
}

export function rsvpComponents(channelId: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rsvp_coming_${channelId}`).setLabel("✅ Coming").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_maybe_${channelId}`).setLabel("❔ Maybe").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_decline_${channelId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rsvp_lurking_${channelId}`).setLabel("👀 Lurking").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`plusone_${channelId}`).setLabel("👥 +1").setStyle(ButtonStyle.Secondary),
  )];
}

export function pinMessageComponents(channelId: string) {
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

export function buildGearMenuComponents(channelId: string, joiningEnabled: boolean, dateText: string) {
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

export function backRow(channelId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`gear_back_${channelId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
}
