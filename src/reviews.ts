import http from "http";
import sanitizeHtml from "sanitize-html";
import { getSessionUser, getTokenFromRequest, sendJson, send401 } from "./auth";
import { dbListReviews, dbGetReview, dbCreateReview, dbUpdateReview, dbDeleteReview, dbGetUserById, dbUpsertUser, dbListReviewTypes, dbGetReviewType, dbCreateReviewType, type ReviewInput } from "./db";

const PROGRESS = new Set(["ongoing", "stopped", "finished"]);
const MAX_BODY_BYTES = 200 * 1024;

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
  if (!Number.isInteger(typeId) || !dbGetReviewType(typeId)) return "Pick a type";
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) return "Rating must be 0–5 stars";
  const progress = String(b.progress ?? "");
  if (!PROGRESS.has(progress)) return "Progress must be ongoing, stopped or finished";
  const summary = typeof b.summary === "string" ? b.summary.trim().slice(0, 1000) : "";
  const cleanedBody = typeof b.bodyHtml === "string" ? sanitizeHtml(b.bodyHtml, SANITIZE_OPTS).trim() : "";
  const bodyHasText = sanitizeHtml(cleanedBody, { allowedTags: [], allowedAttributes: {} }).trim().length > 0;
  // Images are only ever hotlinked from Wikimedia, which is where the Wikipedia lookup points.
  const imageUrl = typeof b.imageUrl === "string" && /^https:\/\/upload\.wikimedia\.org\/[^\s"'<>]+$/.test(b.imageUrl) ? b.imageUrl : null;
  const wikiTitle = typeof b.wikiTitle === "string" && b.wikiTitle.trim() ? b.wikiTitle.trim().slice(0, 300) : null;
  return { title, typeId, rating, progress, summary: summary || null, bodyHtml: bodyHasText ? cleanedBody : null, imageUrl, wikiTitle };
}

function canModify(userId: string, reviewUserId: string): boolean {
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
  if (!url.startsWith("/api/reviews") && url !== "/api/review-types") return false;
  const method = req.method ?? "GET";
  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) { send401(res); return true; }

  // GET /api/review-types — all types with how many reviews use each
  if (url === "/api/review-types" && method === "GET") {
    sendJson(res, 200, dbListReviewTypes());
    return true;
  }

  // POST /api/review-types — add a user-defined type (returns the existing one if the name is taken)
  if (url === "/api/review-types" && method === "POST") {
    readJsonBody(req).then(raw => {
      const input = parseTypeInput(raw);
      if (typeof input === "string") { sendJson(res, 400, { error: input }); return; }
      const { type, created } = dbCreateReviewType(input.name, input.icon, user.userId);
      sendJson(res, created ? 201 : 200, type);
    }).catch(() => { if (!res.headersSent) sendJson(res, 400, { error: "Invalid body" }); });
    return true;
  }
  if (url === "/api/review-types") { sendJson(res, 405, { error: "Method not allowed" }); return true; }

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
      sendJson(res, 201, dbCreateReview(user.userId, input));
    }).catch(() => { if (!res.headersSent) sendJson(res, 400, { error: "Invalid body" }); });
    return true;
  }

  const idMatch = url.match(/^\/api\/reviews\/(\d+)$/);
  if (!idMatch) { sendJson(res, 404, { error: "Not found" }); return true; }
  const id = parseInt(idMatch[1]);
  const existing = dbGetReview(id);
  if (!existing) { sendJson(res, 404, { error: "Not found" }); return true; }

  if (method === "GET") {
    sendJson(res, 200, { ...existing, canEdit: canModify(user.userId, existing.userId) });
    return true;
  }

  if (!canModify(user.userId, existing.userId)) { sendJson(res, 403, { error: "You can only change your own reviews" }); return true; }

  if (method === "PUT") {
    readJsonBody(req).then(raw => {
      const input = parseReviewInput(raw);
      if (typeof input === "string") { sendJson(res, 400, { error: input }); return; }
      sendJson(res, 200, dbUpdateReview(id, input));
    }).catch(() => { if (!res.headersSent) sendJson(res, 400, { error: "Invalid body" }); });
    return true;
  }

  if (method === "DELETE") {
    dbDeleteReview(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}
