import type { IncomingMessage } from "http";

// Per-IP token-bucket rate limiter for anonymous (non-logged-in) browsing, to deter mass
// scraping of the public album/thumbnail endpoints without affecting logged-in users.
//
// Token bucket: each IP starts with CAPACITY tokens and spends 1 per request. Tokens refill at
// REFILL_PER_SEC. This allows a legitimate burst (a public album page loading many thumbnails at
// once) while capping the *sustained* rate — a scraper pulling thousands of images is throttled to
// REFILL_PER_SEC and becomes slow and obvious. Tune these two constants to taste.
const CAPACITY = 300;        // burst allowance per IP
const REFILL_PER_SEC = 2;    // sustained anonymous requests/sec once the burst is spent (=120/min)

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

/** Real client IP behind nginx (which sets X-Real-IP / X-Forwarded-For), falling back to the socket. */
export function getClientIp(req: IncomingMessage): string {
  const xri = req.headers["x-real-ip"];
  if (typeof xri === "string" && xri.trim()) return xri.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Spend one token for this IP. Returns 0 if allowed, or the Retry-After seconds if rate-limited. */
export function anonRateLimit(ip: string): number {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: CAPACITY, last: now }; buckets.set(ip, b); }
  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return 0; }
  return Math.max(1, Math.ceil((1 - b.tokens) / REFILL_PER_SEC));
}

// Drop fully-refilled, idle buckets so the map can't grow without bound. unref() so this timer
// never keeps the process alive on its own.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (b.tokens >= CAPACITY && now - b.last > 10 * 60 * 1000) buckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();
