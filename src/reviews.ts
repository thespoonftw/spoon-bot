import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sanitizeHtml from "sanitize-html";
import { EmbedBuilder, type Client, type Message } from "discord.js";
import { config } from "./config";
import { PHOTO_STORAGE_PATH } from "./photoStorage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as (input: Buffer) => {
  png(): { toBuffer(): Promise<Buffer> };
  rotate(): { resize(w: number, h: number, opts: object): { jpeg(opts: object): { toFile(p: string): Promise<unknown> } } };
};
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbListReviews, dbListMatchingReviews, dbGetReview, dbCreateReview, dbUpdateReview, dbDeleteReview, dbGetReviewPost, dbSetReviewPost, dbGetUserById, dbUpsertUser, dbListReviewTypes, dbGetReviewType, dbCreateReviewType, dbSetReviewTypeColor, type ReviewInput, type ReviewRow } from "./db";

const PROGRESS = new Set(["ongoing", "stopped", "finished"]);
// Types done in one sitting, which don't ask for progress. Keep in sync with web/src/reviews/api.ts.
const NO_PROGRESS_TYPES = new Set(["film", "board game", "podcast", "album", "stage show", "drink"]);
// Types that don't ask for a year (a podcast runs for years; a stage show is a production, not a
// release; a drink isn't tied to one). Keep in sync with web/src/reviews/api.ts.
const NO_YEAR_TYPES = new Set(["podcast", "stage show", "drink"]);
const MAX_BODY_BYTES = 200 * 1024;
const SUMMARY_MAX = 250; // Keep in sync with the editor (web/src/reviews/ReviewEditor.vue).
const getBaseUrl = () => process.env.ALBUM_BASE_URL ?? "http://localhost:3000";

// Photos people upload as a review's cover. They sit with the album photos (so they're backed up
// with them) and are served without a login, as Discord fetches them for the post's thumbnail.
// Reviews store them as a site path, e.g. "/review-images/<32 hex>.jpg".
const REVIEW_IMAGES_DIR = path.join(PHOTO_STORAGE_PATH, "review-images");
const REVIEW_IMAGE_PATH = /^\/review-images\/([0-9a-f]{32}\.jpg)$/;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Uploaded covers are site paths; Discord needs the full address.
const absoluteImageUrl = (url: string) => url.startsWith("/") ? `${getBaseUrl()}${url}` : url;

let reviewsDiscordClient: Client | null = null;
export function setReviewsDiscordClient(client: Client) {
  reviewsDiscordClient = client;
  if (config.reviewsChannelId) getStarEmojis(client);
}

// Embed text can't be coloured, so the stars are two of the bot's own (application) emoji: a gold
// filled star and a grey empty one. They're created on first use and found by name after that;
// if that fails the post falls back to plain ★/☆.
const STAR_SVG = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24"><path fill="${fill}" d="M12 1.5l3.1 6.9 7.4.7-5.6 5 1.7 7.4L12 17.6l-6.6 3.9 1.7-7.4-5.6-5 7.4-.7z"/></svg>`;
let starEmojis: Promise<{ full: string; empty: string } | null> | null = null;
function getStarEmojis(client: Client): Promise<{ full: string; empty: string } | null> {
  starEmojis ??= (async () => {
    const app = client.application;
    if (!app) return null;
    const existing = await app.emojis.fetch();
    const ensure = async (name: string, fill: string) => {
      const found = existing.find(e => e.name === name);
      if (found) return found.toString();
      const png = await sharp(Buffer.from(STAR_SVG(fill))).png().toBuffer();
      return (await app.emojis.create({ attachment: png, name })).toString();
    };
    return { full: await ensure("review_star", "#f5b301"), empty: await ensure("review_star_empty", "#80848e") };
  })().catch(e => { console.error("Failed to set up review star emoji:", e); starEmojis = null; return null; });
  return starEmojis;
}

// The reviewer as they appear on the Discord server (nickname and server avatar), falling back to
// their site name and avatar for guests or anyone who's left.
async function reviewAuthor(client: Client, r: ReviewRow): Promise<{ name: string; iconURL?: string }> {
  const fallback = { name: r.authorName, iconURL: r.authorAvatarUrl || undefined };
  const discordId = dbGetUserById(r.userId)?.discordId;
  if (!discordId) return fallback;
  try {
    const member = await client.guilds.cache.get(config.guildId)?.members.fetch(discordId);
    return member ? { name: member.displayName, iconURL: member.displayAvatarURL({ extension: "png", size: 128 }) } : fallback;
  } catch { return fallback; }
}

