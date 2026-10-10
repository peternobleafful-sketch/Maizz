"use client";

import { useState } from "react";

interface Check {
  id: string;
  label: string;
  ok: boolean;
  hint: string;
}

// The access token is kept in memory only. It is never saved in the browser.
export default function SetupCheckClient() {
  const [token, setToken] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [testOutput, setTestOutput] = useState("");

  const auth = { Authorization: `Bearer ${token.trim()}` };

  async function runChecks() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/setup-check", { method: "POST", headers: auth });
      if (res.status === 404) {
        setChecks(null);
        setMessage("The setup check is switched off. Add SETUP_CHECK_TOKEN in Vercel (at least 24 characters) and redeploy.");
      } else if (res.status === 401) {
        setChecks(null);
        setMessage("That access token is not right. Too many wrong attempts will lock this page for 15 minutes.");
      } else if (!res.ok) {
        setChecks(null);
        const data: { message?: string } = await res.json().catch(() => ({}));
        setMessage(data.message ?? "Something went wrong. Try again.");
      } else {
        const data: { checks: Check[] } = await res.json();
        setChecks(data.checks);
      }
    } catch {
      setMessage("Could not reach the site. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function startTestGift() {
    setBusy(true);
    setTestOutput("");
    try {
      const res = await fetch("/api/admin/test-gift", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ network, phone }),
      });
      const data: { error?: string; reference?: string; result?: { kind: string; message?: string } } = await res.json();
      if (!res.ok || data.error) {
        setTestOutput(data.error ?? "Something went wrong.");
      } else {
        setReference(data.reference ?? "");
        setTestOutput(`Started. Paystack says: ${data.result?.kind ?? "unknown"}${data.result?.message ? ` — ${data.result.message}` : ""}`);
      }
    } catch {
      setTestOutput("Could not reach the site.");
    } finally {
      setBusy(false);
    }
  }

  async function checkGift() {
    setBusy(true);
    setTestOutput("");
    try {
      const res = await fetch(`/api/admin/check-gift?reference=${encodeURIComponent(reference)}`, { headers: auth });
      const data: {
        error?: string;
        paystack?: { status: string; amountPesewas: number } | null;
        ledger?: { status: string; wasPaid: boolean } | null;
      } = await res.json();
      if (!res.ok || data.error) {
        setTestOutput(data.error ?? "Something went wrong.");
      } else {
        const p = data.paystack ? `${data.paystack.status} (${data.paystack.amountPesewas} pesewas)` : "not found";
        const l = data.ledger ? `${data.ledger.status}${data.ledger.wasPaid ? ", paid" : ""}` : "not found";
        setTestOutput(`Paystack says: ${p}. Maizz ledger says: ${l}.`);
      }
    } catch {
      setTestOutput("Could not reach the site.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tool">
      <h1>Maizz setup check</h1>
      <p className="tool-note">
        Private. Enter your access token to test the settings. No keys are ever shown here.
      </p>

      <label className="tool-label" htmlFor="token">Access token</label>
      <input
        id="token"
        className="tool-input"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <button className="tool-button" onClick={runChecks} disabled={busy || token.trim().length === 0}>
        Run checks
      </button>

      {message && <p className="tool-message">{message}</p>}

      {checks && (
        <ul className="tool-list">
          {checks.map((c) => (
            <li key={c.id}>
              <span className={c.ok ? "tag tag-pass" : "tag tag-fix"}>{c.ok ? "PASS" : "FIX"}</span>
              <span className="tool-check">
                <strong>{c.label}</strong>
                <span>{c.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {checks && (
        <section className="tool-section">
          <h2>Test payment (test mode, GH₵1)</h2>
          <p className="tool-note">
            Use a test number from Paystack&apos;s test-mode documentation for Ghana mobile money. No real money moves.
          </p>
          <label className="tool-label" htmlFor="network">Network</label>
          <select id="network" className="tool-input" value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="mtn">MTN</option>
            <option value="vodafone">Vodafone</option>
            <option value="airteltigo">AirtelTigo</option>
          </select>
          <label className="tool-label" htmlFor="phone">Phone number</label>
          <input
            id="phone"
            className="tool-input"
            inputMode="tel"
            placeholder="0551234987"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="tool-button" onClick={startTestGift} disabled={busy || phone.trim().length === 0}>
            Start test payment
          </button>

          {reference && (
            <>
              <p className="tool-note">Test reference: <code>{reference}</code></p>
              <button className="tool-button" onClick={checkGift} disabled={busy}>
                Check result
              </button>
            </>
          )}
          {testOutput && <p className="tool-message">{testOutput}</p>}
        </section>
      )}
    </main>
  );
}
