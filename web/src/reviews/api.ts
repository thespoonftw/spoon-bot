export type Progress = "ongoing" | "stopped" | "finished";

export interface ReviewType { id: number; name: string; icon: string; color: string; reviewCount: number; createdByName: string | null }
export interface ReviewProfile {
  user: { userId: string; displayName: string; firstName: string | null; avatarUrl: string | null };
  reviews: Review[];
}

export interface Review {
  id: number;
  userId: string;
  title: string;
  typeId: number;
  typeName: string;
  typeIcon: string;
  typeColor: string;
  rating: number;
  progress: Progress;
  summary: string | null;
  bodyHtml: string | null;
  imageUrl: string | null;
  wikiTitle: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorFirstName: string | null;
  authorAvatarUrl: string | null;
  canEdit?: boolean;
}

export type ReviewDraft = Pick<Review, "title" | "progress" | "summary" | "bodyHtml" | "imageUrl" | "wikiTitle"> & { typeId: number | null; rating: number | null };

export const PROGRESS_OPTIONS: { value: Progress; label: string }[] = [
  { value: "ongoing", label: "Ongoing" },
  { value: "stopped", label: "Stopped Early" },
  { value: "finished", label: "Finished" },
];

export const progressLabel = (p: Progress) => PROGRESS_OPTIONS.find(o => o.value === p)?.label ?? p;
export const authorName = (r: Review) => r.authorFirstName || r.authorName;

export function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function fetchReviewTypes(): Promise<ReviewType[]> {
  const res = await fetch("/api/review-types");
  return res.ok ? res.json() : [];
}

export async function fetchReviewProfile(userId: string): Promise<ReviewProfile | null> {
  const res = await fetch(`/api/reviews/user/${encodeURIComponent(userId)}`);
  return res.ok ? res.json() : null;
}

// Adds a type (or returns the existing one with that name).
export async function createReviewType(name: string, icon: string): Promise<ReviewType | { error: string }> {
  const res = await fetch("/api/review-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error ?? "Couldn't add that type." };
}

export interface WikiCandidate { pageTitle: string; description: string; imageUrl: string }

// How to search Wikipedia for each type: the search hint, the page-name suffixes Wikipedia uses to
// disambiguate, and words that show a page is about that kind of thing. The built-in types are tuned;
// user-added types fall back to their own name (e.g. "Video game" → "Hades (video game)").
type WikiProfile = { hint: string; suffixes: string[]; match: RegExp };
const BUILT_IN_PROFILES: Record<string, WikiProfile> = {
  book: { hint: "book", suffixes: ["", " (novel)", " (book)"], match: /\b(novel|novella|book|memoir|comic|manga|poem|non-fiction)\b/i },
  film: { hint: "film", suffixes: ["", " (film)"], match: /\b(film|movie)\b/i },
  series: { hint: "TV series", suffixes: ["", " (TV series)", " (miniseries)"], match: /\b(tv|television|series|miniseries|sitcom|anime|drama)\b/i },
};

function wikiProfile(typeName: string): WikiProfile {
  const key = typeName.trim().toLowerCase();
  if (BUILT_IN_PROFILES[key]) return BUILT_IN_PROFILES[key];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { hint: key, suffixes: ["", ` (${key})`], match: new RegExp(`\\b${escaped}\\b`, "i") };
}

// Wikipedia's own ordering happily puts "The Hobbit (film series)" above the novel, so re-rank:
// an exact title match counts most, then a page/description that reads like the chosen type.
function wikiScore(page: { title: string; description?: string }, title: string, typeName: string): number {
  const base = page.title.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
  const text = `${page.title} ${page.description ?? ""}`;
  const profile = wikiProfile(typeName);
  let score = base === title.toLowerCase() ? 3 : 0;
  if (profile.match.test(text)) score += 2;
  else if (Object.values(BUILT_IN_PROFILES).some(p => p !== profile && p.match.test(text))) score -= 2;
  return score;
}

type WikiPage = { index: number; title: string; description?: string; thumbnail?: { source: string } };

async function wikiQuery(extra: Record<string, string>, signal?: AbortSignal): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*", redirects: "1",
    prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "600", pilicense: "any", ...extra,
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return Object.values(data?.query?.pages ?? {}) as WikiPage[];
}

// Searches English Wikipedia for the title (plus a type hint) and returns the pages that have a lead
// image, best match first. pilicense=any is needed — film posters and book covers are non-free images.
// Search alone can miss the obvious page (e.g. "The Bear" + TV series), so the conventional
// disambiguated page names are also looked up directly and merged in.
export async function searchWikipediaImages(title: string, typeName: string, signal?: AbortSignal): Promise<WikiCandidate[]> {
  const profile = wikiProfile(typeName);
  const [searched, direct] = await Promise.all([
    wikiQuery({ generator: "search", gsrsearch: `${title} ${profile.hint}`, gsrlimit: "8" }, signal),
    wikiQuery({ titles: profile.suffixes.map(s => title + s).join("|") }, signal),
  ]);
  const byTitle = new Map<string, WikiPage>();
  for (const p of searched) byTitle.set(p.title, p);
  for (const p of direct) if (!byTitle.has(p.title)) byTitle.set(p.title, { ...p, index: 99 });
  return [...byTitle.values()]
    .filter(p => p.thumbnail?.source?.startsWith("https://upload.wikimedia.org/"))
    .map(p => ({ p, score: wikiScore(p, title, typeName) }))
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index)
    .map(({ p }) => ({ pageTitle: p.title, description: p.description ?? "", imageUrl: p.thumbnail!.source.split("?")[0] }))
    .filter((c, i, all) => all.findIndex(o => o.imageUrl === c.imageUrl) === i);
}