// A review's Discord card, mirroring the feed card: a header of the reviewer's avatar and
// "Name reviewed a 🎬 Film" (the header is plain text, so no mention or markdown), then the linked
// title, credit line, stars and summary, with the cover beside.
async function buildReviewEmbed(client: Client, r: ReviewRow): Promise<EmbedBuilder> {
  const [emoji, author] = await Promise.all([getStarEmojis(client), reviewAuthor(client, r)]);
  const stars = emoji ? emoji.full.repeat(r.rating) + emoji.empty.repeat(5 - r.rating) : "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
  const article = /^[aeiou]/i.test(r.typeName) ? "an" : "a";
  // Only albums and books name who made it: an album in the title ("OK Computer (1997) by
  // Radiohead"), a book's author on the line under it, as on the site.
  const type = r.typeName.toLowerCase();
  const heading = `${r.title}${r.year ? ` (${r.year})` : ""}${type === "album" && r.creator ? ` by ${r.creator}` : ""}`.slice(0, 200);
  const extra = [type === "book" ? r.creator : null, r.season != null ? `Season ${r.season}` : null, r.platform, r.location ? `at ${r.locationUrl ? `[${r.location.replace(/[[\]]/g, "")}](${r.locationUrl})` : r.location}` : null].filter(Boolean).join(" · ");
  // A blank line keeps the summary apart from the stars.
  const top = [extra || null, stars].filter(Boolean).join("\n");
  const embed = new EmbedBuilder()
    .setColor(r.typeColor as `#${string}`)
    .setAuthor({
      name: `${author.name} reviewed ${article} ${r.typeIcon} ${r.typeName}`.slice(0, 256),
      iconURL: author.iconURL,
      url: `${getBaseUrl()}/reviews/people/${encodeURIComponent(r.userId)}`,
    })
    .setTitle(heading)
    .setURL(`${getBaseUrl()}/reviews/${r.id}`)
    .setDescription((r.summary ? `${top}\n\n${r.summary}` : top).slice(0, 4096));
  if (r.imageUrl) embed.setThumbnail(absoluteImageUrl(r.imageUrl));
  return embed;
}

// Posts a new review. Types with their own channel (e.g. board games) go there instead of the
// general reviews channel. The post is remembered so later edits can update it. Best-effort — a
// failure never affects the save.
async function announceReview(r: ReviewRow): Promise<void> {
  const client = reviewsDiscordClient;
  const channelId = config.reviewTypeChannels[r.typeName.toLowerCase()] ?? config.reviewsChannelId;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) return;
  const message = await channel.send({ embeds: [await buildReviewEmbed(client, r)] });
  dbSetReviewPost(r.id, channelId, message.id);
}

// Finds a review's Discord post: the remembered one, or for reviews announced before posts were
// remembered, the bot's recent message in the channel their type posts to that links to the review.
// Null if it can't be found (deleted, too old, or the bot can't read the channel's history).
async function findReviewPost(client: Client, r: ReviewRow, saved: { channelId: string; messageId: string } | undefined): Promise<Message | null> {
  const channelId = saved?.channelId ?? config.reviewTypeChannels[r.typeName.toLowerCase()] ?? config.reviewsChannelId;
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) return null;
  if (saved) return channel.messages.fetch(saved.messageId).catch(() => null);
  const reviewUrl = `${getBaseUrl()}/reviews/${r.id}`;
  const recent = await channel.messages.fetch({ limit: 100 });
  return recent.find(m => m.author.id === client.user?.id && m.embeds[0]?.url === reviewUrl) ?? null;
}

// Brings a review's Discord post up to date after an edit, in whichever channel it was posted.
async function updateReviewPost(r: ReviewRow): Promise<void> {
  const client = reviewsDiscordClient;
  if (!client) return;
  const saved = dbGetReviewPost(r.id);
  const message = await findReviewPost(client, r, saved);
  if (message && !saved) dbSetReviewPost(r.id, message.channelId, message.id);
  // Clearing the text too tidies up posts from when the "@User reviewed…" line sat above the card.
  if (message?.editable) await message.edit({ content: "", embeds: [await buildReviewEmbed(client, r)] });
}

