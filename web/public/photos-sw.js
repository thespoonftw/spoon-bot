// Service worker for the installed brunchPhotos app (scope /photos).
// It deliberately caches nothing: every launch loads the live site, so each deploy reaches phones
// straight away. Its only job is a friendly page when there's no connection, instead of the
// browser's own error screen. Uploads and other requests pass straight through.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>brunchPhotos</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center;
         background: #1e1e2e; color: #cdd6f4; font-family: system-ui, -apple-system, sans-serif; padding: 24px; box-sizing: border-box; }
  h1 { color: #cba6f7; font-weight: 700; margin: 0 0 8px; }
  p { color: #a6adc8; margin: 0 0 24px; }
  button { background: #cba6f7; color: #1e1e2e; border: 0; border-radius: 999px; padding: 12px 24px; font: 600 1rem system-ui, sans-serif; }
</style></head>
<body><div><h1>You're offline</h1><p>brunchPhotos needs a connection. Check your signal and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
