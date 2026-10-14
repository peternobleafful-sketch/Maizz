import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, cspMode, newNonce } from "@/lib/csp";

// Adds the Content-Security-Policy header to every page (not to /api or static files).
// The nonce is a fresh one-time value per request; Next.js puts it on its own scripts.
export function middleware(req: NextRequest) {
  const nonce = newNonce();
  const policy = buildCsp(nonce);
  const name = cspHeaderName(cspMode(process.env));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(name, policy);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(name, policy);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|brand/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
