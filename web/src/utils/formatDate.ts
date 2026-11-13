export function formatAlbumDate(startDate: string, endDate?: string, showYear = false): string {
  const parse = (s: string) => {
    const d = new Date(s + "T00:00:00Z");
    const day = d.getUTCDate();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th";
    return { day, suffix, month, year };
  };
  const s = parse(startDate);
  if (!endDate) return showYear ? `${s.day}${s.suffix} ${s.month} ${s.year}` : `${s.day}${s.suffix} ${s.month}`;
  const e = parse(endDate);
  if (s.year === e.year) return showYear ? `${s.day}${s.suffix} ${s.month} – ${e.day}${e.suffix} ${e.month} ${e.year}` : `${s.day}${s.suffix} ${s.month} – ${e.day}${e.suffix} ${e.month}`;
  return `${s.day}${s.suffix} ${s.month} ${s.year} – ${e.day}${e.suffix} ${e.month} ${e.year}`;
}

// "Oct '23": the month an album mostly falls in, for photos with no date of their own. When an album spans
// several months it's the month with the most of its days (the earlier month on a tie).
export function albumMonthLabel(startDate: string, endDate?: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const start = new Date(startDate.slice(0, 10) + "T00:00:00Z");
  const end = endDate ? new Date(endDate.slice(0, 10) + "T00:00:00Z") : start;
  const days = new Map<string, number>();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  let best = `${start.getUTCFullYear()}-${start.getUTCMonth()}`;
  for (const [key, n] of days) if (n > (days.get(best) ?? 0)) best = key;
  const [year, month] = best.split("-").map(Number);
  return `${months[month]} '${String(year).slice(2)}`;
}
