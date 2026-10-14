"use client";

import { useEffect, useState } from "react";

type Status = { enabled: boolean; pending: boolean; recoveryLeft: number };
type Reply = { error?: string; secret?: string; qr?: string; recoveryCodes?: string[] } & Partial<Status>;

async function call(body: Record<string, unknown>): Promise<{ status: number; data: Reply }> {
  try {
    const res = await fetch("/api/owner/authenticator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Reply };
  } catch {
    return { status: 0, data: { error: "Could not reach Maizz. Check your connection." } };
  }
}

export default function AuthenticatorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const r = await call({ action: "status" });
    if (r.status === 401) window.location.href = "/owner/sign-in";
    else if (r.status === 200) setStatus({ enabled: Boolean(r.data.enabled), pending: Boolean(r.data.pending), recoveryLeft: Number(r.data.recoveryLeft ?? 0) });
    else setError(r.data.error ?? "Could not load this.");
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function begin() {
    setBusy(true);
    setError("");
    const r = await call({ action: "begin" });
    setBusy(false);
    if (r.status === 200 && r.data.secret && r.data.qr) setSetup({ secret: r.data.secret, qr: r.data.qr });
    else setError(r.data.error ?? "Something went wrong.");
  }

  async function confirm(action: "confirm" | "renew") {
    setBusy(true);
    setError("");
    const r = await call({ action, code });
    setBusy(false);
    if (r.status === 200 && r.data.recoveryCodes) {
      setCodes(r.data.recoveryCodes);
      setSaved(false);
      setSetup(null);
      setCode("");
      void refresh();
    } else setError(r.data.error ?? "Something went wrong.");
  }

  if (!status) return <section className="dash-card"><h2>Sign-in security</h2><p className="dash-muted">{error || "Loading…"}</p></section>;

  return (
    <section className="dash-card">
      <h2>Sign-in security</h2>
      {codes ? (
        <>
          <p className="dash-ok" role="status">The authenticator app is on. Save these recovery codes now: they are shown only once.</p>
          <p className="dash-muted">Each code works once, if you lose your phone. Keep them somewhere safe and away from this computer&apos;s email, such as a notebook or a password manager.</p>
          <ul className="dash-codes">
            {codes.map((c) => <li key={c}><code>{c}</code></li>)}
          </ul>
          <label className="give-check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved these codes</span>
          </label>
          <button className="dash-btn" type="button" disabled={!saved} onClick={() => setCodes(null)}>Done</button>
        </>
      ) : status.enabled ? (
        <>
          <p className="dash-ok" role="status">Authenticator app: ON. Signing in and changing a payout account both need a code from the app, so your email alone cannot get in.</p>
          <p className="dash-muted">Recovery codes left: {status.recoveryLeft}. To make a new set (the old ones stop working), enter the current code from your app.</p>
          <form className="give-form" onSubmit={(e) => { e.preventDefault(); void confirm("renew"); }}>
            <div className="give-group">
              <label className="give-label" htmlFor="renew-code">Current code from the app</label>
              <input id="renew-code" className="give-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </div>
            <button className="give-button" type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Make new recovery codes"}</button>
          </form>
        </>
      ) : setup ? (
        <>
          <p className="dash-muted">1. Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar). 2. Add an account and scan this picture, or type the key. 3. Enter the 6-digit code it shows.</p>
          <div className="share-qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qr }} />
          <p className="dash-muted">Or type this key: <code>{setup.secret}</code></p>
          <form className="give-form" onSubmit={(e) => { e.preventDefault(); void confirm("confirm"); }}>
            <div className="give-group">
              <label className="give-label" htmlFor="setup-code">6-digit code from the app</label>
              <input id="setup-code" className="give-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </div>
            <button className="give-button" type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Switch it on"}</button>
          </form>
        </>
      ) : (
        <>
          <p className="dash-muted">Today a code is sent to your email each time you sign in, and again to change a payout account. Anyone who gets into your email could do both. An authenticator app on your phone closes that gap. Set it up before any real money.</p>
          <button className="dash-btn" type="button" disabled={busy} onClick={() => void begin()}>{busy ? "Starting…" : status.pending ? "Continue setting up the app" : "Set up the authenticator app"}</button>
        </>
      )}
      {error && <p className="give-error" role="alert">{error}</p>}
    </section>
  );
}
