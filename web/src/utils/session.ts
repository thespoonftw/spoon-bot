const KEY = "snek_session";
const MAX_AGE = 365 * 24 * 60 * 60;

export function getSession(): string | null {
  const match = document.cookie.match(/(?:^|; )snek_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setSession(token: string): void {
  document.cookie = `${KEY}=${encodeURIComponent(token)}; Max-Age=${MAX_AGE}; path=/; SameSite=Lax; Secure`;
}

export function clearSession(): void {
  document.cookie = `${KEY}=; Max-Age=0; path=/`;
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getSession()}` };
}

export function authJsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders() };
}
