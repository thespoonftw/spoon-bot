import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./state";
import { sendJson } from "./auth";

// Spoon's Counters (the Deadlock companion app, built in its own project): a download page
// at /counters, and the counters config its admin shares with everyone who uses it.
// The app's installers live on GitHub releases (thespoonftw/spoons-counters); only the
// small config is kept here. Anyone can read it; writing needs COUNTERS_ADMIN_KEY.

const CONFIG_FILE = path.join(DATA_DIR, "counters-config.json");
const MAX_BODY = 2 * 1024 * 1024;
const REPO = "thespoonftw/spoons-counters";
const INSTALLER = `https://github.com/${REPO}/releases/latest/download/SpoonsCounters-Setup.exe`;

function isAdmin(req: http.IncomingMessage): boolean {
  const expected = process.env.COUNTERS_ADMIN_KEY ?? "";
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function handleCountersRoutes(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  if (url === "/counters" || url === "/counters/") {
    if (method !== "GET" && method !== "HEAD") return false;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
    res.end(DOWNLOAD_PAGE);
    return true;
  }

  if (url === "/api/counters/config" && method === "GET") {
    if (!fs.existsSync(CONFIG_FILE)) { sendJson(res, 404, { error: "Nothing published yet" }, { "Cache-Control": "no-store" }); return true; }
    try {
      const body = fs.readFileSync(CONFIG_FILE, "utf8");
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(body);
    } catch (e) {
      console.error("[counters] read failed:", e);
      sendJson(res, 500, { error: "Read failed" });
    }
    return true;
  }

  // Lets the app check an admin password before saving it
  if (url === "/api/counters/config/admin" && method === "GET") {
    if (!isAdmin(req)) sendJson(res, 403, { error: "Wrong admin password" });
    else sendJson(res, 200, { ok: true });
    return true;
  }

  if (url === "/api/counters/config" && method === "PUT") {
    if (!isAdmin(req)) { sendJson(res, 403, { error: "Wrong admin password" }); return true; }
    readBody(req)
      .then(raw => {
        const config = (JSON.parse(raw) as { config?: unknown }).config;
        if (!config || typeof config !== "object" || Array.isArray(config) || !("tags" in config) || !("buildCounters" in config)) {
          sendJson(res, 400, { error: "Not a counters config" });
          return;
        }
        const updatedAt = Date.now();
        // Write then rename, so a reader never sees half a file
        const tmp = `${CONFIG_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ config, updatedAt }));
        fs.renameSync(tmp, CONFIG_FILE);
        console.log(`[counters] config published (${raw.length} bytes)`);
        sendJson(res, 200, { updatedAt });
      })
      .catch(e => {
        if (!res.headersSent) sendJson(res, e instanceof SyntaxError ? 400 : 413, { error: e instanceof SyntaxError ? "Invalid JSON" : "Too large" });
      });
    return true;
  }

  return false;
}

const DOWNLOAD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Spoon's Counters</title>
<meta name="description" content="Counter-item suggestions for Deadlock, live from your match." />
<style>
  :root { --bg:#12100d; --panel:#1f1b16; --line:#3a3228; --text:#ece4d6; --muted:#9b8f7d; --accent:#e8b04a; --ink:#1a1305; color-scheme:dark; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:16px/1.5 'Segoe UI',system-ui,-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; padding:24px 16px; }
  main { width:100%; max-width:560px; }
  .brand { display:flex; align-items:center; gap:12px; color:var(--accent); margin-bottom:8px; }
  h1 { margin:0; font-size:2rem; color:var(--text); letter-spacing:.02em; }
  .lede { color:var(--muted); margin:0 0 28px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; }
  .dl { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:14px 20px; border-radius:10px; background:var(--accent); color:var(--ink); font-weight:700; font-size:1.1rem; text-decoration:none; }
  .dl:hover { background:#f3c062; }
  .meta { text-align:center; color:var(--muted); font-size:.85rem; margin:10px 0 0; min-height:1.3em; }
  h2 { font-size:1rem; margin:24px 0 8px; }
  ol { margin:0; padding-left:20px; color:var(--muted); }
  li { margin:6px 0; }
  b { color:var(--text); font-weight:600; }
  footer { color:var(--muted); font-size:.8rem; text-align:center; margin-top:20px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><path d="M8 26 16 5l8 21-8-6z" fill="currentColor"/></svg>
    <h1>Spoon's Counters</h1>
  </div>
  <p class="lede">Counter-item suggestions for Deadlock, worked out live from the heroes and items in your match.</p>
  <div class="card">
    <a class="dl" href="${INSTALLER}">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 20h16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Download for Windows
    </a>
    <p class="meta" id="meta"></p>
    <h2>Installing</h2>
    <ol>
      <li>Run <b>SpoonsCounters-Setup.exe</b>. It installs and opens by itself.</li>
      <li>Windows may say <b>"Windows protected your PC"</b> because the app isn't signed. Click <b>More info</b>, then <b>Run anyway</b>.</li>
      <li>Follow the app's setup screen once. After that it opens on its own when you start Deadlock.</li>
    </ol>
    <h2>Updates</h2>
    <ol>
      <li>The app updates itself in the background, and the counters stay in sync with Spoon's.</li>
    </ol>
  </div>
  <footer>Windows only. Not affiliated with Valve.</footer>
</main>
<script>
  fetch("https://api.github.com/repos/${REPO}/releases/latest")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rel) {
      if (!rel) return;
      var asset = (rel.assets || []).find(function (a) { return /Setup\\.exe$/.test(a.name); });
      var size = asset ? " · " + Math.round(asset.size / 1048576) + " MB" : "";
      var date = new Date(rel.published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      document.getElementById("meta").textContent = "Version " + String(rel.tag_name).replace(/^v/, "") + " · " + date + size;
    })
    .catch(function () {});
</script>
</body>
</html>`;
