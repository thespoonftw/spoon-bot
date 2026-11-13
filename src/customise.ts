import { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder } from "discord.js";
import type { Guild, Interaction, Role } from "discord.js";

// /customise opens a popup where members pick their name colour. The colour roles are whatever sits
// under the "-= COLOURS =-" separator role in the server's role list, down to the next "-= ... =-"
// separator, so adding, renaming or reordering colours in Discord needs no bot change. The bot can
// only hand out roles below its own highest role, so colours above it are left out.

const MODAL_ID = "customise_modal";
const COLOUR_FIELD = "colour";
const NONE = "none";

const isSeparator = (r: Role) => /^-=.*=-$/.test(r.name.trim());

function colourRoles(guild: Guild): Role[] {
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
  const start = roles.findIndex(r => isSeparator(r) && /colou?rs?/i.test(r.name));
  if (start < 0) return [];
  const out: Role[] = [];
  for (const r of roles.slice(start + 1)) {
    if (isSeparator(r)) break;
    if (!r.managed && r.id !== guild.id) out.push(r);
  }
  return out;
}

const hex = (r: Role) => `#${r.color.toString(16).padStart(6, "0")}`;

function memberRoleIds(interaction: Interaction): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  return Array.isArray(roles) ? roles : [...roles.cache.keys()];
}

export async function handleCustomiseInteractions(interaction: Interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "customise") {
    const guild = interaction.guild;
    if (!guild) return;
    const all = colourRoles(guild);
    const roles = all.filter(r => r.editable);
    if (!roles.length) {
      await interaction.reply({
        content: all.length
          ? "I can't hand out the colour roles yet: my role needs to be above them in the server's role list."
          : "This server has no colour roles set up (roles under a \"-= COLOURS =-\" separator).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const has = new Set(memberRoleIds(interaction));
    const current = roles.find(r => has.has(r.id));
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Customise");
    modal.addLabelComponents(
      new LabelBuilder().setLabel("Name colour").setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId(COLOUR_FIELD).addOptions(
          ...roles.slice(0, 24).map(r => ({
            label: r.name.slice(0, 100),
            value: r.id,
            description: hex(r),
            default: r.id === current?.id,
          })),
          { label: "No colour", value: NONE, description: "Use the default name colour", default: !current },
        ),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    const guild = interaction.guild;
    if (!guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roles = colourRoles(guild).filter(r => r.editable);
    const choice = interaction.fields.getStringSelectValues(COLOUR_FIELD)[0];
    const chosen = roles.find(r => r.id === choice);
    if (choice !== NONE && !chosen) {
      await interaction.editReply("That colour isn't available any more.");
      return;
    }
    const member = await guild.members.fetch(interaction.user.id);
    const toRemove = roles.filter(r => r.id !== chosen?.id && member.roles.cache.has(r.id));
    if (toRemove.length) await member.roles.remove(toRemove, "/customise colour change");
    if (chosen && !member.roles.cache.has(chosen.id)) await member.roles.add(chosen, "/customise colour change");
    await interaction.editReply(chosen ? `You're now **${chosen.name}**.` : "Colour removed, you're back to the default.");
  }
}
