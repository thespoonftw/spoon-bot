import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Guild, Interaction, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./state";
import { config } from "./config";
import { formatShortDate } from "./dateUtils";

export type BirthdayEntry = { userId: string; displayName: string; date: string };

const BIRTHDAYS_FILE = path.join(DATA_DIR, "birthdays.json");
let birthdays: BirthdayEntry[] = [];

export function loadBirthdays() {
  try {
    if (!fs.existsSync(BIRTHDAYS_FILE)) return;
    birthdays = JSON.parse(fs.readFileSync(BIRTHDAYS_FILE, "utf-8"));
    console.log(`Loaded ${birthdays.length} birthday(s) from disk.`);
  } catch (e) { console.error("Failed to load birthdays:", e); }
}

function persistBirthdays() {
  fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify(birthdays, null, 2));
}



function sortedBirthdays(): BirthdayEntry[] {
  return [...birthdays].sort((a, b) => {
    const [ad, am] = a.date.split("/").map(Number);
    const [bd, bm] = b.date.split("/").map(Number);
    return am !== bm ? am - bm : ad - bd;
  });
}

const buildContent = () => "**🎂 Birthday Tracker**";

const BUTTONS_PER_ROW = 5;
const MAX_BIRTHDAY_ROWS = 4; // 5th row reserved for Add button

function buildComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const sorted = sortedBirthdays().slice(0, BUTTONS_PER_ROW * MAX_BIRTHDAY_ROWS);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < sorted.length; i += BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const entry of sorted.slice(i, i + BUTTONS_PER_ROW)) {
      const label = `${entry.displayName}: ${formatShortDate(entry.date)}`;
      row.addComponents(
        new ButtonBuilder().setCustomId(`bday_edit_${entry.userId}`).setLabel(label).setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("bday_add").setLabel("+ Add Birthday").setStyle(ButtonStyle.Primary),
  ));
  return rows;
}

function buildAddModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("bday_modal_add")
    .setTitle("Add Birthday")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("bday_userid").setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("bday_date").setLabel("Date (DD/MM)").setStyle(TextInputStyle.Short).setPlaceholder("e.g. 25/12").setRequired(true).setMaxLength(5),
      ),
    );
}

function buildEditModal(entry: BirthdayEntry): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`bday_modal_edit_${entry.userId}`)
    .setTitle("Edit Birthday")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("bday_userid").setLabel("User ID (enter DELETE to remove entry)").setStyle(TextInputStyle.Short).setValue(entry.userId).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("bday_date").setLabel("Date (DD/MM)").setStyle(TextInputStyle.Short).setValue(entry.date).setRequired(true).setMaxLength(5),
      ),
    );
}

function isValidDate(date: string): boolean {
  const match = date.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const day = parseInt(match[1]);
  const month = parseInt(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

async function resolveDisplayName(userId: string, guild: Guild | null): Promise<string> {
  try {
    const member = await guild?.members.fetch(userId);
    return member?.displayName ?? userId;
  } catch {
    return userId;
  }
}

export async function handleBirthdayInteractions(interaction: Interaction) {
  if (!config.birthdaysEnabled) return;

  if (interaction.isChatInputCommand() && interaction.commandName === "birthdays") {
    console.log(`/birthdays invoked, ${birthdays.length} entries loaded`);
    await interaction.reply({ content: buildContent(), components: buildComponents(), ephemeral: true });
    return;
  }

  if (interaction.isButton() && interaction.customId === "bday_add") {
    await interaction.showModal(buildAddModal());
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("bday_edit_")) {
    const userId = interaction.customId.slice("bday_edit_".length);
    const entry = birthdays.find(b => b.userId === userId);
    if (!entry) return;
    await interaction.showModal(buildEditModal(entry));
    return;
  }


  if (interaction.isModalSubmit() && interaction.customId === "bday_modal_add") {
    const userId = interaction.fields.getTextInputValue("bday_userid").trim();
    const date = interaction.fields.getTextInputValue("bday_date").trim();
    if (!isValidDate(date)) {
      await interaction.reply({ content: "Invalid date. Use DD/MM format (e.g. 25/12).", ephemeral: true });
      return;
    }
    const displayName = await resolveDisplayName(userId, interaction.guild);
    birthdays = birthdays.filter(b => b.userId !== userId);
    birthdays.push({ userId, displayName, date });
    persistBirthdays();
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ content: buildContent(), components: buildComponents() });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("bday_modal_edit_")) {
    const originalUserId = interaction.customId.slice("bday_modal_edit_".length);
    const newUserId = interaction.fields.getTextInputValue("bday_userid").trim();
    const date = interaction.fields.getTextInputValue("bday_date").trim();

    if (newUserId.toUpperCase() === "DELETE") {
      birthdays = birthdays.filter(b => b.userId !== originalUserId);
      persistBirthdays();
      await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ content: buildContent(), components: buildComponents() });
      return;
    }

    if (!isValidDate(date)) {
      await interaction.reply({ content: "Invalid date. Use DD/MM format (e.g. 25/12).", ephemeral: true });
      return;
    }
    const displayName = await resolveDisplayName(newUserId, interaction.guild);
    birthdays = birthdays.filter(b => b.userId !== originalUserId);
    birthdays.push({ userId: newUserId, displayName, date });
    persistBirthdays();
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ content: buildContent(), components: buildComponents() });
    return;
  }
}
