import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle } from "discord.js";
import type { Interaction } from "discord.js";
import { config } from "../config";
import { eventStates } from "../state";
import { createDiscordLoginLink } from "../auth";

type EventModalPrefill = { eventName?: string; description?: string; location?: string; dateStr?: string; timeStr?: string };
export function buildEventModalComponents(prefill?: EventModalPrefill): ActionRowBuilder<TextInputBuilder>[] {
  return [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_name").setLabel("Event name").setStyle(TextInputStyle.Short).setRequired(true).setValue(prefill?.eventName ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Optional").setValue(prefill?.description ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_location").setLabel("Location").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("TBC").setValue(prefill?.location ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_date").setLabel("Date - Use DD/MM/YY or TBC").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("TBC").setValue(prefill?.dateStr ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("event_time").setLabel("Start Time").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Optional").setValue(prefill?.timeStr ?? "")
    ),
  ];
}

function hasRole(interaction: Interaction): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(config.requiredRoleId);
  return roles.cache.has(config.requiredRoleId);
}

// /edit (and the old ⚙ button, on any card not yet refreshed): a private link to the Edit Event page, signed in as them.
export async function handleGearMenuInteractions(interaction: Interaction): Promise<boolean> {
  let channelId: string;
  if (interaction.isChatInputCommand() && interaction.commandName === "edit") channelId = interaction.channelId;
  else if (interaction.isButton() && interaction.customId.startsWith("edit_menu_")) channelId = interaction.customId.slice("edit_menu_".length);
  else return false;

  const state = eventStates.get(channelId);
  if (!state) {
    await interaction.reply({ content: "This command can only be used in an event channel.", ephemeral: true });
    return true;
  }
  if (!hasRole(interaction) && state.creatorId !== interaction.user.id) {
    await interaction.reply({ content: "You don't have permission.", ephemeral: true });
    return true;
  }
  const member = interaction.member;
  const displayName = (member && "displayName" in member ? member.displayName : null) ?? interaction.user.displayName;
  const link = createDiscordLoginLink(interaction.user.id, displayName,
    interaction.user.displayAvatarURL({ extension: "png", size: 128 }), `/events/${channelId}/edit`);
  if (!link) {
    await interaction.reply({ content: "Your account can't sign in to the website — ask an admin.", ephemeral: true });
    return true;
  }
  await interaction.reply({
    content: `Edit **${state.eventName}** on the website. The link signs you in and works once, for 15 minutes.`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Edit event").setEmoji("⚙️").setURL(link))],
    ephemeral: true,
  });
  return true;
}
