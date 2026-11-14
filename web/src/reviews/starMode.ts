import { ref } from "vue";

// How you rate: a full star purist ("full": whole stars only, shown in orange), a half star
// flexitarian ("half") or a quarter star connoisseur ("quarter"). null until you've picked (the
// editor asks), undefined until loaded. Shared by the ⋮ menu and the editor. Your existing reviews
// switch over when you next edit them.
export type StarMode = "full" | "half" | "quarter";
export const STAR_MODES: { value: StarMode; label: string }[] = [
  { value: "full", label: "Full" }, { value: "half", label: "Half" }, { value: "quarter", label: "Quarter" },
];
// The smallest rating step each mode allows.
export const starStep = (mode: StarMode | null | undefined) => mode === "full" ? 1 : mode === "quarter" ? 0.25 : 0.5;
export const starMode = ref<StarMode | null | undefined>(undefined);

let loading: Promise<void> | null = null;
export function loadStarMode(): Promise<void> {
  loading ??= fetch("/api/reviews/star-mode")
    .then(res => res.ok ? res.json() : Promise.reject(new Error(`star mode: ${res.status}`)))
    .then((d: { mode: StarMode | null }) => { starMode.value = d.mode; })
    .catch(() => { loading = null; });
  return loading;
}

export async function setStarMode(mode: StarMode): Promise<void> {
  const previous = starMode.value;
  starMode.value = mode;
  const res = await fetch("/api/reviews/star-mode", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
  }).catch(() => null);
  if (!res?.ok) starMode.value = previous;
}
