"use client";

import { useEffect, useRef, useState } from "react";
import { addFees } from "@/lib/fees";
import { cedisToPesewas, formatCedis } from "@/lib/money";

const QUICK = [2000, 5000, 10000, 20000];
const NETWORKS = [
  { value: "mtn", label: "MTN" },
  { value: "vodafone", label: "Vodafone" },
  { value: "airteltigo", label: "AirtelTigo" },
];

type Phase = "form" | "waiting" | "confirming" | "otp" | "paid" | "failed";

export default function GiveForm(props: {
  slug: string;
  churchName: string;
  testMode: boolean;
  types: { value: string; label: string }[];
}) {
  const [amountText, setAmountText] = useState("");
  const [giftType, setGiftType] = useState("tithe");
  const [anonymous, setAnonymous] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [network, setNetwork] = useState("mtn");

  const [phase, setPhase] = useState<Phase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [otp, setOtp] = useState("");
  const [paidTotal, setPaidTotal] = useState(0);
  const [slow, setSlow] = useState(false);
  const stop = useRef(false);

  let amount: number | null = null;
  try {
    amount = amountText.trim() ? cedisToPesewas(amountText) : null;
  } catch {
    amount = null;
  }
  const valid = amount !== null && amount >= 100 && amount <= 5_000_000;
  const fees = valid && amount !== null ? addFees(amount) : null;

  useEffect(() => {
    stop.current = false;
    if ((phase !== "waiting" && phase !== "confirming" && phase !== "otp") || !reference) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (stop.current) return;
      try {
        const res = await fetch(`/api/checkout/status?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
        const data: { status?: string } = await res.json();
        if (data.status === "paid") setPhase("paid");
        else if (data.status === "failed") {
          setError("The payment did not go through. Please check the number and try again.");
          setPhase("failed");
        }
      } catch {
        // keep trying
      }
      if (Date.now() - started > 120_000) setSlow(true);
    }, 4000);
    return () => {
      stop.current = true;
      clearInterval(timer);
    };
  }, [phase, reference]);

  async function submit() {
    if (!fees || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          church: props.slug,
          amountPesewas: fees.giftPesewas,
          giftType,
          anonymous,
          fullName: anonymous ? undefined : fullName,
          phone,
          network,
        }),
      });
      const data: { error?: string; reference?: string; totalPesewas?: number; step?: { kind: string; message?: string } } =
        await res.json();
      if (!res.ok || !data.reference || !data.step) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setReference(data.reference);
      setPaidTotal(data.totalPesewas ?? fees.totalPesewas);
      setSlow(false);
      if (data.step.kind === "failed") {
        setError(data.step.message ?? "The payment did not go through.");
        setPhase("failed");
      } else if (data.step.kind === "confirming") setPhase("confirming");
      else if (data.step.kind === "otp") setPhase("otp");
      else setPhase("waiting");
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/checkout/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, otp }),
      });
      const data: { error?: string; step?: { kind: string; message?: string } } = await res.json();
      if (!res.ok || !data.step) setError(data.error ?? "That code did not work.");
      else if (data.step.kind === "failed") {
        setError(data.step.message ?? "The payment did not go through.");
        setPhase("failed");
      } else if (data.step.kind === "confirming") setPhase("confirming");
      else {
        setOtp("");
        setPhase("waiting");
      }
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setPhase("form");
    setError("");
    setReference("");
    setOtp("");
  }

  return (
    <main className="give">
      <header className="give-head">
        <p className="give-brand">MAIZZ</p>
        <h1>Give to {props.churchName}</h1>
      </header>

      {props.testMode && <p className="give-test">Test mode. No real money moves.</p>}

      {phase === "form" && (
        <form
          className="give-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="give-group">
            <legend className="tool-label">Amount (GH₵)</legend>
            <div className="give-chips">
              {QUICK.map((q) => (
                <button
                  type="button"
                  key={q}
                  className={amount === q ? "give-chip on" : "give-chip"}
                  onClick={() => setAmountText(String(q / 100))}
                >
                  {q / 100}
                </button>
              ))}
            </div>
            <input
              className="tool-input"
              inputMode="decimal"
              placeholder="Or type an amount, e.g. 75 or 75.50"
              aria-label="Amount in cedis"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </fieldset>

          <fieldset className="give-group">
            <legend className="tool-label">What are you giving?</legend>
            <div className="give-chips">
              {props.types.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  className={giftType === t.value ? "give-chip on" : "give-chip"}
                  onClick={() => setGiftType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="give-group">
            <legend className="tool-label">Mobile money network</legend>
            <div className="give-chips">
              {NETWORKS.map((n) => (
                <button
                  type="button"
                  key={n.value}
                  className={network === n.value ? "give-chip on" : "give-chip"}
                  onClick={() => setNetwork(n.value)}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="tool-label" htmlFor="phone">Mobile money number</label>
          <input
            id="phone"
            className="tool-input"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0551234987"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <label className="give-check">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>Give anonymously (your name is not kept)</span>
          </label>

          {!anonymous && (
            <>
              <label className="tool-label" htmlFor="name">Your name</label>
              <input
                id="name"
                className="tool-input"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </>
          )}

          {fees && (
            <p className="give-sum" aria-live="polite">
              Gift {formatCedis(fees.giftPesewas)} + fees {formatCedis(fees.feePesewas)} = <strong>{formatCedis(fees.totalPesewas)}</strong>
              <span>The church receives the full {formatCedis(fees.giftPesewas)}.</span>
            </p>
          )}

          {error && <p className="tool-message" role="alert">{error}</p>}

          <button
            className="give-button"
            type="submit"
            disabled={busy || !fees || phone.trim().length === 0 || (!anonymous && fullName.trim().length < 2)}
          >
            {fees ? `Give ${formatCedis(fees.totalPesewas)}` : "Give"}
          </button>
          <p className="tool-note">You will approve the payment on your phone. Maizz never sees your PIN.</p>
        </form>
      )}

      {phase === "waiting" && (
        <section className="give-state">
          <h2>Approve on your phone</h2>
          <p>
            Check your phone for the {formatCedis(paidTotal)} request and enter your mobile money PIN there. This page
            updates by itself.
          </p>
          {slow && <p className="tool-note">Still waiting. If nothing came, go back and try again.</p>}
          <button className="give-link" onClick={again}>Go back</button>
        </section>
      )}

      {phase === "confirming" && (
        <section className="give-state">
          <h2>Confirming your gift</h2>
          <p>Your payment went through. We are confirming it now. This page updates by itself.</p>
          {slow && <p className="tool-note">Confirmation is taking longer than usual. Your gift is safe. You can close this page.</p>}
        </section>
      )}

      {phase === "otp" && (
        <section className="give-state">
          <h2>Enter your code</h2>
          <p>Your network sent you a code. Enter it to continue.</p>
          <input
            className="tool-input"
            inputMode="numeric"
            aria-label="Code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          {error && <p className="tool-message" role="alert">{error}</p>}
          <button className="give-button" onClick={() => void sendOtp()} disabled={busy || otp.trim().length < 3}>
            Continue
          </button>
        </section>
      )}

      {phase === "paid" && (
        <section className="give-state">
          <h2>Thank you</h2>
          <p>Your gift of {formatCedis(paidTotal)} has been received. God bless you.</p>
          <p className="tool-note">Reference: {reference}</p>
          <button className="give-link" onClick={again}>Give again</button>
        </section>
      )}

      {phase === "failed" && (
        <section className="give-state">
          <h2>Not completed</h2>
          <p>{error || "The payment did not go through."}</p>
          <button className="give-button" onClick={again}>Try again</button>
        </section>
      )}
    </main>
  );
}
