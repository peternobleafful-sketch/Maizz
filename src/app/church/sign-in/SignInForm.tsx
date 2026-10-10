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

export default function SignInForm() {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitPassword() {
    setBusy(true);
    setError("");
    const r = await post("/api/staff/sign-in", { email, password });
    setBusy(false);
    if (r.ok && typeof r.data.challenge === "string") {
      setChallenge(r.data.challenge);
      setPassword("");
      setStep("code");
    } else setError(String(r.data.message ?? "Something went wrong. Try again."));
  }

  async function submitCode() {
    setBusy(true);
    setError("");
    const r = await post("/api/staff/code", { challenge, code });
    if (r.ok) {
      window.location.assign("/church");
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
          <p className="give-eyebrow">CHURCH DASHBOARD</p>
          <h1 className="give-thanks tight">{step === "password" ? "Sign in" : "Check your email"}</h1>
          <p className="give-lede">
            {step === "password"
              ? "Use the email your church owner invited."
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
              <p className="give-hint">A code is sent to your email every time you sign in, so only you can get in.</p>
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
                <label className="give-label" htmlFor="code">Six-digit code</label>
                <input
                  id="code"
                  className="give-input give-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="------"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <small className="give-hint">It can take a minute to arrive. Check your spam folder too.</small>
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || code.length !== 6}>
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
                Send a new code
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
