import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { EditSession } from "./types";
import { MONTHS, maxDaysInMonth } from "./dateUtils";

export function buildEditDateContent(session: EditSession, endMode: boolean = false): string {
  const day = session.day ? `${session.day}` : "?";
  const month = session.month ? MONTHS[session.month - 1] : "?";
  const year = session.year ? `${session.year}` : "?";
  const time = session.time ?? (session.timeHour !== null ? `${session.timeHour.toString().padStart(2, "0")}:?` : "?");
  return `**Setting ${endMode ? "end " : ""}date:** ${day} ${month} ${year}, ${time}`;
}

export function buildHourSelect(session: EditSession, channelId: string, endMode: boolean): StringSelectMenuBuilder {
  const customId = `edit_${endMode ? "end" : ""}time_${channelId}`;
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select time");
  const currentHour = (session.time && session.time !== "All Day") ? parseInt(session.time.split(":")[0]) : null;
  select.addOptions(new StringSelectMenuOptionBuilder().setLabel("All Day").setValue("allday").setDefault(session.time === "All Day"));
  for (let h = 0; h <= 23; h++) {
    const label = `${h.toString().padStart(2, "0")}:00`;
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel(label).setValue(`hour_${h}`).setDefault(currentHour === h && session.timeHour === null));
  }
  return select;
}

export function buildMinuteSelect(session: EditSession, channelId: string, endMode: boolean): StringSelectMenuBuilder {
  const customId = `edit_${endMode ? "end" : ""}time_${channelId}`;
  const h = session.timeHour!;
  const hStr = h.toString().padStart(2, "0");
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select minutes");
  select.addOptions(new StringSelectMenuOptionBuilder().setLabel("← Return").setValue("return"));
  for (const m of [0, 15, 30, 45]) {
    const t = `${hStr}:${m.toString().padStart(2, "0")}`;
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel(t).setValue(t).setDefault(session.time === t));
  }
  return select;
}

export function buildEditDateComponents(session: EditSession, channelId: string, endMode: boolean = false) {
  const p = endMode ? "end" : "";
  const maxDays = maxDaysInMonth(session.month, session.year);
  const daySelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}day_${channelId}`).setPlaceholder("Day");
  if (session.dayPage === "low") {
    const limit = Math.min(24, maxDays);
    for (let i = 1; i <= limit; i++) {
      daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${i}`).setValue(`${i}`).setDefault(session.day === i));
    }
    if (maxDays > 24) daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel("25+").setValue("more"));
  } else {
    for (let i = 25; i <= maxDays; i++) {
      daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${i}`).setValue(`${i}`).setDefault(session.day === i));
    }
    daySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel("← 1–24").setValue("back"));
  }

  const monthSelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}month_${channelId}`).setPlaceholder("Month");
  MONTHS.forEach((m, i) => monthSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(m).setValue(`${i + 1}`).setDefault(session.month === i + 1)));

  const currentYear = new Date().getFullYear();
  const yearSelect = new StringSelectMenuBuilder().setCustomId(`edit_${p}year_${channelId}`).setPlaceholder("Year");
  for (let y = currentYear; y <= currentYear + 4; y++) {
    yearSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${y}`).setValue(`${y}`).setDefault(session.year === y));
  }

  const timeRow = session.timeHour !== null
    ? new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildMinuteSelect(session, channelId, endMode))
    : new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildHourSelect(session, channelId, endMode));

  const confirmId = endMode ? `edit_endconfirm_${channelId}` : `edit_confirm_${channelId}`;
  const removeId = endMode ? `edit_endremove_${channelId}` : `edit_tbc_${channelId}`;
  const cancelId = endMode ? `edit_endcancel_${channelId}` : `edit_cancel_${channelId}`;
  const removeLabel = endMode ? "Remove End Date" : "Set to TBC";

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(daySelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(monthSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(yearSelect),
    timeRow,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(removeId).setLabel(removeLabel).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}
