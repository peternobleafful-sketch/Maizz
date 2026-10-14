"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ChurchRow {
  slug: string;
  name: string;
  status: "pending" | "active" | "suspended";
  paused: boolean;
  payoutSet: boolean;
  payoutBank: string | null;
  payoutLast4: string | null;
  payoutName: string | null;
  line: string;
  month: string;
}

interface Bank { name: string; code: string; kind: "mobile_money" | "bank" }
interface Person { id: string; name: string; email: string; role: string; status: string }

type Reply = { error?: string; message?: string; notice?: string; challenge?: string; method?: "email" | "app"; banks?: Bank[]; people?: Person[]; church?: { name: string; status: string; payoutAccountName: string | null; slug: string } };

export default function ChurchTools({ churches }: { churches: ChurchRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [account, setAccount] = useState("");
  const [challenge, setChallenge] = useState("");
  const [method, setMethod] = useState<"email" | "app">("email");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);

  async function call(body: Record<string, unknown>): Promise<Reply | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/owner/churches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as Reply;
      if (res.status === 401) {
        window.location.href = "/owner/sign-in";
        return null;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function manage(slug: string) {
    if (open === slug) {
      setOpen("");
      return;
    }
    setOpen(slug);
    setMessage("");
    setError("");
    setChallenge("");
    setCode("");
    setAccount("");
    setConfirmed(false);
    setPeople(null);
    if (banks.length === 0) {
      const b = await call({ action: "banks" });
      if (b?.banks) setBanks(b.banks);
    }
  }

  async function add() {
    setMessage("");
    const r = await call({ action: "create", name: newName });
    if (r?.church) {
      setNewName("");
      setMessage(`${r.church.name} was added as pending. Next: set up its payout account, then open it.`);
      router.refresh();
    }
  }

  async function sendCode(slug: string) {
    setMessage("");
    const r = await call({ action: "payout_code", slug });
    if (r?.challenge) {
      setChallenge(r.challenge);
      setMethod(r.method === "app" ? "app" : "email");
      setMessage(r.message ?? "A code was emailed to you.");
    }
  }

  async function savePayout(slug: string) {
    setMessage("");
    const r = await call({ action: "payout", slug, bankCode, accountNumber: account, challenge, code });
    if (r?.church) {
      setAccount("");
      setCode("");
      setChallenge("");
      setMessage(`Payout account created. The account holder is "${r.church.payoutAccountName || "(no name returned)"}". Check that this matches the church before you open it. ${r.notice ?? ""}`);
      router.refresh();
    }
  }

  async function change(slug: string, action: "activate" | "suspend") {
    setMessage("");
    const r = await call({ action, slug, confirmed });
    if (r?.church) {
      setConfirmed(false);
      setMessage(`${r.church.name} is now ${r.church.status}.`);
      router.refresh();
    }
  }

  async function team(slug: string) {
    const r = await call({ action: "team", slug });
    if (r?.people) setPeople(r.people);
  }

  async function resend(slug: string, userId: string) {
    setMessage("");
    const r = await call({ action: "resend", slug, userId });
    if (r) setMessage(r.message ?? "Done.");
  }

  return (
    <>
      {message && <p className="dash-ok" role="status">{message}</p>}
      {error && <p className="give-error" role="alert">{error}</p>}

      <section className="dash-card">
        <h2>Add a church</h2>
        <form className="give-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="give-group">
            <label className="give-label" htmlFor="new-church">Church name</label>
            <input id="new-church" className="give-input" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
          </div>
          <button className="give-button" type="submit" disabled={busy || newName.trim().length < 2}>Add church</button>
        </form>
      </section>

      {churches.length === 0 ? (
        <section className="dash-card dash-empty"><h2>No churches yet</h2><p>Add one above, or accept an application.</p></section>
      ) : (
        <section className="dash-card flush">
          <ul className="dash-team plain">
            {churches.map((c) => {
              const state = c.status === "active" ? (c.paused ? "PAUSED BY CHURCH" : "OPEN") : c.status === "pending" ? "NOT OPEN YET" : "SUSPENDED";
              return (
                <li key={c.slug} className="owner-church">
                  <span className="who">
                    <strong>{c.name}</strong>
                    <small>{c.line}</small>
                  </span>
                  <span className="dash-meta">
                    <span className="dash-role">{c.month} this month</span>
                    <span className={state === "OPEN" ? "tag tag-pass" : "tag tag-fix"}>{state}</span>
                    <button className="dash-link-btn" type="button" disabled={busy} onClick={() => void manage(c.slug)} aria-expanded={open === c.slug}>
                      {open === c.slug ? "Close" : "Manage"}
                    </button>
                  </span>

                  {open === c.slug && (
                    <div className="owner-panel">
                      {c.status !== "active" ? (
                        <div className="give-form">
                          <h3>Payout account</h3>
                          <p className="dash-muted">
                            Test mode only. Only the last 4 digits are kept. You will confirm with a code (from your authenticator app if it is on, otherwise by email), and the church&apos;s owners are told afterwards.
                          </p>
                          <div className="give-group">
                            <label className="give-label" htmlFor={`bank-${c.slug}`}>Bank or mobile money network</label>
                            <select id={`bank-${c.slug}`} className="give-input" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                              <option value="">Select…</option>
                              <optgroup label="Mobile money">{banks.filter((b) => b.kind === "mobile_money").map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</optgroup>
                              <optgroup label="Banks">{banks.filter((b) => b.kind === "bank").map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</optgroup>
                            </select>
                          </div>
                          <div className="give-group">
                            <label className="give-label" htmlFor={`acct-${c.slug}`}>Account or mobile money number</label>
                            <input id={`acct-${c.slug}`} className="give-input" inputMode="numeric" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} />
                          </div>
                          {!challenge ? (
                            <button className="dash-btn" type="button" disabled={busy || !bankCode || account.trim().length < 6} onClick={() => void sendCode(c.slug)}>
                              Email me a code
                            </button>
                          ) : (
                            <>
                              <div className="give-group">
                                <label className="give-label" htmlFor={`code-${c.slug}`}>{method === "app" ? "The 6-digit code from your authenticator app" : "The 6-digit code from your email"}</label>
                                <input id={`code-${c.slug}`} className="give-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
                              </div>
                              <button className="dash-btn" type="button" disabled={busy || !/^\d{6}$/.test(code.trim()) || !bankCode || account.trim().length < 6} onClick={() => void savePayout(c.slug)}>
                                Save payout account
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <p className="dash-muted">This church is open. To change its payout account, suspend it first.</p>
                      )}

                      {c.status !== "active" && c.payoutSet && (
                        <div className="give-form">
                          <h3>Open the church for gifts</h3>
                          <label className="give-check">
                            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                            <span>I have checked this church is genuine, and the account name ({c.payoutName || "not returned"}) matches the church.</span>
                          </label>
                          <button className="dash-btn" type="button" disabled={busy || !confirmed} onClick={() => void change(c.slug, "activate")}>Open church</button>
                        </div>
                      )}

                      {c.status === "active" && (
                        <div className="give-form">
                          <h3>Suspend</h3>
                          <p className="dash-muted">Stops all new gifts to this church straight away.</p>
                          <button className="dash-btn ghost" type="button" disabled={busy} onClick={() => { if (window.confirm(`Suspend ${c.name}?`)) void change(c.slug, "suspend"); }}>Suspend church</button>
                        </div>
                      )}

                      <div className="give-form">
                        <h3>People</h3>
                        <button className="dash-btn ghost" type="button" disabled={busy} onClick={() => void team(c.slug)}>Show people</button>
                        {people && (
                          <ul className="dash-team plain">
                            {people.length === 0 && <li><span className="who"><small>No one has been invited yet.</small></span></li>}
                            {people.map((p) => (
                              <li key={p.id}>
                                <span className="who"><strong>{p.name} · {p.role}</strong><small>{p.email}</small></span>
                                <span className="dash-meta">
                                  <span className={p.status === "active" ? "tag tag-pass" : "tag tag-fix"}>{p.status.toUpperCase()}</span>
                                  {p.status === "invited" && <button className="dash-link-btn" type="button" disabled={busy} onClick={() => void resend(c.slug, p.id)}>Send invite again</button>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
