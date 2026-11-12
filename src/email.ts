const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM ?? "Spoon Photos <login@brunch-projects.co.uk>";

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local[0] + "*".repeat(Math.max(local.length - 1, 3));
  const domainParts = domain.split(".");
  const tld = domainParts.pop()!;
  const domainName = domainParts.join(".");
  const maskedDomain = domainName ? domainName[0] + "*".repeat(Math.max(domainName.length - 1, 3)) : "*".repeat(3);
  return `${maskedLocal}@${maskedDomain}.${tld}`;
}

export async function sendMagicLinkEmail(to: string, link: string, siteName = "Spoon Photos", code?: string): Promise<void> {
  // A code (for the installed iPhone app) is sent instead of the link, not as well as it.
  const subject = code ? `Your ${siteName} login code: ${code}` : `Your ${siteName} login link`;
  const html = code
    ? `<p>Your ${siteName} login code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;font-family:monospace">${code}</p><p>Type it into the app. It expires in 15 minutes.</p>`
    : `<p>Click the link below to log in to the ${siteName} site:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`;
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
}
