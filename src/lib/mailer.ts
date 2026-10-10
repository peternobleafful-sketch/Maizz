import type { Env } from "./config";
import { ConfigError } from "./config";
import type { Mailer } from "./staff";

// Sends plain emails through Resend. The key is read from settings and never logged.
export function createResendMailer(opts: { apiKey: string; from: string; fetchFn?: typeof fetch }): Mailer {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    async send(mail) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Email was refused (${res.status})`);
    },
  };
}

export function requireMailer(env: Env): Mailer {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIZZ_FROM_EMAIL?.trim();
  if (!apiKey) throw new ConfigError("RESEND_API_KEY is not set.");
  if (!from) throw new ConfigError("MAIZZ_FROM_EMAIL is not set.");
  return createResendMailer({ apiKey, from });
}
