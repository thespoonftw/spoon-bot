import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, GuildMember, Interaction, ModalSubmitInteraction, Role } from "discord.js";
import { dbAddIconRole, dbGetIconRoles, dbRemoveIconRole } from "./db";

const sharp = require("sharp") as typeof import("sharp").default;
const emojiData = require("unicode-emoji-json/data-by-emoji.json") as Record<string, { name: string }>;

// /customise opens a popup where members pick their name colour and role icon.
//
// Colours come from the roles under the "-= COLOURS =-" separator role. A section ends at the next
// separator, a bot-managed role, or any role whose permissions differ from its header's, so roles
// like Muted that happen to sit just below aren't swept in.
//
// The icon is typed: any emoji, or a server emoji by name. Each icon is a role in the "-= ICONS =-"
// section named after the emoji ("Duck" for 🦆, "snek" for :snek:), shared by everyone who picks
// it. The bot reuses a matching role if one exists, otherwise creates it, and deletes the roles it
// created once nobody has them (icon_roles records which those are). Roles made by hand are reused
// but never deleted. Leaving the box empty means the default: whatever icon other roles give.
//
// The bot can only hand out roles below its own highest role, so any above it are left out.

const MODAL_ID = "customise_modal";
const COLOUR = "colour";
const ICON = "icon";
const NONE = "none";

const COLOURS_HEADER = /colou?rs?/i;
const ICONS_HEADER = /icons?/i;

const isSeparator = (r: Role) => /^-=.*=-$/.test(r.name.trim());

function section(guild: Guild, header: RegExp): { header?: Role; roles: Role[] } {
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.comparePositionTo(a));
  const start = roles.findIndex(r => isSeparator(r) && header.test(r.name));
  if (start < 0) return { roles: [] };
  const perms = roles[start].permissions.bitfield;
  const out: Role[] = [];
  for (const r of roles.slice(start + 1)) {
    if (isSeparator(r) || r.managed || r.id === guild.id || r.permissions.bitfield !== perms) break;
    out.push(r);
  }
  return { header: roles[start], roles: out };
}

const hex = (r: Role) => `#${r.color.toString(16).padStart(6, "0")}`;

function memberRoleIds(interaction: Interaction): Set<string> {
  const roles = interaction.member?.roles;
  if (!roles) return new Set();
  return new Set(Array.isArray(roles) ? roles : roles.cache.keys());
}

// Gives the member `chosen` (or nothing) and takes away every other role in `roles`.
async function swapRoles(member: GuildMember, roles: Role[], chosen: Role | undefined) {
  const toRemove = roles.filter(r => r.id !== chosen?.id && member.roles.cache.has(r.id));
  if (toRemove.length) await member.roles.remove(toRemove, "/customise");
  if (chosen && !member.roles.cache.has(chosen.id)) await member.roles.add(chosen, "/customise");
}

// --- Icons ---

type IconSpec = { name: string } & ({ unicodeEmoji: string; image?: undefined } | { image: string; unicodeEmoji?: undefined });

const VS16 = /️/g;
const SKIN_TONES: Record<string, string> = {
  "\u{1F3FB}": "light skin tone", "\u{1F3FC}": "medium-light skin tone", "\u{1F3FD}": "medium skin tone",
  "\u{1F3FE}": "medium-dark skin tone", "\u{1F3FF}": "dark skin tone",
};

const titleCase = (s: string) => s.replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

function emojiName(emoji: string): string {
  const bare = emoji.replace(VS16, "");
  const exact = emojiData[emoji] ?? emojiData[bare] ?? emojiData[`${bare}️`];
  if (exact) return titleCase(exact.name);
  const tones = [...bare].filter(c => SKIN_TONES[c]);
  const base = [...bare].filter(c => !SKIN_TONES[c]).join("");
  const found = emojiData[base] ?? emojiData[`${base}️`];
  if (found) return `${titleCase(found.name)}${tones.length ? ` (${tones.map(t => SKIN_TONES[t]).join(", ")})` : ""}`;
  return emoji;
}

function resolveIcon(guild: Guild, text: string): IconSpec | string {
  const tag = text.match(/^<a?:(\w+):(\d+)>$/);
  if (tag) return { name: tag[1], image: `https://cdn.discordapp.com/emojis/${tag[2]}.png` };
  const named = guild.emojis.cache.find(e => e.name?.toLowerCase() === text.replace(/^:|:$/g, "").toLowerCase());
  if (named?.name) return { name: named.name, image: named.imageURL({ extension: "png" }) };
  const graphemes = [...new (Intl as any).Segmenter().segment(text)];
  if (graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) {
    return { name: emojiName(text), unicodeEmoji: text };
  }
  return `I couldn't find an emoji called "${text}". Type a single emoji like 🦆, or a server emoji's name like :snek:.`;
}

const iconText = (r: Role) => r.unicodeEmoji ?? `:${r.name}:`;

function findIconRole(roles: Role[], spec: IconSpec): Role | undefined {
  if (spec.unicodeEmoji) return roles.find(r => r.unicodeEmoji?.replace(VS16, "") === spec.unicodeEmoji.replace(VS16, ""));
  return roles.find(r => !r.unicodeEmoji && r.icon && r.name.toLowerCase() === spec.name.toLowerCase());
}

