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
  sourceUrl: string | null;
  season: number | null;
  platform: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorFirstName: string | null;
  authorAvatarUrl: string | null;
  canEdit?: boolean;
}

export type ReviewDraft = Pick<Review, "title" | "progress" | "summary" | "bodyHtml" | "imageUrl" | "wikiTitle" | "creator" | "sourceUrl" | "platform"> & { typeId: number | null; rating: number | null; year: number | string | null; season: number | null };

// "Frank Herbert · 1965", "Season 2 · 2023", "Nintendo Switch · 2020" — whichever parts are known.
export const creditLine = (r: { creator: string | null; year: number | null; season?: number | null; platform?: string | null }) =>
  [r.creator, r.season != null ? `Season ${r.season}` : null, r.platform, r.year].filter(Boolean).join(" · ");

export type MatchSource = "openlibrary" | "tvmaze" | "applepodcasts" | "wikipedia";
export const SOURCE_NAMES: Record<MatchSource, string> = { openlibrary: "Open Library", tvmaze: "TVmaze", applepodcasts: "Apple Podcasts", wikipedia: "Wikipedia" };
const SOURCE_HOSTS: Record<MatchSource, string> = { openlibrary: "https://openlibrary.org/", tvmaze: "https://www.tvmaze.com/", applepodcasts: "https://podcasts.apple.com/", wikipedia: "https://en.wikipedia.org/" };

