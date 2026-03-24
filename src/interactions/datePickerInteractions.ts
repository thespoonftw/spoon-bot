import { ChannelType } from "discord.js";
import type { Interaction } from "discord.js";
import { eventStates, editSessions, persistState } from "../state";
import type { EditSession } from "../types";
import { MONTHS, DAYS, maxDaysInMonth, sessionFromDateText } from "../dateUtils";
import { buildEditDateContent, buildEditDateComponents } from "../datePickerBuilders";
import { updateEventMessages } from "../messageSync";

export async function handleDatePickerInteractions(interaction: Interaction): Promise<void> {
  // Edit Date
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_date_")) {
    const channelId = interaction.customId.slice("edit_open_date_".length);
    const state = eventStates.get(channelId);
    const existing = state ? sessionFromDateText(state.dateText) : null;
    const today = new Date();
    const session: EditSession = existing ?? {
      day: today.getDate(), month: today.getMonth() + 1, year: today.getFullYear(),
      time: null, timeHour: null, dayPage: "low",
    };
    editSessions.set(channelId, session);
    await interaction.update({ content: buildEditDateContent(session), components: buildEditDateComponents(session, channelId) });
    return;
  }

  // Edit End Date
  if (interaction.isButton() && interaction.customId.startsWith("edit_open_enddate_")) {
    const channelId = interaction.customId.slice("edit_open_enddate_".length);
    const state = eventStates.get(channelId);
    const existing = state?.endDateText ? sessionFromDateText(state.endDateText) : null;
    const today2 = new Date();
    const session: EditSession = existing ?? sessionFromDateText(state?.dateText ?? "TBC") ?? {
      day: today2.getDate(), month: today2.getMonth() + 1, year: today2.getFullYear(),
      time: null, timeHour: null, dayPage: "low",
    };
    editSessions.set(`end_${channelId}`, session);
    await interaction.update({ content: buildEditDateContent(session, true), components: buildEditDateComponents(session, channelId, true) });
    return;
  }

  // Day select
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("edit_day_") || interaction.customId.startsWith("edit_endday_"))) {
    const isEnd = interaction.customId.startsWith("edit_endday_");
    const channelId = interaction.customId.slice(isEnd ? "edit_endday_".length : "edit_day_".length);
    const session = editSessions.get(isEnd ? `end_${channelId}` : channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "more") { session.dayPage = "high"; }
    else if (value === "back") { session.dayPage = "low"; session.day = null; }
    else { session.day = parseInt(value); }
    await interaction.update({ content: buildEditDateContent(session, isEnd), components: buildEditDateComponents(session, channelId, isEnd) });
    return;
  }

  // Month select
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("edit_month_") || interaction.customId.startsWith("edit_endmonth_"))) {
    const isEnd = interaction.customId.startsWith("edit_endmonth_");
    const channelId = interaction.customId.slice(isEnd ? "edit_endmonth_".length : "edit_month_".length);
    const session = editSessions.get(isEnd ? `end_${channelId}` : channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.month = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session, isEnd), components: buildEditDateComponents(session, channelId, isEnd) });
    return;
  }

  // Year select
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("edit_year_") || interaction.customId.startsWith("edit_endyear_"))) {
    const isEnd = interaction.customId.startsWith("edit_endyear_");
    const channelId = interaction.customId.slice(isEnd ? "edit_endyear_".length : "edit_year_".length);
    const session = editSessions.get(isEnd ? `end_${channelId}` : channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    session.year = parseInt(interaction.values[0]);
    const max = maxDaysInMonth(session.month, session.year);
    if (session.day && session.day > max) { session.day = null; session.dayPage = "low"; }
    if (session.dayPage === "high" && max <= 24) session.dayPage = "low";
    await interaction.update({ content: buildEditDateContent(session, isEnd), components: buildEditDateComponents(session, channelId, isEnd) });
    return;
  }

  // Time select
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("edit_time_") || interaction.customId.startsWith("edit_endtime_"))) {
    const isEnd = interaction.customId.startsWith("edit_endtime_");
    const channelId = interaction.customId.slice(isEnd ? "edit_endtime_".length : "edit_time_".length);
    const session = editSessions.get(isEnd ? `end_${channelId}` : channelId);
    if (!session) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    const value = interaction.values[0];
    if (value === "allday") {
      session.time = "All Day";
      session.timeHour = null;
    } else if (value.startsWith("hour_")) {
      const h = parseInt(value.slice(5));
      if (session.time && session.time !== "All Day" && parseInt(session.time.split(":")[0]) !== h) {
        session.time = null;
      } else if (!session.time || session.time === "All Day") {
        session.time = null;
      }
      session.timeHour = h;
    } else if (value === "return") {
      session.timeHour = null;
    } else {
      session.time = value;
    }
    await interaction.update({ content: buildEditDateContent(session, isEnd), components: buildEditDateComponents(session, channelId, isEnd) });
    return;
  }

  // Confirm date
  if (interaction.isButton() && interaction.customId.startsWith("edit_confirm_")) {
    const channelId = interaction.customId.slice("edit_confirm_".length);
    const session = editSessions.get(channelId);
    if (!session || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    if (!session.day || !session.month || !session.year || !session.time) {
      await interaction.update({ content: "Please select a day, month, year, and time first.", components: buildEditDateComponents(session, channelId) });
      return;
    }

    let dayOfWeek: string;
    let dateText: string;
    if (session.time === "All Day") {
      const d = new Date(session.year, session.month - 1, session.day);
      dayOfWeek = DAYS[d.getDay()];
      dateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, All Day`;
    } else {
      const [hour, minute] = session.time.split(":").map(Number);
      const startDate = new Date(session.year, session.month - 1, session.day, hour, minute);
      dayOfWeek = DAYS[startDate.getDay()];
      dateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, ${session.time}`;
    }

    const state = eventStates.get(channelId);
    editSessions.delete(channelId);
    if (state) state.dateText = dateText;
    persistState();

    try { await interaction.deferUpdate(); } catch {}
    await updateEventMessages(interaction.guild, channelId);
    try { await interaction.deleteReply(); } catch {}

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const displayName = member?.displayName ?? interaction.user.displayName;
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      await eventChannel.send(`📅 **${displayName}** updated the event date to **${dateText}**.`);
    }
    return;
  }

  // Set date to TBC
  if (interaction.isButton() && interaction.customId.startsWith("edit_tbc_")) {
    const channelId = interaction.customId.slice("edit_tbc_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }

    editSessions.delete(channelId);
    const hadDate = state.dateText !== "TBC";
    state.dateText = "TBC";
    persistState();
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();

    if (hadDate) {
      const eventChannel = interaction.guild.channels.cache.get(channelId);
      if (eventChannel && eventChannel.type === ChannelType.GuildText) {
        await eventChannel.send(`📅 The event date has been reset to **TBC**.`);
      }
    }
    return;
  }

  // Cancel date
  if (interaction.isButton() && interaction.customId.startsWith("edit_cancel_")) {
    const channelId = interaction.customId.slice("edit_cancel_".length);
    editSessions.delete(channelId);
    await interaction.deferUpdate();
    await interaction.deleteReply();
    return;
  }

  // Confirm end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endconfirm_")) {
    const channelId = interaction.customId.slice("edit_endconfirm_".length);
    const session = editSessions.get(`end_${channelId}`);
    if (!session || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    if (!session.day || !session.month || !session.year || !session.time) {
      await interaction.update({ content: "Please select a day, month, year, and time first.", components: buildEditDateComponents(session, channelId, true) });
      return;
    }
    const d = session.time === "All Day"
      ? new Date(session.year, session.month - 1, session.day)
      : (() => { const [h, m] = session.time!.split(":").map(Number); return new Date(session.year, session.month - 1, session.day, h, m); })();
    const dayOfWeek = DAYS[d.getDay()];
    const endDateText = `${dayOfWeek} ${session.day} ${MONTHS[session.month - 1]} ${session.year}, ${session.time}`;
    const state = eventStates.get(channelId);
    editSessions.delete(`end_${channelId}`);
    if (state) state.endDateText = endDateText;
    persistState();
    try { await interaction.deferUpdate(); } catch {}
    await updateEventMessages(interaction.guild, channelId);
    try { await interaction.deleteReply(); } catch {}
    const eventChannel = interaction.guild.channels.cache.get(channelId);
    if (eventChannel && eventChannel.type === ChannelType.GuildText) {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      const displayName = member?.displayName ?? interaction.user.displayName;
      await eventChannel.send(`🏁 **${displayName}** set the end date to **${endDateText}**.`);
    }
    return;
  }

  // Remove end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endremove_")) {
    const channelId = interaction.customId.slice("edit_endremove_".length);
    const state = eventStates.get(channelId);
    if (!state || !interaction.guild) { await interaction.update({ content: "Session expired.", components: [] }); return; }
    editSessions.delete(`end_${channelId}`);
    state.endDateText = undefined;
    persistState();
    await updateEventMessages(interaction.guild, channelId);
    await interaction.deleteReply();
    return;
  }

  // Cancel end date
  if (interaction.isButton() && interaction.customId.startsWith("edit_endcancel_")) {
    const channelId = interaction.customId.slice("edit_endcancel_".length);
    editSessions.delete(`end_${channelId}`);
    await interaction.deferUpdate();
    await interaction.deleteReply();
    return;
  }
}

