import { ref, watch } from "vue";

export interface LoginUser { userId: string; displayName: string; firstName?: string; avatarUrl: string; canDiscord: boolean; canEmail: boolean }

// Name search behind the login pages (photos and reviews each have their own UI on top of this).
export function useLoginSearch() {
  const query = ref("");
  const results = ref<LoginUser[]>([]);
  const searching = ref(false);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  watch(query, (q) => {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = q.trim();
    if (!trimmed) { results.value = []; searching.value = false; return; }
    searching.value = true;
    searchTimer = setTimeout(async () => {
      try {
        results.value = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`).then(r => r.json());
      } finally {
        searching.value = false;
      }
    }, 250);
  });

  return { query, results, searching };
}

// Asks the server to DM/email a magic link. `site` decides where the link lands and how it's worded.
// withCode (an installed iPhone app) gets a 6-digit code to type in instead of a link.
export async function requestLoginLink(userId: string, method: "discord" | "email", site?: "reviews" | "photos", withCode = false): Promise<{ ok: boolean; maskedEmail?: string; requestId?: string }> {
  const res = await fetch("/api/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, method, site, withCode }),
  });
  if (!res.ok) return { ok: false };
  const data = await res.json().catch(() => ({}));
  return { ok: true, maskedEmail: data.maskedEmail, requestId: data.requestId };
}

// Exchanges a magic-link token for a session. The server sets the HttpOnly snek_session cookie on
// this response; JS stores nothing. The endpoint returns 200 with an { error } body for
// invalid/expired links, so success requires a sessionToken in the payload, not just res.ok.
export async function verifyLoginToken(token: string): Promise<boolean> {
  const res = await fetch(`/api/auth/verify/${token}`);
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  return !!data.sessionToken;
}

// Signs in with the 6-digit code from an app login message, on the device that asked for it.
export async function verifyLoginCode(requestId: string, code: string): Promise<"ok" | "wrong" | "expired"> {
  const res = await fetch("/api/auth/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, code }),
  });
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  if (data.sessionToken) return "ok";
  return data.error === "wrong" ? "wrong" : "expired";
}