async function iconImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return sharp(Buffer.from(await res.arrayBuffer()))
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Moves a role to directly below another, sending positions only for the roles that change.
async function placeBelow(guild: Guild, role: Role, above: Role) {
  await guild.roles.fetch();
  const order = [...guild.roles.cache.values()].sort((a, b) => a.comparePositionTo(b)).filter(r => r.id !== role.id);
  order.splice(order.findIndex(r => r.id === above.id), 0, role);
  const changes = order.map((r, i) => ({ role: r.id, position: i })).filter(c => guild.roles.cache.get(c.role)!.rawPosition !== c.position);
  if (changes.length) await guild.roles.setPositions(changes);
}

async function createIconRole(guild: Guild, header: Role, spec: IconSpec): Promise<Role> {
  const role = await guild.roles.create({
    name: spec.name.slice(0, 100),
    permissions: header.permissions,
    ...(spec.unicodeEmoji ? { unicodeEmoji: spec.unicodeEmoji } : { icon: await iconImage(spec.image!) }),
    reason: "/customise icon",
  });
  dbAddIconRole(role.id);
  await placeBelow(guild, role, header);
  return role;
}

// Deletes the icon roles the bot created that nobody has any more.
export async function sweepIconRoles(guild: Guild) {
  const ids = dbGetIconRoles();
  if (!ids.size) return;
  await guild.members.fetch();
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (role && role.members.size) continue;
    if (role) await role.delete("/customise icon no longer used").catch(e => console.error("Icon role delete failed:", e));
    dbRemoveIconRole(id);
  }
}

// --- Popup ---

function readField<T>(read: () => T): T | undefined {
  try { return read(); } catch { return undefined; } // field not in this popup
}

async function handleSubmit(interaction: ModalSubmitInteraction, guild: Guild) {
  const member = await guild.members.fetch(interaction.user.id);
  const lines: string[] = [];

  const colourChoice = readField(() => interaction.fields.getStringSelectValues(COLOUR)[0]);
  if (colourChoice) {
    const roles = section(guild, COLOURS_HEADER).roles.filter(r => r.editable);
    const chosen = roles.find(r => r.id === colourChoice);
    const had = roles.find(r => member.roles.cache.has(r.id));
    if (colourChoice !== NONE && !chosen) lines.push("That colour isn't available any more.");
    else if (had?.id !== chosen?.id) {
      await swapRoles(member, roles, chosen);
      lines.push(chosen ? `Name colour: **${chosen.name}**` : "Name colour: removed");
    }
  }

  const text = readField(() => interaction.fields.getTextInputValue(ICON))?.trim();
  const { header, roles } = section(guild, ICONS_HEADER);
  const icons = roles.filter(r => r.editable);
  const current = icons.find(r => member.roles.cache.has(r.id));
  if (text !== undefined && header && text !== (current ? iconText(current) : "")) {
    if (!text) {
      await swapRoles(member, icons, undefined);
      lines.push("Icon: default");
    } else {
      const spec = resolveIcon(guild, text);
      if (typeof spec === "string") lines.push(spec);
      else {
        try {
          const role = findIconRole(icons, spec) ?? await createIconRole(guild, header, spec);
          await swapRoles(member, [...icons, role], role);
          lines.push(`Icon: ${spec.unicodeEmoji ? `${spec.unicodeEmoji} ` : ""}**${role.name}**`);
        } catch (e) {
          console.error("Icon change failed:", e);
          lines.push("Discord wouldn't accept that as an icon. Try a different emoji.");
        }
      }
    }
    await sweepIconRoles(guild);
  }

  await interaction.editReply(lines.length ? lines.join("\n") : "Nothing changed.");
}

export async function handleCustomiseInteractions(interaction: Interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "customise") {
    const guild = interaction.guild;
    if (!guild) return;
    const has = memberRoleIds(interaction);
    const colours = section(guild, COLOURS_HEADER);
    const icons = section(guild, ICONS_HEADER);
    const colourRoles = colours.roles.filter(r => r.editable);
    const iconsUsable = !!icons.header?.editable;

    if (!colourRoles.length && !iconsUsable) {
      await interaction.reply({
        content: colours.roles.length || icons.header
          ? "I can't hand out these roles yet: my role needs to be above them in the server's role list."
          : "This server has nothing to customise yet (roles under a \"-= COLOURS =-\" or \"-= ICONS =-\" separator).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Customise");
    if (colourRoles.length) {
      const current = colourRoles.find(r => has.has(r.id));
      modal.addLabelComponents(new LabelBuilder().setLabel("Name colour").setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId(COLOUR).addOptions(
          ...colourRoles.slice(0, 24).map(r => ({
            label: r.name.slice(0, 100), value: r.id, description: hex(r), default: r.id === current?.id,
          })),
          { label: "No colour", value: NONE, description: "Use the default name colour", default: !current },
        ),
      ));
    }
    if (iconsUsable) {
      const current = icons.roles.find(r => r.editable && has.has(r.id));
      const input = new TextInputBuilder().setCustomId(ICON).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
      if (current) input.setValue(iconText(current));
      modal.addLabelComponents(new LabelBuilder()
        .setLabel("Icon")
        .setDescription("Any emoji like 🦆, or a server emoji like :snek:. Leave empty for the default.")
        .setTextInputComponent(input));
    }
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    const guild = interaction.guild;
    if (!guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await handleSubmit(interaction, guild);
  }
}