export const wikiUrl = (pageTitle: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

// Where a review's details came from, for the "Wikipedia ↗" / "Open Library ↗" link. Reviews saved
// before sourceUrl existed only have wikiTitle.
export function matchSource(r: { sourceUrl: string | null; wikiTitle: string | null }): { url: string; source: MatchSource; name: string } | null {
  const url = r.sourceUrl ?? (r.wikiTitle ? wikiUrl(r.wikiTitle) : null);
  if (!url) return null;
  const source = (Object.keys(SOURCE_HOSTS) as MatchSource[]).find(s => url.startsWith(SOURCE_HOSTS[s])) ?? "wikipedia";
  return { url, source, name: SOURCE_NAMES[source] };
}

export const PROGRESS_OPTIONS: { value: Progress; label: string }[] = [
  { value: "ongoing", label: "Ongoing" },
  { value: "stopped", label: "Stopped Early" },
  { value: "finished", label: "Finished" },
];

// A word for each star rating, 0–5.
export const RATING_LABELS = ["Awful", "Poor", "Weak", "Good", "Great", "Perfect"];

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

// A possible match for what's being reviewed: an Open Library book, TVmaze show or Wikipedia page. `url` is
// the page's address and doubles as its id in the editor's dropdown.
export interface MatchCandidate {
  source: MatchSource;
  url: string;
  label: string;
  description: string;
  imageUrl: string | null;
  wikiTitle: string | null;   // Wikipedia pages only
  wikidataId: string | null;  // Wikipedia pages only — creator/year are looked up from it on selection
  details: MatchDetails | null; // Open Library: year and first author from the search (full author list is fetched on selection)
}
export interface MatchDetails { creator: string | null; year: number | null; platforms?: string[] }

// The optional extra detail some types have: which season of a series, or which platform a game was
// played on.
export type TypeExtra = "season" | "platform";
export function typeExtra(typeName: string): TypeExtra | null {
  const key = typeName.trim().toLowerCase();
  return key === "series" ? "season" : key === "video game" ? "platform" : null;
}

// Offered for every game, after the platforms the matched game was actually released on.
export const COMMON_PLATFORMS = [
  "PC", "Mac", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One",
  "Nintendo Switch 2", "Nintendo Switch", "Steam Deck", "iOS", "Android", "Meta Quest",
];
// Wikidata's names for platforms, where people would say something shorter.
const PLATFORM_ALIASES: Record<string, string> = {
  "Microsoft Windows": "PC", "Windows": "PC", "macOS": "Mac", "Classic Mac OS": "Mac",
  "Xbox Series X and Series S": "Xbox Series X|S", "Xbox Series X/S": "Xbox Series X|S",
  "Nintendo Switch 2": "Nintendo Switch 2", "iPadOS": "iOS", "Oculus Quest": "Meta Quest",
};
const normalizePlatform = (name: string) => PLATFORM_ALIASES[name] ?? name;

export interface SeasonOption { number: number; year: number | null; imageUrl: string | null }

// A TVmaze show's seasons (from its show URL), for the season dropdown.
export async function fetchTvmazeSeasons(showUrl: string, signal?: AbortSignal): Promise<SeasonOption[]> {
  const id = showUrl.match(/^https:\/\/www\.tvmaze\.com\/shows\/(\d+)\//)?.[1];
  if (!id) return [];
  const res = await fetch(`https://api.tvmaze.com/shows/${id}/seasons`, { signal });
  if (!res.ok) return [];
  const seasons = (await res.json()) as { number: number | null; premiereDate: string | null; image?: { original?: string; medium?: string } | null }[];
  return seasons
    .filter((s): s is typeof s & { number: number } => typeof s.number === "number")
    .map(s => {
      const image = s.image?.original ?? s.image?.medium ?? null;
      return {
        number: s.number,
        year: s.premiereDate ? Number(s.premiereDate.slice(0, 4)) : null,
        imageUrl: image?.startsWith("https://static.tvmaze.com/") ? image : null,
      };
    });
}

// How to match each type on Wikipedia/Wikidata:
//  - hint/suffixes/match: search hint, the page-name suffixes Wikipedia disambiguates with, and words
//    that show a page is about that kind of thing (used to rank results)
//  - creatorLabel/creatorProps/yearProps: which Wikidata properties hold "who made it" and "when"
// The built-in types are tuned; user-added types fall back to their own name (e.g. "Video game" →
// "Hades (video game)") and a general-purpose list of properties.
type WikiProfile = { hint: string; suffixes: string[]; match: RegExp; creatorLabel: string | null; creatorProps: string[]; yearProps: string[] };
const GENERIC_CREATOR_PROPS = ["P50", "P57", "P170", "P178", "P175", "P86", "P943"]; // author, director, creator, developer, performer, composer, programmer
const GENERIC_YEAR_PROPS = ["P577", "P580", "P571"]; // publication date, start time, inception
const BUILT_IN_PROFILES: Record<string, WikiProfile> = {
  book: { hint: "book", suffixes: ["", " (novel)", " (book)"], match: /\b(novel|novella|book|memoir|comic|manga|poem|non-fiction)\b/i, creatorLabel: "Author(s)", creatorProps: ["P50", "P98"], yearProps: ["P577"] },
  film: { hint: "film", suffixes: ["", " (film)"], match: /\b(film|movie)\b/i, creatorLabel: null, creatorProps: [], yearProps: ["P577"] },
  series: { hint: "TV series", suffixes: ["", " (TV series)", " (miniseries)"], match: /\b(tv|television|series|miniseries|sitcom|anime|drama)\b/i, creatorLabel: null, creatorProps: [], yearProps: ["P580", "P577"] },
  // P287 = designed by
  "board game": { hint: "board game", suffixes: ["", " (board game)", " (game)"], match: /\b(board game|card game|tabletop|game)\b/i, creatorLabel: "Designer(s)", creatorProps: ["P287", "P170", "P50"], yearProps: ["P577", "P571"] },
};

function wikiProfile(typeName: string): WikiProfile {
  const key = typeName.trim().toLowerCase();
  if (BUILT_IN_PROFILES[key]) return BUILT_IN_PROFILES[key];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { hint: key, suffixes: ["", ` (${key})`], match: new RegExp(`\\b${escaped}\\b`, "i"), creatorLabel: "Creator(s)", creatorProps: GENERIC_CREATOR_PROPS, yearProps: GENERIC_YEAR_PROPS };
}

// Label for the creator field — "Author(s)" for books, "Creator(s)" for custom types — or null for
// types that don't have one (films and series).
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
async function searchWikipedia(title: string, typeName: string, signal?: AbortSignal): Promise<MatchCandidate[]> {
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
      source: "wikipedia" as const,
      url: wikiUrl(p.title),
      label: p.title,
      description: p.description ?? "",
      imageUrl: p.thumbnail && WIKIMEDIA_IMAGE.test(p.thumbnail.source) ? p.thumbnail.source.split("?")[0] : null,
      wikiTitle: p.title,
      wikidataId: p.pageprops?.wikibase_item ?? null,
      details: null,
    }));
}

type OpenLibraryDoc = { key: string; title: string; author_name?: string[]; first_publish_year?: number; cover_i?: number; edition_count?: number };

// Study guides and "Summary of…" knock-offs crowd the results for popular books.
const OPEN_LIBRARY_JUNK = /\b(summary|study guide|sparknotes|cliffsnotes|workbook|analysis of)\b/i;

