import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, GuildMember, Interaction, ModalSubmitInteraction, Role } from "discord.js";
import { dbGetAllCustomIconRoles, dbGetCustomIconRole, dbSetCustomIconRole } from "./db";

const sharp = require("sharp") as typeof import("sharp").default;

// /customise opens a popup where members pick their name colour and role icon. The choices come
// from sections of the server's role list: the roles under a "-= COLOURS =-" (or "-= ICONS =-")
// separator role, so adding, renaming or reordering them in Discord needs no bot change. A section
// ends at the next separator, a bot-managed role, or any role whose permissions differ from its
// header's, so roles like Muted that happen to sit just below aren't swept in. The bot can only
// hand out roles below its own highest role, so any above it are left out.
//
// Members can also give themselves any icon (a typed emoji or a server emoji).
// That lives on a personal role the bot creates at the top of the icons section, edits when they
// change it, and deletes when they go back to a shared icon or none. custom_icon_roles records
// whose is whose.

const MODAL_ID = "customise_modal";
const COLOUR = "colour";
const ICON = "icon";
const ICON_TEXT = "icon_text";
const NONE = "none";
const KEEP_CUSTOM = "custom";

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

// --- Custom icons ---

type IconSpec = { unicodeEmoji: string; icon?: undefined } | { icon: Buffer; unicodeEmoji?: undefined };

async function iconImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return sharp(Buffer.from(await res.arrayBuffer()))
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function resolveIcon(guild: Guild, text: string): Promise<IconSpec | string> {
  const tag = text.match(/^<a?:\w+:(\d+)>$/);
  const named = guild.emojis.cache.find(e => e.name?.toLowerCase() === text.replace(/^:|:$/g, "").toLowerCase());
  const emojiUrl = tag ? `https://cdn.discordapp.com/emojis/${tag[1]}.png` : named?.imageURL({ extension: "png" });
  if (emojiUrl) {
    try { return { icon: await iconImage(emojiUrl) }; } catch { return "I couldn't fetch that emoji."; }
  }
  const graphemes = [...new (Intl as any).Segmenter().segment(text)];
  if (graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return { unicodeEmoji: text };
  return `I couldn't find an emoji called "${text}". Type a single emoji like 🦆, or a server emoji's name like :snek:.`;
}

// Moves a role to directly below another, sending positions only for the roles that change.
async function placeBelow(guild: Guild, role: Role, above: Role) {
  await guild.roles.fetch();
  const order = [...guild.roles.cache.values()].sort((a, b) => a.comparePositionTo(b)).filter(r => r.id !== role.id);
  order.splice(order.findIndex(r => r.id === above.id), 0, role);
  const changes = order.map((r, i) => ({ role: r.id, position: i })).filter(c => guild.roles.cache.get(c.role)!.rawPosition !== c.position);
  if (changes.length) await guild.roles.setPositions(changes);
}

async function setCustomIcon(guild: Guild, member: GuildMember, header: Role, spec: IconSpec): Promise<Role> {
  const existingId = dbGetCustomIconRole(member.id);
  const existing = existingId ? guild.roles.cache.get(existingId) : undefined;
  const fields = { unicodeEmoji: spec.unicodeEmoji ?? null, icon: spec.icon ?? null };
  if (existing) return existing.edit({ ...fields, reason: "/customise custom icon" });
  const role = await guild.roles.create({
    name: `${member.displayName}'s icon`.slice(0, 100),
    permissions: header.permissions,
    ...fields,
    reason: "/customise custom icon",
  });
  dbSetCustomIconRole(member.id, role.id);
  await placeBelow(guild, role, header);
  return role;
}

async function deleteCustomIcon(guild: Guild, memberId: string) {
  const id = dbGetCustomIconRole(memberId);
  if (!id) return;
  await guild.roles.cache.get(id)?.delete("/customise custom icon removed").catch(e => console.error("Custom icon delete failed:", e));
  dbSetCustomIconRole(memberId, null);
}

// Gives the member `chosen` (or nothing) and takes away every other role in `roles`.
async function swapRoles(member: GuildMember, roles: Role[], chosen: Role | undefined) {
  const toRemove = roles.filter(r => r.id !== chosen?.id && member.roles.cache.has(r.id));
  if (toRemove.length) await member.roles.remove(toRemove, "/customise");
  if (chosen && !member.roles.cache.has(chosen.id)) await member.roles.add(chosen, "/customise");
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

  const iconChoice = readField(() => interaction.fields.getStringSelectValues(ICON)[0]);
  if (iconChoice) {
    const { header, roles } = section(guild, ICONS_HEADER);
    const ownCustomId = dbGetCustomIconRole(member.id);
    const shared = roles.filter(r => r.editable && !dbGetAllCustomIconRoles().has(r.id));
    const text = readField(() => interaction.fields.getTextInputValue(ICON_TEXT))?.trim() ?? "";

    if (text && header) {
      const spec = await resolveIcon(guild, text);
      if (typeof spec === "string") lines.push(spec);
      else {
        try {
          const role = await setCustomIcon(guild, member, header, spec);
          await swapRoles(member, [...shared, role], role);
          lines.push(`Icon: ${spec.unicodeEmoji ?? `:${text.replace(/^<a?:|:\d+>$|^:|:$/g, "")}:`}`);
        } catch (e) {
          console.error("Custom icon failed:", e);
          lines.push("Discord wouldn't accept that as an icon. Try a different emoji or image.");
        }
      }
    } else if (iconChoice !== KEEP_CUSTOM) {
      const chosen = shared.find(r => r.id === iconChoice);
      const had = shared.find(r => member.roles.cache.has(r.id));
      if (iconChoice !== NONE && !chosen) lines.push("That icon isn't available any more.");
      else if (had?.id !== chosen?.id || ownCustomId) {
        await swapRoles(member, shared, chosen);
        await deleteCustomIcon(guild, member.id);
        lines.push(chosen ? `Icon: **${chosen.unicodeEmoji ? `${chosen.unicodeEmoji} ` : ""}${chosen.name}**` : "Icon: default");
      }
    }
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
    const customIds = dbGetAllCustomIconRoles();
    const colourRoles = colours.roles.filter(r => r.editable);
    const sharedIcons = icons.roles.filter(r => r.editable && !customIds.has(r.id));
    const ownCustom = icons.roles.find(r => r.id === dbGetCustomIconRole(interaction.user.id));
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
      const current = ownCustom && has.has(ownCustom.id) ? ownCustom : sharedIcons.find(r => has.has(r.id));
      modal.addLabelComponents(
        new LabelBuilder().setLabel("Icon").setStringSelectMenuComponent(
          new StringSelectMenuBuilder().setCustomId(ICON).addOptions(
            ...(current === ownCustom && ownCustom ? [{
              label: "Your custom icon", value: KEEP_CUSTOM, emoji: ownCustom.unicodeEmoji ?? undefined, default: true,
            }] : []),
            ...sharedIcons.slice(0, 23).map(r => ({
              label: r.name.slice(0, 100), value: r.id, emoji: r.unicodeEmoji ?? undefined, default: r.id === current?.id,
            })),
            { label: "Default", value: NONE, description: "Whatever icon your other roles give you", default: !current },
          ),
        ),
        new LabelBuilder()
          .setLabel("Or type any emoji")
          .setDescription("Like 🦆, or a server emoji's name like :snek:")
          .setTextInputComponent(new TextInputBuilder().setCustomId(ICON_TEXT).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      );
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

// A member's custom icon role goes when they leave the server.
export async function handleCustomiseMemberLeave(guild: Guild, memberId: string) {
  await deleteCustomIcon(guild, memberId);
}
