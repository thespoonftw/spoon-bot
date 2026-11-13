import { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder } from "discord.js";
import type { Guild, GuildMember, Interaction, Role } from "discord.js";

// /customise opens a popup where members pick their name colour and role icon. Each choice comes
// from a section of the server's role list: the roles under a "-= COLOURS =-" (or "-= ICONS =-")
// separator role, so adding, renaming or reordering them in Discord needs no bot change. A section
// ends at the next separator, a bot-managed role, or any role whose permissions differ from its
// header's, so roles like Muted that happen to sit just below aren't swept in. The bot can only
// hand out roles below its own highest role, so any above it are left out.

const MODAL_ID = "customise_modal";
const NONE = "none";

interface Section {
  field: string;
  header: RegExp;
  label: string;
  noneLabel: string;
  noneDescription: string;
  describe: (r: Role) => string | undefined;
}

const SECTIONS: Section[] = [
  {
    field: "colour",
    header: /colou?rs?/i,
    label: "Name colour",
    noneLabel: "No colour",
    noneDescription: "Use the default name colour",
    describe: r => `#${r.color.toString(16).padStart(6, "0")}`,
  },
  {
    field: "icon",
    header: /icons?/i,
    label: "Icon",
    noneLabel: "No icon",
    noneDescription: "No icon next to your name",
    describe: () => undefined,
  },
];

const isSeparator = (r: Role) => /^-=.*=-$/.test(r.name.trim());

function sectionRoles(guild: Guild, header: RegExp): Role[] {
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
  const start = roles.findIndex(r => isSeparator(r) && header.test(r.name));
  if (start < 0) return [];
  const perms = roles[start].permissions.bitfield;
  const out: Role[] = [];
  for (const r of roles.slice(start + 1)) {
    if (isSeparator(r) || r.managed || r.id === guild.id || r.permissions.bitfield !== perms) break;
    out.push(r);
  }
  return out;
}

function memberRoleIds(interaction: Interaction): Set<string> {
  const roles = interaction.member?.roles;
  if (!roles) return new Set();
  return new Set(Array.isArray(roles) ? roles : roles.cache.keys());
}

async function applyChoice(member: GuildMember, roles: Role[], chosen: Role | undefined) {
  const toRemove = roles.filter(r => r.id !== chosen?.id && member.roles.cache.has(r.id));
  if (toRemove.length) await member.roles.remove(toRemove, "/customise");
  if (chosen && !member.roles.cache.has(chosen.id)) await member.roles.add(chosen, "/customise");
}

export async function handleCustomiseInteractions(interaction: Interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "customise") {
    const guild = interaction.guild;
    if (!guild) return;
    const found = SECTIONS.map(s => ({ s, all: sectionRoles(guild, s.header) }));
    const usable = found.map(f => ({ ...f, roles: f.all.filter(r => r.editable) })).filter(f => f.roles.length);
    if (!usable.length) {
      await interaction.reply({
        content: found.some(f => f.all.length)
          ? "I can't hand out these roles yet: my role needs to be above them in the server's role list."
          : "This server has nothing to customise yet (roles under a \"-= COLOURS =-\" or \"-= ICONS =-\" separator).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const has = memberRoleIds(interaction);
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Customise");
    modal.addLabelComponents(...usable.map(({ s, roles }) => {
      const current = roles.find(r => has.has(r.id));
      return new LabelBuilder().setLabel(s.label).setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId(s.field).addOptions(
          ...roles.slice(0, 24).map(r => ({
            label: r.name.slice(0, 100),
            value: r.id,
            description: s.describe(r),
            emoji: r.unicodeEmoji ?? undefined,
            default: r.id === current?.id,
          })),
          { label: s.noneLabel, value: NONE, description: s.noneDescription, default: !current },
        ),
      );
    }));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    const guild = interaction.guild;
    if (!guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await guild.members.fetch(interaction.user.id);
    const lines: string[] = [];
    for (const s of SECTIONS) {
      let choice: string | undefined;
      try { choice = interaction.fields.getStringSelectValues(s.field)[0]; } catch { continue; } // not in this popup
      const roles = sectionRoles(guild, s.header).filter(r => r.editable);
      const chosen = roles.find(r => r.id === choice);
      if (choice !== NONE && !chosen) { lines.push(`That ${s.field} isn't available any more.`); continue; }
      const had = roles.find(r => member.roles.cache.has(r.id));
      if (had?.id === chosen?.id) continue;
      await applyChoice(member, roles, chosen);
      lines.push(chosen
        ? `${s.label}: **${chosen.unicodeEmoji ? `${chosen.unicodeEmoji} ` : ""}${chosen.name}**`
        : `${s.label}: removed`);
    }
    await interaction.editReply(lines.length ? lines.join("\n") : "Nothing changed.");
  }
}
