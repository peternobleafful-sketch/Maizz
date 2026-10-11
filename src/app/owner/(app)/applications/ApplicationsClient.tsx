"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface App {
  id: string;
  churchName: string;
  town: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  note: string | null;
  status: "new" | "accepted" | "declined";
  createdAt: string;
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" });

export default function ApplicationsClient({ apps }: { apps: App[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function decide(id: string, action: "accept" | "decline") {
    if (action === "decline" && !window.confirm("Decline this application? Nothing is sent to them.")) return;
    setBusy(id);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/owner/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) setError(data.error ?? "Something went wrong. Try again.");
      else {
        setMessage(data.message ?? "Done.");
        router.refresh();
      }
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  const waiting = apps.filter((a) => a.status === "new");
  const done = apps.filter((a) => a.status !== "new");

  return (
    <>
      {message && <p className="dash-ok" role="status">{message}</p>}
      {error && <p className="give-error" role="alert">{error}</p>}

      {waiting.length === 0 ? (
        <section className="dash-card dash-empty"><h2>Nothing waiting</h2><p>New applications from the register page show here, and you get an email.</p></section>
      ) : (
        waiting.map((a) => (
          <section className="dash-card" key={a.id}>
            <h2>{a.churchName}</h2>
            <dl className="dash-dl">
              <div><dt>Town</dt><dd>{a.town ?? "Not given"}</dd></div>
              <div><dt>Contact</dt><dd>{a.contactName}</dd></div>
              <div><dt>Email</dt><dd>{a.contactEmail}</dd></div>
              <div><dt>Phone</dt><dd className="mono">{a.contactPhone}</dd></div>
              <div><dt>Applied</dt><dd>{when(a.createdAt)}</dd></div>
            </dl>
            {a.note && <p className="dash-muted">&ldquo;{a.note}&rdquo;</p>}
            <p className="dash-muted">Check the church is genuine (call them) before you accept. Accepting adds it as not open yet and emails the contact an invite to the church dashboard.</p>
            <div className="dash-actions-row">
              <button className="dash-btn" type="button" disabled={busy !== ""} onClick={() => void decide(a.id, "accept")}>{busy === a.id ? "Please wait…" : "Accept"}</button>
              <button className="dash-btn ghost" type="button" disabled={busy !== ""} onClick={() => void decide(a.id, "decline")}>Decline</button>
            </div>
          </section>
        ))
      )}

      {done.length > 0 && (
        <section className="dash-card flush">
          <ul className="dash-team plain">
            {done.map((a) => (
              <li key={a.id}>
                <span className="who"><strong>{a.churchName}</strong><small>{a.contactName} · {when(a.createdAt)}</small></span>
                <span className="dash-meta"><span className={a.status === "accepted" ? "tag tag-pass" : "tag tag-fix"}>{a.status.toUpperCase()}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
