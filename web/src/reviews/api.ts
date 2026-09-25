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
  creator: string | null;
  year: number | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorFirstName: string | null;
  authorAvatarUrl: string | null;
  canEdit?: boolean;
}

export type ReviewDraft = Pick<Review, "title" | "progress" | "summary" | "bodyHtml" | "imageUrl" | "wikiTitle" | "creator"> & { typeId: number | null; rating: number | null; year: number | string | null };

// "Frank Herbert · 1965", or whichever half is known.
export const creditLine = (r: { creator: string | null; year: number | null }) => [r.creator, r.year].filter(Boolean).join(" · ");

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

export interface WikiCandidate { pageTitle: string; description: string; imageUrl: string | null; wikidataId: string | null }
export interface WikiDetails { creator: string | null; year: number | null }

// How to match each type on Wikipedia/Wikidata:
//  - hint/suffixes/match: search hint, the page-name suffixes Wikipedia disambiguates with, and words
//    that show a page is about that kind of thing (used to rank results)
//  - creatorLabel/creatorProps/yearProps: which Wikidata properties hold "who made it" and "when"
// The built-in types are tuned; user-added types fall back to their own name (e.g. "Video game" →
// "Hades (video game)") and a general-purpose list of properties.
type WikiProfile = { hint: string; suffixes: string[]; match: RegExp; creatorLabel: string; creatorProps: string[]; yearProps: string[] };
const GENERIC_CREATOR_PROPS = ["P50", "P57", "P170", "P178", "P175", "P86", "P943"]; // author, director, creator, developer, performer, composer, programmer
const GENERIC_YEAR_PROPS = ["P577", "P580", "P571"]; // publication date, start time, inception
const BUILT_IN_PROFILES: Record<string, WikiProfile> = {
  book: { hint: "book", suffixes: ["", " (novel)", " (book)"], match: /\b(novel|novella|book|memoir|comic|manga|poem|non-fiction)\b/i, creatorLabel: "Author", creatorProps: ["P50", "P98"], yearProps: ["P577"] },
  film: { hint: "film", suffixes: ["", " (film)"], match: /\b(film|movie)\b/i, creatorLabel: "Director", creatorProps: ["P57"], yearProps: ["P577"] },
  series: { hint: "TV series", suffixes: ["", " (TV series)", " (miniseries)"], match: /\b(tv|television|series|miniseries|sitcom|anime|drama)\b/i, creatorLabel: "Creator", creatorProps: ["P170", "P57"], yearProps: ["P580", "P577"] },
};

function wikiProfile(typeName: string): WikiProfile {
  const key = typeName.trim().toLowerCase();
  if (BUILT_IN_PROFILES[key]) return BUILT_IN_PROFILES[key];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { hint: key, suffixes: ["", ` (${key})`], match: new RegExp(`\\b${escaped}\\b`, "i"), creatorLabel: "Creator", creatorProps: GENERIC_CREATOR_PROPS, yearProps: GENERIC_YEAR_PROPS };
}

// "Author" for books, "Director" for films, etc. — the label for the creator field.
export const creatorLabel = (typeName: string) => wikiProfile(typeName).creatorLabel;

// Wikipedia's own ordering happily puts "The Hobbit (film series)" above the novel, so re-rank:
// an exact title match counts most, then a page/description that reads like the chosen type,
// then having an image to use as the cover.
function wikiScore(page: WikiPage, title: string, typeName: string): number {
  const base = page.title.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
  const text = `${page.title} ${page.description ?? ""}`;
  const profile = wikiProfile(typeName);
  let score = base === title.toLowerCase() ? 3 : 0;
  if (profile.match.test(text)) score += 2;
  else if (Object.values(BUILT_IN_PROFILES).some(p => p !== profile && p.match.test(text))) score -= 2;
  if (page.thumbnail) score += 0.5;
  return score;
}

// Wikipedia serves page thumbnails from either host (the server only accepts these two as well).
const WIKIMEDIA_IMAGE = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;

