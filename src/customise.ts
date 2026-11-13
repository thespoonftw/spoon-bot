import {
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import type { Guild, GuildMember, Interaction, Role } from "discord.js";

const sharp = require("sharp") as typeof import("sharp").default;

// /customise lets members pick their name colour. The colour roles are whatever sits under the
// "-= COLOURS =-" separator role in the server's role list, down to the next "-= ... =-" separator,
// so adding, renaming or reordering colours in Discord needs no bot change. The bot can only hand
// out roles below its own highest role, so colours above it are left out.

const SELECT_ID = "customise_colour";
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
const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);

// A swatch of the member's name drawn in every colour, on Discord's dark background, since a select
// menu can't show colours itself.
async function previewImage(name: string, roles: Role[], currentId: string | undefined): Promise<Buffer | null> {
  const cols = 3, cellW = 260, cellH = 52, pad = 12;
  const rows = Math.ceil(roles.length / cols);
  const w = cols * cellW + pad * 2, h = rows * cellH + pad * 2;
  const label = escapeXml(name.length > 18 ? `${name.slice(0, 17)}…` : name);
  const cells = roles.map((r, i) => {
    const x = pad + (i % cols) * cellW, y = pad + Math.floor(i / cols) * cellH;
    const ring = r.id === currentId
      ? `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="8" fill="#ffffff10" stroke="${hex(r)}" stroke-width="2"/>`
      : "";
    return `${ring}<text x="${x + 14}" y="${y + 24}" font-size="18" font-weight="600" fill="${hex(r)}">${label}</text>`
      + `<text x="${x + 14}" y="${y + 42}" font-size="12" fill="#949ba4">${escapeXml(r.name)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<rect width="100%" height="100%" rx="10" fill="#313338"/>`
    + `<g font-family="gg sans, Noto Sans, DejaVu Sans, Helvetica, Arial, sans-serif">${cells}</g></svg>`;
  try {
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } catch (e) {
    console.error("Colour preview render failed:", e);
    return null;
  }
}

async function buildReply(member: GuildMember, roles: Role[], notice?: string) {
  const current = roles.find(r => member.roles.cache.has(r.id));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("Pick a colour")
    .addOptions(
      ...roles.slice(0, 24).map(r => ({
        label: r.name.slice(0, 100),
        value: r.id,
        description: hex(r),
        default: r.id === current?.id,
      })),
      { label: "No colour", value: NONE, description: "Use the default name colour", default: !current },
    );
  const png = await previewImage(member.displayName, roles, current?.id);
  const status = current ? `Your colour is **${current.name}**.` : "You don't have a colour yet.";
  return {
    content: `${notice ?? status}\nPick a new one below.`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    files: png ? [new AttachmentBuilder(png, { name: "colours.png" })] : [],
  };
}

export async function handleCustomiseInteractions(interaction: Interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "customise") {
    const guild = interaction.guild;
    if (!guild) return;
    const roles = colourRoles(guild).filter(r => r.editable);
    if (!roles.length) {
      const any = colourRoles(guild).length > 0;
      await interaction.reply({
        content: any
          ? "I can't hand out the colour roles yet: my role needs to be above them in the server's role list."
          : "This server has no colour roles set up (roles under a \"-= COLOURS =-\" separator).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await guild.members.fetch(interaction.user.id);
    await interaction.editReply(await buildReply(member, roles));
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT_ID) {
    const guild = interaction.guild;
    if (!guild) return;
    await interaction.deferUpdate();
    const roles = colourRoles(guild).filter(r => r.editable);
    const choice = interaction.values[0];
    const chosen = roles.find(r => r.id === choice);
    if (choice !== NONE && !chosen) {
      await interaction.editReply(await buildReply(await guild.members.fetch(interaction.user.id), roles, "That colour isn't available any more."));
      return;
    }
    const member = await guild.members.fetch(interaction.user.id);
    const toRemove = roles.filter(r => r.id !== chosen?.id && member.roles.cache.has(r.id));
    if (toRemove.length) await member.roles.remove(toRemove, "/customise colour change");
    if (chosen && !member.roles.cache.has(chosen.id)) await member.roles.add(chosen, "/customise colour change");
    const updated = await guild.members.fetch({ user: interaction.user.id, force: true });
    await interaction.editReply(await buildReply(updated, roles,
      chosen ? `You're now **${chosen.name}**.` : "Colour removed, you're back to the default."));
  }
}
