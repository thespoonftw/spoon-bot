// Popularity order: photos with a heart (at least one super vote) come first, then by number of votes.
export function byPopularity(a: { score?: number; superCount?: number }, b: { score?: number; superCount?: number }): number {
  const heart = Number((b.superCount ?? 0) > 0) - Number((a.superCount ?? 0) > 0);
  return heart || (b.score ?? 0) - (a.score ?? 0);
}
