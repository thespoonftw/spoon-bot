// Service worker for the installed Brunch Reviews app (scope /reviews).
// It deliberately caches nothing: every launch loads the live site, so each deploy reaches phones
// straight away. Its only job is a friendly page when there's no connection, instead of the
// browser's own error screen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brunch Reviews</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center;
         background: #f5f0e6; color: #1f1a17; font-family: Georgia, "Times New Roman", serif; padding: 24px; box-sizing: border-box; }
  h1 { font-weight: 600; margin: 0 0 8px; }
  p { color: #7a6f65; font-family: system-ui, -apple-system, sans-serif; margin: 0 0 24px; }
  button { background: #b4432b; color: #fff8f0; border: 0; border-radius: 999px; padding: 12px 24px; font: 600 1rem system-ui, sans-serif; }
</style></head>
<body><div><h1>You're offline</h1><p>Brunch Reviews needs a connection. Check your signal and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
