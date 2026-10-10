"use client";

import { useState } from "react";

export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { message?: string };
      if (res.ok) setDone(true);
      else setError(data.message ?? "Something went wrong. Try again.");
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
          <h1 className="give-thanks tight">{done ? "New password saved" : "Choose a new password"}</h1>
          <p className="give-lede">
            {done ? "You are signed out everywhere. Sign in with your new password." : "At least 12 characters. A few random words works well."}
          </p>
        </header>
        <section className="give-sheet">
          {done ? (
            <a className="give-button as-link" href="/church/sign-in">Go to sign-in</a>
          ) : (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="give-group">
                <label className="give-label" htmlFor="pw">New password</label>
                <input id="pw" className="give-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="pw2">Type it again</label>
                <input id="pw2" className="give-input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || password.length < 12 || !again}>
                {busy ? "Saving…" : "Save password"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
