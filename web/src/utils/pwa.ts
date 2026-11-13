import { ref, computed } from "vue";
import { themeColor as reviewsThemeColor } from "./reviewsTheme";

// The installable apps (PWAs). Each is a section of the site — Brunch Reviews is /reviews,
// brunchPhotos is /photos — with its own manifest, icons and service worker in web/public. The
// server adds the head tags to the pages it serves in each section, and syncAppHead keeps them right
// as the single-page app moves between sections.

export type AppId = "reviews" | "photos";

interface AppConfig {
  scope: string;
  title: string;        // tab title
  homeScreenName: string; // label under the iPhone home-screen icon
  assets: string;       // folder in web/public holding manifest + icons
  serviceWorker: string;
  themeColor: () => string;
}

export const APPS: Record<AppId, AppConfig> = {
  reviews: { scope: "/reviews", title: "Brunch Reviews", homeScreenName: "Reviews", assets: "/reviews-app", serviceWorker: "/reviews-sw.js", themeColor: reviewsThemeColor },
  photos: { scope: "/photos", title: "brunchPhotos", homeScreenName: "brunchPhotos", assets: "/photos-app", serviceWorker: "/photos-sw.js", themeColor: () => "#1e1e2e" },
};

/** Which app's section a path is in, if any. */
export function appForPath(path: string): AppId | null {
  for (const id of Object.keys(APPS) as AppId[]) {
    const { scope } = APPS[id];
    if (path === scope || path.startsWith(scope + "/")) return id;
  }
  return null;
}

// Chrome/Edge/Android hand over their install prompt once, for whichever app's page is showing.
// Keep it (and which app it was for) for that app's Get the app page.
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
const pendingPrompt = ref<{ app: AppId; event: InstallPromptEvent } | null>(null);

// Once installed, browsers stop offering the prompt, so the Get the app page would otherwise fall
// back to its manual instructions. Remember an install in this browser; Chrome can also be asked
// outright (getInstalledRelatedApps, via related_applications in the manifest), which also catches
// an uninstall.
const installedKey = (app: AppId) => `${app}AppInstalled`;
function readInstalled(app: AppId) { try { return localStorage.getItem(installedKey(app)) === "1"; } catch { return false; } }
const installedFlags = ref<Record<AppId, boolean>>({ reviews: readInstalled("reviews"), photos: readInstalled("photos") });
function setInstalled(app: AppId, value: boolean) {
  installedFlags.value[app] = value;
  try { value ? localStorage.setItem(installedKey(app), "1") : localStorage.removeItem(installedKey(app)); } catch { /* private mode */ }
}

export function listenForInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const app = appForPath(location.pathname);
    if (!app) return;
    pendingPrompt.value = { app, event: e as InstallPromptEvent };
    // Only offered when the app isn't installed (e.g. it was removed since).
    setInstalled(app, false);
  });
  window.addEventListener("appinstalled", () => {
    const app = pendingPrompt.value?.app ?? appForPath(location.pathname);
    pendingPrompt.value = null;
    if (app) setInstalled(app, true);
  });
}

/** Install state and actions for one app's Get the app page. */
export function useInstall(app: AppId) {
  const installPrompt = computed(() => (pendingPrompt.value?.app === app ? pendingPrompt.value.event : null));
  const installed = computed(() => installedFlags.value[app]);

  /** Asks the browser whether the app is installed. Only meaningful from a page inside the app's scope. */
  function checkInstalled() {
    const nav = navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> };
    nav.getInstalledRelatedApps?.().then((apps) => setInstalled(app, apps.length > 0)).catch(() => { /* unsupported here */ });
  }

  async function promptInstall() {
    const p = installPrompt.value;
    if (!p) return;
    await p.prompt();
    const { outcome } = await p.userChoice;
    pendingPrompt.value = null;
    if (outcome === "accepted") setInstalled(app, true);
  }

  return { installPrompt, installed, checkInstalled, promptInstall };
}

/** Running as an installed app rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// iPads report themselves as Macs; a touch screen gives them away.
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(navigator.userAgent);

function headTags(app: AppConfig): { selector: string; tag: string; attrs: Record<string, string> }[] {
  return [
    { selector: 'link[rel="manifest"]', tag: "link", attrs: { rel: "manifest", href: `${app.assets}/manifest.webmanifest` } },
    { selector: 'link[rel="apple-touch-icon"]', tag: "link", attrs: { rel: "apple-touch-icon", href: `${app.assets}/apple-touch-icon.png` } },
    { selector: 'meta[name="apple-mobile-web-app-title"]', tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: app.homeScreenName } },
    { selector: 'meta[name="mobile-web-app-capable"]', tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" } },
    { selector: 'meta[name="apple-mobile-web-app-capable"]', tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" } },
    { selector: 'meta[name="theme-color"]', tag: "meta", attrs: { name: "theme-color", content: app.themeColor() } },
  ];
}

/** Puts the given app's head tags on the page (replacing another app's), or removes them outside any app. */
export function syncAppHead(appId: AppId | null) {
  const tags = headTags(APPS[appId ?? "reviews"]);
  for (const { selector, tag, attrs } of tags) {
    const existing = document.head.querySelector(selector);
    if (appId && existing && Object.entries(attrs).every(([k, v]) => existing.getAttribute(k) === v)) continue;
    existing?.remove();
    if (!appId) continue;
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
  }
}

const registered = new Set<AppId>();
export function registerServiceWorker(appId: AppId) {
  if (registered.has(appId) || !("serviceWorker" in navigator)) return;
  registered.add(appId);
  const { serviceWorker, scope } = APPS[appId];
  navigator.serviceWorker.register(serviceWorker, { scope }).catch((e) => console.warn("Service worker failed to register:", e));
}