// Removes a deleted review's Discord post. `saved` is read before the review is deleted.
async function deleteReviewPost(r: ReviewRow, saved: { channelId: string; messageId: string } | undefined): Promise<void> {
  const client = reviewsDiscordClient;
  if (!client) return;
  const message = await findReviewPost(client, r, saved);
  if (message?.deletable) await message.delete();
}

// Board games are matched by pasting a BoardGameGeek link. BGG's official API needs a registered
// token, but the endpoint behind its own game pages answers without one (and without CORS, hence
// this proxy). It's undocumented, so it may change or close.
function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

const BGG_GAME_URL =/^https:\/\/boardgamegeek\.com\/(boardgame|boardgameexpansion)\/\d+\/[^\s"'<>/?]+$/;
type BggItem = { name?: string; yearpublished?: string; canonical_link?: string; images?: { previewthumb?: string } };

async function fetchBggGame(id: string): Promise<{ name: string; year: number | null; imageUrl: string | null; url: string | null } | null> {
  const res = await fetch(`https://api.geekdo.com/api/geekitems?objectid=${id}&objecttype=thing`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BGG responded ${res.status}`);
  const item = ((await res.json()) as { item?: BggItem } | null)?.item;
  if (!item?.name) return null;
  const year = Number(item.yearpublished);
  const image = item.images?.previewthumb ?? null;
  return {
    name: item.name,
    year: Number.isInteger(year) && year > 0 ? year : null,
    imageUrl: image && /^https:\/\/cf\.geekdo-images\.com\//.test(image) ? image : null,
    url: item.canonical_link && BGG_GAME_URL.test(item.canonical_link) ? item.canonical_link : null,
  };
}

// The long review is rich text from a contenteditable editor, rendered with v-html — so it is
// sanitised here on write against a small allowlist matching the editor's toolbar.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "div"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    div: "p",
  },
};

// Saves an uploaded photo as a review cover: turned upright, shrunk to at most 1200px and re-encoded
// as JPEG (which also strips its location data). Returns its site path.
function saveReviewImage(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // An oversized upload is read to the end but not kept, so the "too big" reply still gets through.
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_IMAGE_BYTES) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", async () => {
      if (size > MAX_IMAGE_BYTES) { reject(new Error("too large")); return; }
      try {
        if (!fs.existsSync(PHOTO_STORAGE_PATH)) throw new Error(`Storage root missing: ${PHOTO_STORAGE_PATH}`);
        fs.mkdirSync(REVIEW_IMAGES_DIR, { recursive: true });
        const name = `${crypto.randomBytes(16).toString("hex")}.jpg`;
        await sharp(Buffer.concat(chunks)).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(REVIEW_IMAGES_DIR, name));
        resolve(`/review-images/${name}`);
      } catch (e) { reject(e); }
    });
  });
}

// A bad request body is the client's fault (400); anything else is a bug on our side, so it's logged.
function sendBodyOrSaveError(res: http.ServerResponse, e: unknown): void {
  if (res.headersSent) return;
  if (e instanceof SyntaxError || (e as Error)?.message === "Body too large") { sendJson(res, 400, { error: "Invalid body" }); return; }
  console.error("Review request failed:", e);
  sendJson(res, 500, { error: "Something went wrong saving that — try again" });
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("Body too large")); req.destroy(); return; }
      body += chunk;
    });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// Returns the cleaned review, or an error message describing the first invalid field.
function parseReviewInput(raw: unknown): ReviewInput | string {
  if (!raw || typeof raw !== "object") return "Invalid body";
  const b = raw as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 200) return "Title is required (max 200 characters)";
  const typeId = Number(b.typeId);
  const type = Number.isInteger(typeId) ? dbGetReviewType(typeId) : undefined;
  if (!type) return "Pick a type";
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) return "Rating must be 0–5 stars";
  // Some types don't ask for progress, so they're always saved as finished.
  const progress = NO_PROGRESS_TYPES.has(type.name.toLowerCase()) ? "finished" : String(b.progress ?? "");
  if (!PROGRESS.has(progress)) return "Progress must be ongoing, stopped or finished";
  // Rejected rather than cut short, so an older, longer summary isn't chopped mid-sentence on edit.
  const summary = typeof b.summary === "string" ? b.summary.trim() : "";
  if (summary.length > SUMMARY_MAX) return `Keep the summary to ${SUMMARY_MAX} characters`;
  const cleanedBody = typeof b.bodyHtml === "string" ? sanitizeHtml(b.bodyHtml, SANITIZE_OPTS).trim() : "";
  const bodyHasText = sanitizeHtml(cleanedBody, { allowedTags: [], allowedAttributes: {} }).trim().length > 0;
  // The cover is hotlinked: usually from where the lookups point, but any https:// image link can be
  // pasted in. Or it's a photo uploaded here.
  const imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim() : null;
  if (imageUrl && !REVIEW_IMAGE_PATH.test(imageUrl) && (imageUrl.length > 2000 || !/^https:\/\/[^\s"'<>]+$/.test(imageUrl) || !isValidUrl(imageUrl))) return "Image link must be an https:// address";
  // The page the review was matched to: a Wikipedia article, Open Library work, TVmaze show, Apple
  // podcast, Apple Music album or BoardGameGeek game.
  const sourceUrl = typeof b.sourceUrl === "string" && (
    BGG_GAME_URL.test(b.sourceUrl) ||
    /^https:\/\/en\.wikipedia\.org\/wiki\/[^\s"'<>]+$/.test(b.sourceUrl) ||
    /^https:\/\/openlibrary\.org\/works\/OL\d+W$/.test(b.sourceUrl) ||
    /^https:\/\/www\.tvmaze\.com\/shows\/\d+\/[a-z0-9-]+$/.test(b.sourceUrl) ||
    /^https:\/\/podcasts\.apple\.com\/[a-z]{2}\/podcast\/[^\s"'<>/?]+\/id\d+$/.test(b.sourceUrl) ||
    /^https:\/\/music\.apple\.com\/[a-z]{2}\/album\/[^\s"'<>/?]+\/\d+$/.test(b.sourceUrl)
  ) ? b.sourceUrl : null;
  const wikiTitle = typeof b.wikiTitle === "string" && b.wikiTitle.trim() ? b.wikiTitle.trim().slice(0, 300) : null;
  const creator = typeof b.creator === "string" && b.creator.trim() ? b.creator.trim().slice(0, 200) : null;
  const rawYear = b.year === null || b.year === undefined || b.year === "" || NO_YEAR_TYPES.has(type.name.toLowerCase()) ? null : Number(b.year);
  if (rawYear !== null && (!Number.isInteger(rawYear) || rawYear < 0 || rawYear > 3000)) return "Year must be a whole number";
  // Season (series), platform (video games) and location (drinks) are optional extras; null means "not specified".
  const season = b.season === null || b.season === undefined || b.season === "" ? null : Number(b.season);
  if (season !== null && (!Number.isInteger(season) || season < 0 || season > 500)) return "Season must be a whole number";
  const platform = typeof b.platform === "string" && b.platform.trim() ? b.platform.trim().slice(0, 60) : null;
  const location = typeof b.location === "string" && b.location.trim() ? b.location.trim().slice(0, 100) : null;
  // A place picked from the location search links to its OpenStreetMap page.
  const locationUrl = location && typeof b.locationUrl === "string" && /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(b.locationUrl) ? b.locationUrl : null;
  return { title, typeId, rating, progress, summary: summary || null, bodyHtml: bodyHasText ? cleanedBody : null, imageUrl, wikiTitle, creator, year: rawYear, sourceUrl, season, platform, location, locationUrl };
}

// Only the author can edit a review; admins can also delete one (to take something down).
function canDelete(userId: string, reviewUserId: string): boolean {
  return userId === reviewUserId || (dbGetUserById(userId)?.level ?? 0) >= 2;
}

// Returns the cleaned type, or an error message.
function parseTypeInput(raw: unknown): { name: string; icon: string } | string {
  if (!raw || typeof raw !== "object") return "Invalid body";
  const b = raw as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40) return "Type name is required (max 40 characters)";
  // Icon is meant to be an emoji; count code points so multi-unit emoji aren't rejected.
  const icon = typeof b.icon === "string" ? b.icon.trim() : "";
  if ([...icon].length > 8) return "Icon should be a single emoji";
  return { name: name[0].toUpperCase() + name.slice(1), icon: icon || "🏷️" };
}

export function handleReviewRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  // GET /review-images/:name — an uploaded cover. Public (Discord fetches it); the random name is the
  // only way to find one, and a given name never changes, so it can be cached for good.
  if (url.startsWith("/review-images/")) {
    const name = url.match(REVIEW_IMAGE_PATH)?.[1];
    const filePath = name ? path.join(REVIEW_IMAGES_DIR, name) : "";
    if (method !== "GET" || !name || !fs.existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return true; }
    const stream = fs.createReadStream(filePath);
    stream.on("error", e => { console.error("[review-images] read failed for", filePath, e); if (!res.headersSent) { res.writeHead(500); res.end(); } else res.destroy(); });
    stream.once("open", () => { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" }); stream.pipe(res); });
    return true;
  }

  if (!url.startsWith("/api/reviews") && !url.startsWith("/api/review-types")) return false;
  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) { send401(res); return true; }

  // GET /api/review-types — all types with how many reviews use each
  if (url === "/api/review-types" && method === "GET") {
    sendJson(res, 200, dbListReviewTypes());
    return true;
  }

  // POST /api/review-types — add a type (returns the existing one if the name is taken). Types are
  // managed by admins; there's no UI for this, it's for admin use via the API.
  if (url === "/api/review-types" && method === "POST") {
    if ((dbGetUserById(user.userId)?.level ?? 0) < 2) { sendJson(res, 403, { error: "Only admins can add types" }); return true; }
    readJsonBody(req).then(raw => {
      const input = parseTypeInput(raw);
      if (typeof input === "string") { sendJson(res, 400, { error: input }); return; }
      const { type, created } = dbCreateReviewType(input.name, input.icon, user.userId);
      sendJson(res, created ? 201 : 200, type);
    }).catch(e => sendBodyOrSaveError(res, e));
    return true;
  }
  if (url === "/api/review-types") { sendJson(res, 405, { error: "Method not allowed" }); return true; }

  // PATCH /api/review-types/:id — admins set a type's colour ({ color: "#rrggbb" })
  const typeMatch = url.match(/^\/api\/review-types\/(\d+)$/);
  if (typeMatch && method === "PATCH") {
    if ((dbGetUserById(user.userId)?.level ?? 0) < 2) { sendJson(res, 403, { error: "Only admins can change types" }); return true; }
    readJsonBody(req).then(raw => {
      const color = raw && typeof raw === "object" ? (raw as Record<string, unknown>).color : undefined;
      if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) { sendJson(res, 400, { error: "Colour must be a hex code like #a33b5e" }); return; }
      const id = Number(typeMatch[1]);
      if (!dbSetReviewTypeColor(id, color.toLowerCase())) { sendJson(res, 404, { error: "No such type" }); return; }
      sendJson(res, 200, dbGetReviewType(id));
    }).catch(e => sendBodyOrSaveError(res, e));
    return true;
  }
  if (url.startsWith("/api/review-types/")) { sendJson(res, typeMatch ? 405 : 404, { error: typeMatch ? "Method not allowed" : "Not found" }); return true; }

  // GET /api/reviews?typeId=&userId=&limit=&offset= — newest first, across all users
  if (url === "/api/reviews" && method === "GET") {
    const params = new URL(req.url ?? "", "http://localhost").searchParams;
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "30") || 30));
    const offset = Math.max(0, parseInt(params.get("offset") ?? "0") || 0);
    sendJson(res, 200, dbListReviews({
      typeId: parseInt(params.get("typeId") ?? "") || undefined,
      userId: params.get("userId") || undefined,
      limit, offset,
    }));
    return true;
  }

  // POST /api/reviews — create
  if (url === "/api/reviews" && method === "POST") {
    readJsonBody(req).then(raw => {
      const input = parseReviewInput(raw);
      if (typeof input === "string") { sendJson(res, 400, { error: input }); return; }
      dbUpsertUser(user.userId, user.displayName, user.avatarUrl || undefined);
      const review = dbCreateReview(user.userId, input);
      sendJson(res, 201, review);
      // The editor's "Post to Discord" box; only an explicit false skips the post.
      if ((raw as { postToDiscord?: unknown }).postToDiscord !== false) announceReview(review).catch(e => console.error("Failed to announce review:", e));
    }).catch(e => sendBodyOrSaveError(res, e));
    return true;
  }

  // POST /api/reviews/image — upload a cover photo (the raw image is the body); returns its { url }
  if (url === "/api/reviews/image" && method === "POST") {
    if (!(req.headers["content-type"] ?? "").startsWith("image/")) { sendJson(res, 400, { error: "That isn't an image" }); return true; }
    saveReviewImage(req)
      .then(imageUrl => sendJson(res, 201, { url: imageUrl }))
      .catch(e => {
        if (res.headersSent) return;
        if ((e as Error).message === "too large") { sendJson(res, 413, { error: "That photo is too big (25MB max)" }); return; }
        console.error("Review image upload failed:", e);
        sendJson(res, 400, { error: "Couldn't use that photo — try a JPEG or PNG" });
      });
    return true;
  }

  // GET /api/reviews/user/:userId — a person's profile: who they are plus every review they've written
  const userMatch = url.match(/^\/api\/reviews\/user\/([^/]+)$/);
  if (userMatch && method === "GET") {
    const profileUser = dbGetUserById(decodeURIComponent(userMatch[1]));
    if (!profileUser) { sendJson(res, 404, { error: "Not found" }); return true; }
    const { reviews } = dbListReviews({ userId: profileUser.userId, limit: -1, offset: 0 });
    sendJson(res, 200, {
      user: { userId: profileUser.userId, displayName: profileUser.displayName, firstName: profileUser.firstName ?? null, avatarUrl: profileUser.avatarUrl ?? null },
      // The tables only need the headline fields; the full review text stays on the review page.
      reviews: reviews.map(({ bodyHtml: _body, ...r }) => r),
    });
    return true;
  }

  // GET /api/reviews/bgg/:id — a board game's name, year and box art from BoardGameGeek
  const bggMatch = url.match(/^\/api\/reviews\/bgg\/(\d{1,9})$/);
  if (bggMatch && method === "GET") {
    fetchBggGame(bggMatch[1])
      .then(game => game ? sendJson(res, 200, game) : sendJson(res, 404, { error: "Not found" }))
      .catch(e => { console.error("BGG lookup failed:", e); if (!res.headersSent) sendJson(res, 502, { error: "Couldn't reach BoardGameGeek" }); });
    return true;
  }

  const idMatch = url.match(/^\/api\/reviews\/(\d+)$/);
  if (!idMatch) { sendJson(res, 404, { error: "Not found" }); return true; }
  const id = parseInt(idMatch[1]);
  const existing = dbGetReview(id);
  if (!existing) { sendJson(res, 404, { error: "Not found" }); return true; }

  if (method === "GET") {
    // Other reviews of the same thing, for the bottom of the page (headline fields only).
    const others = dbListMatchingReviews(existing).map(({ bodyHtml: _body, ...r }) => r);
    // The viewer's own review of it, if they have one (so the page links to it instead of offering a new one).
    const myReviewId = existing.userId === user.userId ? existing.id : others.find(o => o.userId === user.userId)?.id ?? null;
    sendJson(res, 200, { ...existing, canEdit: user.userId === existing.userId, canDelete: canDelete(user.userId, existing.userId), others, myReviewId });
    return true;
  }

  if (method === "PUT") {
    if (user.userId !== existing.userId) { sendJson(res, 403, { error: "You can only edit your own reviews" }); return true; }
    readJsonBody(req).then(raw => {
      const input = parseReviewInput(raw);
      if (typeof input === "string") { sendJson(res, 400, { error: input }); return; }
      const review = dbUpdateReview(id, input);
      sendJson(res, 200, review);
      if (review) updateReviewPost(review).catch(e => console.error("Failed to update review post:", e));
    }).catch(e => sendBodyOrSaveError(res, e));
    return true;
  }

  if (method === "DELETE") {
    if (!canDelete(user.userId, existing.userId)) { sendJson(res, 403, { error: "You can only delete your own reviews" }); return true; }
    const post = dbGetReviewPost(id);
    dbDeleteReview(id);
    sendJson(res, 200, { ok: true });
    deleteReviewPost(existing, post).catch(e => console.error("Failed to delete review post:", e));
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}
