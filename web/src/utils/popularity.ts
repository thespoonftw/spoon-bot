// Popularity order: a super vote counts 3 and any other vote 1 (rankScore from the server).
// The number shown on photos is the plain vote count (score) instead.
export function byPopularity(a: { rankScore?: number }, b: { rankScore?: number }): number {
  return (b.rankScore ?? 0) - (a.rankScore ?? 0);
}
