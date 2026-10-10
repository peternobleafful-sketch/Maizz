"use client";

import { useState } from "react";

export default function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/reset-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (res.ok) setSent(true);
      else setError("Something went wrong. Try again in a minute.");
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    }
    setBusy(false);
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
          <h1 className="give-thanks tight">{sent ? "Check your email" : "Reset your password"}</h1>
          <p className="give-lede">
            {sent
              ? "If that email has a Maizz sign-in, a reset link is on its way. It works once, for 1 hour."
              : "Enter your email and we will send you a link to choose a new password."}
          </p>
        </header>
        <section className="give-sheet">
          {sent ? (
            <a className="give-button as-link" href="/church/sign-in">Back to sign-in</a>
          ) : (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="give-group">
                <label className="give-label" htmlFor="email">Email</label>
                <input id="email" className="give-input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send reset link"}</button>
              <a className="give-link" href="/church/sign-in">Back to sign-in</a>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
