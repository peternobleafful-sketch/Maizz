"use client";

import { useState } from "react";

type Step = "password" | "code";

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { message: "Could not reach Maizz. Check your connection and try again." } };
  }
}

export default function SignInForm({ area = "church" }: { area?: "church" | "owner" }) {
  const api = area === "owner" ? "/api/owner" : "/api/staff";
  const home = area === "owner" ? "/owner" : "/church";
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [method, setMethod] = useState<"email" | "app">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitPassword() {
    setBusy(true);
    setError("");
    const r = await post(`${api}/sign-in`, { email, password });
    setBusy(false);
    if (r.ok && typeof r.data.challenge === "string") {
      setChallenge(r.data.challenge);
      setMethod(r.data.method === "app" ? "app" : "email");
      setPassword("");
      setStep("code");
    } else setError(String(r.data.message ?? "Something went wrong. Try again."));
  }

  async function submitCode() {
    setBusy(true);
    setError("");
    const r = await post(`${api}/code`, { challenge, code });
    if (r.ok) {
      window.location.assign(home);
      return;
    }
    setBusy(false);
    setError(String(r.data.message ?? "Something went wrong. Try again."));
    if (r.data.error === "expired" || r.data.error === "locked") {
      setCode("");
      if (r.data.error === "expired") setStep("password");
    }
  }

  return (
    <div className="give-wrap">
      <main className="give">
        <header className="give-hero">
          <div className="give-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="give-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
          </div>
          <p className="give-eyebrow">{area === "owner" ? "MAIZZ OWNER" : "CHURCH DASHBOARD"}</p>
          <h1 className="give-thanks tight">{step === "password" ? "Sign in" : method === "app" ? "Enter your code" : "Check your email"}</h1>
          <p className="give-lede">
            {step === "password"
              ? (area === "owner" ? "Use the email you were invited with." : "Use the email your church owner invited.")
              : method === "app"
                ? "Open your authenticator app and enter the six-digit code for Maizz."
                : "We sent a six-digit code to your email. It works for 10 minutes."}
          </p>
        </header>
        <section className="give-sheet">
          {step === "password" ? (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitPassword();
              }}
            >
              <div className="give-group">
                <label className="give-label" htmlFor="email">Email</label>
                <input id="email" className="give-input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="password">Password</label>
                <input id="password" className="give-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || !email.trim() || !password}>
                {busy ? "Checking…" : "Continue"}
              </button>
              <a className="give-link" href={`${home}/forgot`}>Forgot your password?</a>
              <p className="give-hint">{area === "owner" ? "A second code is needed every time you sign in: from your authenticator app, or by email until the app is set up." : "A code is sent to your email every time you sign in, so only you can get in."}</p>
            </form>
          ) : (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode();
              }}
            >
              <div className="give-group">
                <label className="give-label" htmlFor="code">{method === "app" ? "Code from your app (or a recovery code)" : "Six-digit code"}</label>
                <input
                  id="code"
                  className="give-input give-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={method === "app" ? 9 : 7}
                  placeholder={method === "app" ? "------" : "------"}
                  value={code}
                  onChange={(e) => setCode(method === "app" ? e.target.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 9) : e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <small className="give-hint">{method === "app" ? "Lost your phone? Use one of your recovery codes instead." : "It can take a minute to arrive. Check your spam folder too."}</small>
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || (method === "app" ? code.replace(/-/g, "").length < 6 : code.length !== 6)}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <button
                type="button"
                className="give-secondary"
                onClick={() => {
                  setStep("password");
                  setCode("");
                  setError("");
                }}
              >
                {method === "app" ? "Start again" : "Send a new code"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
