"use client";

import { useState } from "react";

interface Church {
  slug: string;
  name: string;
  status: "pending" | "active" | "suspended";
  payoutSet: boolean;
  payoutBank: string | null;
  payoutAccountLast4: string | null;
  payoutAccountName: string | null;
}

interface Bank {
  name: string;
  code: string;
  kind: "mobile_money" | "bank";
}

// Private owner tool. The token stays in memory and is passed in by the setup page.
export default function ChurchesAdmin({ token }: { token: string }) {
  const [churches, setChurches] = useState<Church[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [slug, setSlug] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function call(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/churches", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data: { error?: string; message?: string; churches?: Church[]; church?: Church; banks?: Bank[] } = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? data.message ?? "Something went wrong.");
        return null;
      }
      return data;
    } catch {
      setMessage("Could not reach the site.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const data = await call("list");
    if (data?.churches) setChurches(data.churches);
    if (banks.length === 0) {
      const b = await call("banks");
      if (b?.banks) setBanks(b.banks);
    }
  }

  async function addChurch() {
    const data = await call("create", { name: newName });
    if (data?.church) {
      setNewName("");
      setSlug(data.church.slug);
      setMessage(`Added "${data.church.name}" as pending. Its giving page will be /give/${data.church.slug} once it is active.`);
      const list = await call("list");
      if (list?.churches) setChurches(list.churches);
    }
  }

  async function setPayout() {
    const data = await call("payout", { slug, bankCode, accountNumber });
    if (data?.church) {
      setAccountNumber("");
      setConfirmed(false);
      setMessage(
        `Payout account created. Paystack found the account holder: "${data.church.payoutAccountName || "(no name returned)"}". ` +
          "Check that this matches the church before you activate it.",
      );
      const list = await call("list");
      if (list?.churches) setChurches(list.churches);
    }
  }

  async function change(action: "activate" | "suspend") {
    const data = await call(action, { slug, confirmed });
    if (data?.church) {
      setConfirmed(false);
      setMessage(`${data.church.name} is now ${data.church.status}.`);
      const list = await call("list");
      if (list?.churches) setChurches(list.churches);
    }
  }

  const [people, setPeople] = useState<{ id: string; name: string; email: string; role: string; status: string }[] | null>(null);
  const [pName, setPName] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [pRole, setPRole] = useState("owner");

  async function team(action: "list" | "invite" | "resend", extra: Record<string, unknown> = {}) {
    setBusy(true);
    if (action !== "list") setMessage("");
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, slug, ...extra }),
      });
      const data: { error?: string; message?: string; people?: typeof people } = await res.json();
      if (!res.ok) setMessage(data.error ?? data.message ?? "Something went wrong.");
      else {
        if (data.message) setMessage(data.message);
        if (data.people) setPeople(data.people);
        return true;
      }
    } catch {
      setMessage("Could not reach the site.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  const selected = churches?.find((c) => c.slug === slug) ?? null;

  return (
    <section className="tool-section">
      <h2>Churches</h2>
      <p className="tool-note">
        Test mode only. Use test bank or mobile money details. A church cannot receive gifts until you activate it, and
        it cannot be activated without a payout account.
      </p>
      <button className="tool-button" onClick={() => void refresh()} disabled={busy}>
        {churches ? "Refresh churches" : "Show churches"}
      </button>

      {churches && (
        <ul className="tool-list">
          {churches.map((c) => (
            <li key={c.slug}>
              <span className={c.status === "active" ? "tag tag-pass" : "tag tag-fix"}>{c.status.toUpperCase()}</span>
              <span className="tool-check">
                <strong>{c.name}</strong>
                <span>
                  {c.payoutSet
                    ? `Payout: ${c.payoutBank ?? ""} ending ${c.payoutAccountLast4 ?? "----"} · account name: ${c.payoutAccountName || "not returned"}`
                    : "No payout account yet"}
                </span>
                {c.status === "active" && <span>Giving page: /give/{c.slug}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {churches && (
        <>
          <label className="tool-label" htmlFor="church-name">Add a church</label>
          <input id="church-name" className="tool-input" placeholder="Church name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="tool-button" onClick={() => void addChurch()} disabled={busy || newName.trim().length < 2}>
            Add church
          </button>

          <label className="tool-label" htmlFor="church-pick">Choose a church to set up</label>
          <select id="church-pick" className="tool-input" value={slug} onChange={(e) => { setSlug(e.target.value); setConfirmed(false); }}>
            <option value="">Select…</option>
            {churches.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name} ({c.status})</option>
            ))}
          </select>

          {selected && selected.status !== "active" && (
            <>
              <label className="tool-label" htmlFor="bank">Payout bank or network</label>
              <select id="bank" className="tool-input" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                <option value="">Select…</option>
                <optgroup label="Mobile money">
                  {banks.filter((b) => b.kind === "mobile_money").map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Banks">
                  {banks.filter((b) => b.kind === "bank").map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </optgroup>
              </select>
              <label className="tool-label" htmlFor="acct">Account or mobile money number</label>
              <input id="acct" className="tool-input" inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
              <p className="tool-note">Only the last 4 digits are kept by Maizz.</p>
              <button className="tool-button" onClick={() => void setPayout()} disabled={busy || !bankCode || accountNumber.trim().length < 6}>
                Set up payout account
              </button>
            </>
          )}

          {selected && selected.status !== "active" && selected.payoutSet && (
            <>
              <label className="give-check">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  I have checked this church is genuine, and the account name ({selected.payoutAccountName || "not returned"}) matches the church.
                </span>
              </label>
              <button className="tool-button" onClick={() => void change("activate")} disabled={busy || !confirmed}>
                Activate church
              </button>
            </>
          )}

          {selected && selected.status === "active" && (
            <button className="tool-button" onClick={() => void change("suspend")} disabled={busy}>
              Suspend church
            </button>
          )}

          {selected && (
            <>
              <h2>Team for {selected.name}</h2>
              <p className="tool-note">
                Each person gets an email to choose a password. They sign in with email, password and a code sent to their
                email. This needs email sending to be set up.
              </p>
              <button className="tool-button" onClick={() => void team("list")} disabled={busy}>
                Show team
              </button>
              {people && (
                <ul className="tool-list">
                  {people.length === 0 && <li>No one yet.</li>}
                  {people.map((p) => (
                    <li key={p.id}>
                      <span className={p.status === "active" ? "tag tag-pass" : "tag tag-fix"}>{p.status.toUpperCase()}</span>
                      <span className="tool-check">
                        <strong>{p.name} · {p.role}</strong>
                        <span>{p.email}</span>
                        {p.status === "invited" && (
                          <button className="give-link" onClick={() => void team("resend", { userId: p.id })} disabled={busy}>
                            Send the invite again
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <label className="tool-label" htmlFor="p-name">Name</label>
              <input id="p-name" className="tool-input" value={pName} onChange={(e) => setPName(e.target.value)} />
              <label className="tool-label" htmlFor="p-email">Email</label>
              <input id="p-email" className="tool-input" type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} />
              <label className="tool-label" htmlFor="p-role">Role</label>
              <select id="p-role" className="tool-input" value={pRole} onChange={(e) => setPRole(e.target.value)}>
                <option value="owner">Owner (everything, including payout and team)</option>
                <option value="finance">Finance (gifts, payouts, exports)</option>
                <option value="viewer">Viewer (overview and gifts)</option>
              </select>
              <button
                className="tool-button"
                disabled={busy || pName.trim().length < 1 || !pEmail.includes("@")}
                onClick={async () => {
                  if (await team("invite", { fullName: pName, email: pEmail, role: pRole })) {
                    setPName("");
                    setPEmail("");
                    await team("list");
                  }
                }}
              >
                Send invite
              </button>
            </>
          )}
        </>
      )}

      {message && <p className="tool-message">{message}</p>}
    </section>
  );
}