type WikiPage = {
  index: number; title: string; description?: string; missing?: string;
  thumbnail?: { source: string };
  pageprops?: { wikibase_item?: string; disambiguation?: string };
};

async function wikiQuery(extra: Record<string, string>, signal?: AbortSignal): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*", redirects: "1",
    prop: "pageimages|description|pageprops", piprop: "thumbnail", pithumbsize: "600", pilicense: "any",
    ppprop: "wikibase_item|disambiguation", ...extra,
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return Object.values(data?.query?.pages ?? {}) as WikiPage[];
}

// Searches English Wikipedia for pages matching the title (plus a type hint), best match first.
// Search alone can miss the obvious page (e.g. "The Bear" + TV series), so the conventional
// disambiguated page names are also looked up directly and merged in. pilicense=any is needed for
// the cover — film posters and book covers are non-free images.
export async function searchWikipedia(title: string, typeName: string, signal?: AbortSignal): Promise<WikiCandidate[]> {
  const profile = wikiProfile(typeName);
  const [searched, direct] = await Promise.all([
    wikiQuery({ generator: "search", gsrsearch: `${title} ${profile.hint}`, gsrlimit: "10" }, signal),
    wikiQuery({ titles: profile.suffixes.map(s => title + s).join("|") }, signal),
  ]);
  const byTitle = new Map<string, WikiPage>();
  for (const p of searched) byTitle.set(p.title, p);
  for (const p of direct) if (!byTitle.has(p.title)) byTitle.set(p.title, { ...p, index: 99 });
  return [...byTitle.values()]
    .filter(p => p.missing === undefined && p.pageprops?.disambiguation === undefined)
    .map(p => ({ p, score: wikiScore(p, title, typeName) }))
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index)
    .slice(0, 8)
    .map(({ p }) => ({
      pageTitle: p.title,
      description: p.description ?? "",
      imageUrl: p.thumbnail && WIKIMEDIA_IMAGE.test(p.thumbnail.source) ? p.thumbnail.source.split("?")[0] : null,
      wikidataId: p.pageprops?.wikibase_item ?? null,
    }));
}

type WikidataClaim = { mainsnak: { datavalue?: { value: { id?: string; time?: string } } } };
type WikidataEntity = { claims?: Record<string, WikidataClaim[]>; labels?: { en?: { value: string } } };

async function wikidataEntities(ids: string[], props: string, signal?: AbortSignal): Promise<Record<string, WikidataEntity>> {
  const params = new URLSearchParams({ action: "wbgetentities", format: "json", origin: "*", ids: ids.join("|"), props, languages: "en" });
  const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal });
  if (!res.ok) return {};
  return (await res.json())?.entities ?? {};
}

// Who made it (author / director / creator…) and the year, from the page's Wikidata item. For each,
// the first property on the type's list that has values wins; the earliest year is used, since
// films list a release date per country.
export async function fetchWikiDetails(wikidataId: string, typeName: string, signal?: AbortSignal): Promise<WikiDetails> {
  const profile = wikiProfile(typeName);
  const entity = (await wikidataEntities([wikidataId], "claims", signal))[wikidataId];
  const values = (prop: string) => (entity?.claims?.[prop] ?? []).map(c => c.mainsnak.datavalue?.value).filter(v => v !== undefined);

  let year: number | null = null;
  for (const prop of profile.yearProps) {
    const years = values(prop).map(v => v!.time?.match(/^\+(\d{1,4})-/)?.[1]).filter((y): y is string => !!y).map(Number);
    if (years.length) { year = Math.min(...years); break; }
  }

  let creator: string | null = null;
  for (const prop of profile.creatorProps) {
    const ids = values(prop).map(v => v!.id).filter((id): id is string => !!id).slice(0, 3);
    if (!ids.length) continue;
    const people = await wikidataEntities(ids, "labels", signal);
    const names = ids.map(id => people[id]?.labels?.en?.value).filter((n): n is string => !!n);
    if (names.length) { creator = names.length > 2 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names.join(" & "); break; }
  }

  return { creator, year };
}
