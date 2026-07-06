// Auth is carried entirely by the HttpOnly `snek_session` cookie that the server sets at login
// (/api/auth/verify). The browser sends it automatically on same-origin requests, so JS never
// reads or writes the token — this avoids the previous drift between localStorage, a JS cookie,
// and the HttpOnly cookie, which caused valid sessions to still 401 on authenticated writes.

export function authHeaders(): Record<string, string> {
  return {};
}

export function authJsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}
