import type { EditSession } from "./types";

export const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function maxDaysInMonth(month: number | null, year: number | null): number {
  if (!month) return 31;
  return new Date(year ?? 2024, month, 0).getDate();
}

export function parseDateText(dateText: string): Date | null {
  try {
    const [datePart, timePart] = dateText.split(", ");
    const [dayStr, monthStr, yearStr] = datePart.split(" ");
    if (timePart === "All Day") {
      return new Date(parseInt(yearStr), MONTHS.indexOf(monthStr), parseInt(dayStr), 12, 0);
    }
    const [hourStr, minuteStr] = timePart.split(":");
    return new Date(parseInt(yearStr), MONTHS.indexOf(monthStr), parseInt(dayStr), parseInt(hourStr), parseInt(minuteStr));
  } catch { return null; }
}

export function sessionFromDateText(dateText: string): EditSession | null {
  if (dateText === "TBC") return null;
  try {
    const commaIdx = dateText.lastIndexOf(", ");
    const datePart = dateText.slice(0, commaIdx);
    const timePart = dateText.slice(commaIdx + 2);
    const parts = datePart.split(" ");
    const day = parseInt(parts[1]);
    const month = MONTHS.indexOf(parts[2]) + 1;
    const year = parseInt(parts[3]);
    if (!day || !month || !year) return null;
    return { day, month, year, time: timePart, timeHour: null, dayPage: day > 24 ? "high" : "low" };
  } catch { return null; }
}
