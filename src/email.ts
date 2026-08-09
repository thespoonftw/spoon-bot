const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM ?? "Spoon Photos <login@brunch-projects.co.uk>";

export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject: "Your Spoon Photos login link",
      html: `<p>Click the link below to log in to the Spoon Photos site:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
}
