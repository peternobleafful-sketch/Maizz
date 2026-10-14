// Content-Security-Policy: tells the browser which places a page may load scripts, styles, fonts and images from,
// and where it may send data. If someone ever slips a script into a page, the browser refuses to run it.
//
// It starts in "report only" mode: the browser still runs everything but tells /api/csp-report what it would have blocked.
// After a quiet week, set MAIZZ_CSP=enforce in Vercel to make it block for real.
// Fonts are served from our own site (Next.js downloads them when the site is built), so no outside font host is allowed.

export type CspMode = "report-only" | "enforce";

export function cspMode(env: Record<string, string | undefined>): CspMode {
  return env.MAIZZ_CSP?.trim().toLowerCase() === "enforce" ? "enforce" : "report-only";
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}
