import { ref } from "vue";

// The installable Brunch Reviews app (a PWA scoped to /reviews). Its manifest, icons and service
// worker live in web/public; the server adds the head tags to /reviews pages it serves, and
// syncReviewsAppHead keeps them right as the single-page app moves in and out of the section.

// Chrome/Edge/Android hand over their install prompt once; keep it for the Get the app page's button.
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
export const installPrompt = ref<InstallPromptEvent | null>(null);

// Once installed, browsers stop offering the prompt, so the Get the app page would otherwise fall
// back to its manual instructions. Remember an install in this browser; Chrome can also be asked
// outright (getInstalledRelatedApps, via related_applications in the manifest), which also catches
// an uninstall.
const INSTALLED_KEY = "reviewsAppInstalled";
function readInstalledFlag() { try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; } }
function setInstalled(value: boolean) {
  installed.value = value;
  try { value ? localStorage.setItem(INSTALLED_KEY, "1") : localStorage.removeItem(INSTALLED_KEY); } catch { /* private mode */ }
}
export const installed = ref(readInstalledFlag());

export function listenForInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt.value = e as InstallPromptEvent;
    // Only offered when the app isn't installed (e.g. it was removed since).
    setInstalled(false);
  });
  window.addEventListener("appinstalled", () => {
    installPrompt.value = null;
    setInstalled(true);
  });
}

/** Asks the browser whether the app is installed. Only meaningful from a page inside /reviews (the app's scope). */
export function checkInstalled() {
  const nav = navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> };
  nav.getInstalledRelatedApps?.().then((apps) => setInstalled(apps.length > 0)).catch(() => { /* unsupported here */ });
}

export async function promptInstall() {
  const p = installPrompt.value;
  if (!p) return;
  await p.prompt();
  const { outcome } = await p.userChoice;
  installPrompt.value = null;
  if (outcome === "accepted") setInstalled(true);
}

/** Running as the installed app rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// iPads report themselves as Macs; a touch screen gives them away.
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(navigator.userAgent);

const HEAD_TAGS: { selector: string; tag: string; attrs: Record<string, string> }[] = [
  { selector: 'link[rel="manifest"]', tag: "link", attrs: { rel: "manifest", href: "/reviews-app/manifest.webmanifest" } },
  { selector: 'link[rel="apple-touch-icon"]', tag: "link", attrs: { rel: "apple-touch-icon", href: "/reviews-app/apple-touch-icon.png" } },
  { selector: 'meta[name="apple-mobile-web-app-title"]', tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: "Brunch Reviews" } },
  { selector: 'meta[name="mobile-web-app-capable"]', tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" } },
  { selector: 'meta[name="apple-mobile-web-app-capable"]', tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" } },
  { selector: 'meta[name="theme-color"]', tag: "meta", attrs: { name: "theme-color", content: "#f5f0e6" } },
];

/** Adds the app's head tags inside the reviews section and removes them elsewhere. */
export function syncReviewsAppHead(inReviews: boolean) {
  for (const { selector, tag, attrs } of HEAD_TAGS) {
    const existing = document.head.querySelector(selector);
    if (inReviews && !existing) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.appendChild(el);
    } else if (!inReviews && existing) {
      existing.remove();
    }
  }
}

let registered = false;
export function registerReviewsServiceWorker() {
  if (registered || !("serviceWorker" in navigator)) return;
  registered = true;
  navigator.serviceWorker.register("/reviews-sw.js", { scope: "/reviews" }).catch((e) => console.warn("Service worker failed to register:", e));
}