// Searches Open Library (Internet Archive), which covers far more books than Wikipedia and returns
// author, first-publication year and a cover in one go. Exact title matches come first, then the
// most-published works, so the real book beats omnibuses and knock-offs.
async function searchOpenLibrary(title: string, signal?: AbortSignal): Promise<MatchCandidate[]> {
  // title= rather than q= — a general query also matches quotes and subjects (q=Project Hail Mary finds Shakespeare).
  const params = new URLSearchParams({ title, fields: "key,title,author_name,first_publish_year,cover_i,edition_count", limit: "15" });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
  if (!res.ok) return [];
  const docs = ((await res.json())?.docs ?? []) as OpenLibraryDoc[];
  const wanted = title.trim().toLowerCase();
  return docs
    // Entries with neither an author nor a cover are near-empty duplicates of the real work.
    .filter(d => /^\/works\/OL\d+W$/.test(d.key) && !OPEN_LIBRARY_JUNK.test(d.title) && (d.author_name?.length || d.cover_i))
    .map((d, index) => ({ d, index, exact: d.title.trim().toLowerCase() === wanted ? 1 : 0 }))
    .sort((a, b) => b.exact - a.exact || (b.d.edition_count ?? 0) - (a.d.edition_count ?? 0) || a.index - b.index)
    .slice(0, 6)
    .map(({ d }) => {
      // Only the first listed author: Open Library often appends translators and editors to author_name.
      const creator = d.author_name?.[0] ?? null;
      const year = d.first_publish_year ?? null;
      return {
        source: "openlibrary" as const,
        url: `https://openlibrary.org${d.key}`,
        label: d.title,
        description: [creator, year].filter(Boolean).join(", "),
        imageUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
        wikiTitle: null,
        wikidataId: null,
        details: { creator, year },
      };
    });
}

type TvmazeShow = { name: string; url: string; premiered: string | null; network?: { name: string } | null; webChannel?: { name: string } | null; image?: { medium?: string; original?: string } | null };

// Searches TVmaze, a free TV database with far better series coverage and posters than Wikipedia.
// Its own ranking is good; exact name matches are just nudged to the top.
async function searchTvmaze(title: string, signal?: AbortSignal): Promise<MatchCandidate[]> {
  const res = await fetch(`https://api.tvmaze.com/search/shows?${new URLSearchParams({ q: title })}`, { signal });
  if (!res.ok) return [];
  const results = (await res.json()) as { score: number; show: TvmazeShow }[];
  const wanted = title.trim().toLowerCase();
  return results
    .map(({ show }, index) => ({ show, index, exact: show.name.trim().toLowerCase() === wanted ? 1 : 0 }))
    .sort((a, b) => b.exact - a.exact || a.index - b.index)
    .slice(0, 8)
    .map(({ show }) => {
      const year = show.premiered ? Number(show.premiered.slice(0, 4)) : null;
      const image = show.image?.original ?? show.image?.medium ?? null;
      return {
        source: "tvmaze" as const,
        url: show.url.replace(/^http:/, "https:"),
        label: show.name,
        description: [year, show.network?.name ?? show.webChannel?.name].filter(Boolean).join(", "),
        imageUrl: image?.startsWith("https://static.tvmaze.com/") ? image : null,
        wikiTitle: null,
        wikidataId: null,
        details: { creator: null, year },
      };
    });
}

type ApplePodcast = { collectionName: string; artistName?: string; collectionViewUrl?: string; artworkUrl600?: string; primaryGenreName?: string };

