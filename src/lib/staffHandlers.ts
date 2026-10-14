import { after } from "next/server";
import { STAFF_LIMITS, type Area } from "./staff";
import { cookieHeader, cookieNameFor, getStaffService, readCookie } from "./staffRuntime";
import { publicBaseUrl } from "./config";
import { readJson, sameSite, setupProblem, sourceOf } from "./staffRoutes";

// The sign-in steps, once, for both doors: church staff (/api/staff/*) and the Maizz owner (/api/owner/*).
// Each door has its own people, sessions and cookie, so a church sign-in can never open the owner's pages.

const NOT_ALLOWED = () => Response.json({ error: "Not allowed" }, { status: 403 });
const BAD = () => Response.json({ error: "Bad request" }, { status: 400 });
const UNAVAILABLE = () => Response.json({ error: "unavailable", message: "Something went wrong. Try again in a minute." }, { status: 503 });

export function staffHandlers(area: Area) {
  const pathFor = area === "owner" ? "/owner" : "/church";
  return {
    /** Step one: email and password. Wrong email and wrong password look the same on purpose. */
    async signIn(req: Request): Promise<Response> {
      if (!sameSite(req)) return NOT_ALLOWED();
      const body = await readJson(req);
      if (!body) return BAD();
      let service;
      try {
        service = getStaffService(process.env, { area });
      } catch (err) {
        return setupProblem(err);
      }
      const r = await service.signIn(body.email, body.password, sourceOf(req));
      if (r.ok) return Response.json({ challenge: r.challenge });
      if (r.reason === "locked") {
        return Response.json({ error: "locked", message: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
      }
      if (r.reason === "unavailable") {
        return Response.json({ error: "unavailable", message: "We could not send your code. Try again in a minute." }, { status: 503 });
      }
      return Response.json({ error: "wrong", message: "That email or password is not right." }, { status: 401 });
    },

    /** Step two: the six-digit code from the email. */
    async code(req: Request): Promise<Response> {
      if (!sameSite(req)) return NOT_ALLOWED();
      const body = await readJson(req);
      if (!body) return BAD();
      let service;
      try {
        service = getStaffService(process.env, { needMail: false, area });
      } catch (err) {
        return setupProblem(err);
      }
      const r = await service.verifyCode(body.challenge, body.code, sourceOf(req));
      if (r.ok) {
        return Response.json(
          { ok: true },
          { headers: { "Set-Cookie": cookieHeader(r.sessionToken, STAFF_LIMITS.sessionHours * 3600, area), "Cache-Control": "no-store" } },
        );
      }
      if (r.reason === "locked") {
        return Response.json({ error: "locked", message: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
      }
      if (r.reason === "expired") {
        return Response.json({ error: "expired", message: "That code has expired. Go back and sign in again for a new one." }, { status: 410 });
      }
      if (r.reason === "unavailable") return UNAVAILABLE();
      return Response.json({ error: "wrong", message: "That code is not right. Check the email and try again." }, { status: 401 });
    },

    /** A new person chooses their password from the emailed invite link. */
    async invite(req: Request): Promise<Response> {
      return tokenAndPassword(req, area, "acceptInvite");
    },

    /** "Forgot password". The answer is always the same, whether or not the email has an account. */
    async resetRequest(req: Request): Promise<Response> {
      if (!sameSite(req)) return NOT_ALLOWED();
      const body = await readJson(req);
      if (!body) return BAD();
      // The answer goes back at once and the work (and the email) happens afterwards, so the time taken
      // never shows whether an email has an account.
      const source = sourceOf(req);
      const baseUrl = publicBaseUrl(process.env);
      after(async () => {
        try {
          // Without the public address no link can be made; the person is told nothing different either way.
          if (!baseUrl) throw new Error("MAIZZ_PUBLIC_URL is not set");
          await getStaffService(process.env, { area }).requestReset(body.email, baseUrl, source);
        } catch {
          // Nothing is said to the person either way.
        }
      });
      return Response.json({ ok: true });
    },

    async reset(req: Request): Promise<Response> {
      return tokenAndPassword(req, area, "resetPassword");
    },

    async signOut(req: Request): Promise<Response> {
      if (!sameSite(req)) return NOT_ALLOWED();
      try {
        await getStaffService(process.env, { needMail: false, area }).signOut(readCookie(req, cookieNameFor(area)));
      } catch {
        // The cookie is cleared either way.
      }
      return Response.json({ ok: true, next: `${pathFor}/sign-in` }, { headers: { "Set-Cookie": cookieHeader("", 0, area) } });
    },
  };
}

async function tokenAndPassword(req: Request, area: Area, method: "acceptInvite" | "resetPassword"): Promise<Response> {
  if (!sameSite(req)) return NOT_ALLOWED();
  const body = await readJson(req);
  if (!body || typeof body.token !== "string" || typeof body.password !== "string" || body.token.length > 100) return BAD();
  let service;
  try {
    service = getStaffService(process.env, { needMail: false, area });
  } catch (err) {
    return setupProblem(err);
  }
  try {
    const r = await service[method](body.token, body.password);
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ error: r.reason, message: r.message }, { status: r.reason === "weak" ? 400 : 410 });
  } catch {
    return UNAVAILABLE();
  }
}
