export type MediaType = "book" | "film" | "series";
export type Progress = "ongoing" | "stopped" | "finished";

export interface Review {
  id: number;
  userId: string;
  title: string;
  mediaType: MediaType;
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

export type ReviewDraft = Pick<Review, "title" | "mediaType" | "progress" | "summary" | "bodyHtml" | "imageUrl" | "wikiTitle"> & { rating: number | null };

export const MEDIA_TYPES: { value: MediaType; label: string; plural: string; icon: string }[] = [
  { value: "book", label: "Book", plural: "Books", icon: "📖" },
  { value: "film", label: "Film", plural: "Films", icon: "🎬" },
  { value: "series", label: "Series", plural: "Series", icon: "📺" },
];

export const PROGRESS_OPTIONS: { value: Progress; label: string }[] = [
  { value: "ongoing", label: "Ongoing" },
  { value: "stopped", label: "Stopped Early" },
  { value: "finished", label: "Finished" },
];

export const mediaLabel = (t: MediaType) => MEDIA_TYPES.find(m => m.value === t)?.label ?? t;
export const mediaIcon = (t: MediaType) => MEDIA_TYPES.find(m => m.value === t)?.icon ?? "";
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

export interface WikiCandidate { pageTitle: string; description: string; imageUrl: string }

const WIKI_HINT: Record<MediaType, string> = { book: "book", film: "film", series: "TV series" };
const WIKI_TYPE_RE: Record<MediaType, RegExp> = {
  book: /\b(novel|novella|book|memoir|comic|manga|poem|non-fiction)\b/i,
  film: /\b(film|movie)\b/i,
  series: /\b(tv|television|series|miniseries|sitcom|anime|drama)\b/i,
};

// Wikipedia's own ordering happily puts "The Hobbit (film series)" above the novel, so re-rank:
// an exact title match counts most, then a page/description that reads like the chosen media type.
function wikiScore(page: { title: string; description?: string }, title: string, mediaType: MediaType): number {
  const base = page.title.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
  const text = `${page.title} ${page.description ?? ""}`;
  let score = base === title.toLowerCase() ? 3 : 0;
  if (WIKI_TYPE_RE[mediaType].test(text)) score += 2;
  else if ((Object.keys(WIKI_TYPE_RE) as MediaType[]).some(t => t !== mediaType && WIKI_TYPE_RE[t].test(text))) score -= 2;
  return score;
}

// Searches English Wikipedia for the title (plus a media hint) and returns the pages that have a lead
// image, best match first. pilicense=any is needed — film posters and book covers are non-free images.
// Search alone can miss the obvious page (e.g. "The Bear" + TV series), so the conventional
// disambiguated page names are also looked up directly and merged in.
const WIKI_DIRECT_SUFFIXES: Record<MediaType, string[]> = {
  book: ["", " (novel)", " (book)"],
  film: ["", " (film)"],
  series: ["", " (TV series)", " (miniseries)"],
};

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

export async function searchWikipediaImages(title: string, mediaType: MediaType, signal?: AbortSignal): Promise<WikiCandidate[]> {
  const [searched, direct] = await Promise.all([
    wikiQuery({ generator: "search", gsrsearch: `${title} ${WIKI_HINT[mediaType]}`, gsrlimit: "8" }, signal),
    wikiQuery({ titles: WIKI_DIRECT_SUFFIXES[mediaType].map(s => title + s).join("|") }, signal),
  ]);
  const byTitle = new Map<string, WikiPage>();
  for (const p of searched) byTitle.set(p.title, p);
  for (const p of direct) if (!byTitle.has(p.title)) byTitle.set(p.title, { ...p, index: 99 });
  return [...byTitle.values()]
    .filter(p => p.thumbnail?.source?.startsWith("https://upload.wikimedia.org/"))
    .map(p => ({ p, score: wikiScore(p, title, mediaType) }))
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index)
    .map(({ p }) => ({ pageTitle: p.title, description: p.description ?? "", imageUrl: p.thumbnail!.source.split("?")[0] }))
    .filter((c, i, all) => all.findIndex(o => o.imageUrl === c.imageUrl) === i);
}
