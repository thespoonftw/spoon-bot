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
