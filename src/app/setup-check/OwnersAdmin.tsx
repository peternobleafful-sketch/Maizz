"use client";

import { useState } from "react";

interface Person {
  id: string;
  name: string;
  email: string;
  status: string;
}

// Private owner tool: who can sign in to the Maizz owner dashboard. The token stays in memory and is passed in by the setup page.
export default function OwnersAdmin({ token }: { token: string }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(action: "list" | "invite" | "resend", extra: Record<string, unknown> = {}): Promise<boolean> {
    setBusy(true);
    if (action !== "list") setMessage("");
    try {
      const res = await fetch("/api/admin/owner", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data: { error?: string; message?: string; people?: Person[] } = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? data.message ?? "Something went wrong.");
        return false;
      }
      if (data.message) setMessage(data.message);
      if (data.people) setPeople(data.people);
      return true;
    } catch {
      setMessage("Could not reach the site.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tool-section">
      <h2>Maizz owners</h2>
      <p className="tool-note">
        Owners sign in at /owner/sign-in to see every church, the totals and your fee earnings. Each person gets an email to
        choose a password, then a code is emailed at every sign-in. This needs email sending to be set up.
      </p>
      <button className="tool-button" onClick={() => void call("list")} disabled={busy}>
        Show owners
      </button>
      {people && (
        <ul className="tool-list">
          {people.length === 0 && <li>No owners yet.</li>}
          {people.map((p) => (
            <li key={p.id}>
              <span className={p.status === "active" ? "tag tag-pass" : "tag tag-fix"}>{p.status.toUpperCase()}</span>
              <span className="tool-check">
                <strong>{p.name}</strong>
                <span>{p.email}</span>
                {p.status === "invited" && (
                  <button className="give-link" onClick={() => void call("resend", { userId: p.id })} disabled={busy}>
                    Send the invite again
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="tool-label" htmlFor="o-name">Name</label>
      <input id="o-name" className="tool-input" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="tool-label" htmlFor="o-email">Email</label>
      <input id="o-email" className="tool-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button
        className="tool-button"
        disabled={busy || name.trim().length < 1 || !email.includes("@")}
        onClick={async () => {
          if (await call("invite", { fullName: name, email })) {
            setName("");
            setEmail("");
            await call("list");
          }
        }}
      >
        Send invite
      </button>
      {message && <p className="tool-message">{message}</p>}
    </section>
  );
}
