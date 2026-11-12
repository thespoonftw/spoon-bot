import { ref, watch } from "vue";

// Dark mode for the reviews section, chosen from the ⋮ menu. A per-device preference, so it lives
// in this browser's storage. reviews.css swaps the --rv-* palette when body has .rv-dark.
const KEY = "reviewsDarkMode";
const LIGHT_PAPER = "#f5f0e6";
const DARK_PAPER = "#1b1714";

function readStored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export const darkMode = ref(readStored());

/** The browser/status bar colour, matching the page background. */
export const themeColor = () => (darkMode.value ? DARK_PAPER : LIGHT_PAPER);

/** Applies the theme to the page (call while the reviews section is showing). */
export function applyReviewsTheme(on: boolean) {
  document.body.classList.toggle("rv-dark", on);
  document.head.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor());
}

/** Takes the theme off when leaving the reviews section. */
export function removeReviewsTheme() {
  document.body.classList.remove("rv-dark");
}

watch(darkMode, (on) => {
  try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* private mode */ }
  if (document.body.classList.contains("rv-body")) applyReviewsTheme(on);
});
