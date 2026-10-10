"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export default function TeamClient({ people, meId }: { people: Person[]; meId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function call(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/church/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return false;
      }
      setMessage(data.message ?? "Done.");
      router.refresh();
      return true;
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="dash-card flush">
        <ul className="dash-team">
          {people.map((p) => (
            <li key={p.id}>
              <span className="dash-avatar">{initials(p.name)}</span>
              <span className="who">
                <strong>{p.name}{p.id === meId ? " (you)" : ""}</strong>
                <small>{p.email}</small>
              </span>
              <span className="dash-meta">
              <span className="dash-role">{p.role}</span>
              <span className={p.status === "active" ? "tag tag-pass" : "tag tag-fix"}>{p.status === "invited" ? "INVITED" : p.status.toUpperCase()}</span>
              {p.id !== meId && (
                <span className="dash-actions">
                  {p.status === "invited" && (
                    <button className="dash-link-btn" disabled={busy} onClick={() => void call({ action: "resend", userId: p.id })}>Send invite again</button>
                  )}
                  {p.status === "active" && (
                    <button className="dash-link-btn danger" disabled={busy} onClick={() => void call({ action: "disable", userId: p.id })}>Remove access</button>
                  )}
                  {p.status === "disabled" && (
                    <button className="dash-link-btn" disabled={busy} onClick={() => void call({ action: "enable", userId: p.id })}>Restore access</button>
                  )}
                </span>
              )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-card">
        <h2>Invite someone</h2>
        <form
          className="give-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call({ action: "invite", fullName: name, email, role })) {
              setName("");
              setEmail("");
            }
          }}
        >
          <div className="give-group">
            <label className="give-label" htmlFor="t-name">Name</label>
            <input id="t-name" className="give-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="give-group">
            <label className="give-label" htmlFor="t-email">Email</label>
            <input id="t-email" className="give-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="name@example.com" />
          </div>
          <fieldset className="give-group">
            <legend className="give-label">Role</legend>
            <div className="give-chips">
              {(["viewer", "finance", "owner"] as const).map((r) => (
                <button key={r} type="button" className={role === r ? "give-chip on" : "give-chip"} onClick={() => setRole(r)}>
                  {r[0]!.toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            <small className="give-hint">
              Finance can see gifts, payouts and the CSV. Viewers can see the overview and gifts. Only owners change the team.
            </small>
          </fieldset>
          {error && <p className="give-error" role="alert">{error}</p>}
          {message && <p className="dash-ok" role="status">{message}</p>}
          <button className="give-button" type="submit" disabled={busy || name.trim().length < 1 || !email.includes("@")}>Send invite</button>
        </form>
      </section>
    </>
  );
}