// Searches Apple's podcast directory (free, no key, browser-callable) for square artwork and who
// makes the show. It only reports the latest episode's date, not when the show began, so no year.
async function searchApplePodcasts(title: string, signal?: AbortSignal): Promise<MatchCandidate[]> {
  const res = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ media: "podcast", entity: "podcast", limit: "10", term: title })}`, { signal });
  if (!res.ok) return [];
  const results = ((await res.json())?.results ?? []) as ApplePodcast[];
  const wanted = title.trim().toLowerCase();
  const seen = new Set<string>();
  return results
    .map(p => ({ p, url: p.collectionViewUrl?.split("?")[0] ?? "" }))
    .filter(({ url }) => /^https:\/\/podcasts\.apple\.com\/[a-z]{2}\/podcast\/[^/?]+\/id\d+$/.test(url) && !seen.has(url) && !!seen.add(url))
    .map(({ p, url }, index) => ({ p, url, index, exact: p.collectionName.trim().toLowerCase() === wanted ? 1 : 0 }))
    .sort((a, b) => b.exact - a.exact || a.index - b.index)
    .slice(0, 8)
    .map(({ p, url }) => ({
      source: "applepodcasts" as const,
      url,
      label: p.collectionName,
      description: [p.artistName, p.primaryGenreName].filter(Boolean).join(", "),
      imageUrl: p.artworkUrl600 && /^https:\/\/is\d+-ssl\.mzstatic\.com\//.test(p.artworkUrl600) ? p.artworkUrl600 : null,
      wikiTitle: null,
      wikidataId: null,
      details: { creator: p.artistName ?? null, year: null },
    }));
}

// Candidates for the editor's dropdown, best first. Books use Open Library, series TVmaze and
// podcasts Apple Podcasts (all cover far more than Wikipedia and have proper artwork); everything
// else uses Wikipedia.
export async function searchMatches(title: string, typeName: string, signal?: AbortSignal): Promise<MatchCandidate[]> {
  switch (typeName.trim().toLowerCase()) {
    case "book": return searchOpenLibrary(title, signal);
    case "series": return searchTvmaze(title, signal);
    case "podcast": return searchApplePodcasts(title, signal);
    default: return searchWikipedia(title, typeName, signal);
  }
}

// "Terry Pratchett & Neil Gaiman", "A, B & C".
const joinNames = (names: string[]) => names.length > 2 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names.join(" & ");

// All of a book's authors, from its Open Library work record. The search results' author list is
// merged from every edition and so includes translators and editors; the work record is usually
// just the real authors (though not always — some works list a translator too).
async function fetchOpenLibraryAuthors(workUrl: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`${workUrl}.json`, { signal });
  if (!res.ok) return null;
  const work = await res.json() as { authors?: { author?: { key?: string } }[] };
  const keys = (work.authors ?? []).map(a => a.author?.key).filter((k): k is string => !!k && /^\/authors\/OL\d+A$/.test(k)).slice(0, 4);
  const names = await Promise.all(keys.map(async key => {
    const r = await fetch(`https://openlibrary.org${key}.json`, { signal });
    return r.ok ? ((await r.json()) as { name?: string }).name ?? null : null;
  }));
  const found = names.filter((n): n is string => !!n);
  return found.length ? joinNames(found) : null;
}

// Creator and year for the chosen match. Books: the year comes with the search result and the
// authors from the work record (falling back to the search's first author). Wikipedia pages look
// both up on Wikidata.
export async function fetchMatchDetails(c: MatchCandidate, typeName: string, signal?: AbortSignal): Promise<MatchDetails> {
  if (c.source === "openlibrary") {
    const authors = await fetchOpenLibraryAuthors(c.url, signal).catch(e => { if ((e as Error).name === "AbortError") throw e; return null; });
    return { creator: authors ?? c.details?.creator ?? null, year: c.details?.year ?? null };
  }
  if (c.details) return c.details;
  if (!c.wikidataId) return { creator: null, year: null };
  return fetchWikiDetails(c.wikidataId, typeName, signal);
}

type WikidataClaim = { mainsnak: { datavalue?: { value: { id?: string; time?: string } } } };
// English name, or the language-neutral one — Wikidata keeps brand names like "Nintendo Switch" or
// "PlayStation 4" only under "mul", with no English label at all.
const labelOf = (e: WikidataEntity | undefined) => e?.labels?.en?.value ?? e?.labels?.mul?.value ?? null;

type WikidataEntity = { claims?: Record<string, WikidataClaim[]>; labels?: { en?: { value: string }; mul?: { value: string } }; redirects?: { from: string; to: string } };

async function wikidataEntities(ids: string[], props: string, signal?: AbortSignal): Promise<Record<string, WikidataEntity>> {
  const params = new URLSearchParams({ action: "wbgetentities", format: "json", origin: "*", ids: ids.join("|"), props, languages: "en|mul" });
  const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal });
  if (!res.ok) return {};
  // Merged items come back keyed by their new id (with `redirects.from` holding the one we asked
  // for), so index them under both — otherwise lookups by the requested id silently miss them.
  const entities = ((await res.json())?.entities ?? {}) as Record<string, WikidataEntity>;
  for (const e of Object.values(entities)) if (e.redirects?.from) entities[e.redirects.from] = e;
  return entities;
}

// Who made it (author / director / creator…) and the year, from the page's Wikidata item. For each,
// the first property on the type's list that has values wins; the earliest year is used, since
// films list a release date per country.
async function fetchWikiDetails(wikidataId: string, typeName: string, signal?: AbortSignal): Promise<MatchDetails> {
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
    const names = ids.map(id => labelOf(people[id])).filter((n): n is string => !!n);
    if (names.length) { creator = names.length > 2 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names.join(" & "); break; }
  }

  // Games: the platforms it was released on (P400), for the platform dropdown.
  let platforms: string[] | undefined;
  if (typeExtra(typeName) === "platform") {
    const ids = values("P400").map(v => v!.id).filter((id): id is string => !!id).slice(0, 40);
    const labels = ids.length ? await wikidataEntities(ids, "labels", signal) : {};
    platforms = [...new Set(ids.map(id => labelOf(labels[id])).filter((n): n is string => !!n).map(normalizePlatform))];
  }

  return { creator, year, platforms };
}
