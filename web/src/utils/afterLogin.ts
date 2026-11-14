// Where to go once signed in: the page someone was sent to before being asked to log in.
// Kept in localStorage so it survives the magic link opening in a new tab.
const KEY = "snek_after_login";

export function rememberReturnPath(path: string): void {
  try { localStorage.setItem(KEY, path); } catch { /* storage blocked: they land on the home page */ }
}

// The remembered page if it belongs to the section being signed into (base "" or "/photos"), else the home page.
export function takeReturnPath(base: string): string {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ }
  const home = base || "/";
  if (!saved || !saved.startsWith("/") || saved.startsWith("//")) return home;
  return sectionOf(saved) === base ? saved : home;
}

function sectionOf(path: string): string {
  for (const s of ["/photos", "/reviews"]) if (path === s || /^[/?#]/.test(path.slice(s.length)) && path.startsWith(s)) return s;
  return "";
}
