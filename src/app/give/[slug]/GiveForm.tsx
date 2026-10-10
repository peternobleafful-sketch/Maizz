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

  const showAmount = phase === "form";
  const heroTotal = formatCedis(paidTotal);

  return (
    <div className="give-wrap">
      <main className="give">
        <header className="give-hero">
          <div className="give-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="give-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
            {props.testMode && <p className="give-test">Test mode: no real money moves</p>}
          </div>
          {phase === "paid" ? (
            <div className="give-tick" aria-hidden="true">
              <svg width="56" height="56" viewBox="0 0 56 56">
                <path d="M14 29L24 39L42 17" />
              </svg>
            </div>
          ) : (
            <p className="give-church">Give to {props.churchName}</p>
          )}

          {showAmount ? (
            <>
              <div className="give-amount">
                <span className="give-cedi">GH₵</span>
                <input
                  className="give-figure"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Amount in cedis"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                />
              </div>
              <div className="give-quick">
                {QUICK.map((q) => (
                  <button
                    type="button"
                    key={q}
                    className={amount === q ? "give-pill on" : "give-pill"}
                    onClick={() => setAmountText(String(q / 100))}
                  >
                    {q / 100}
                  </button>
                ))}
              </div>
            </>
          ) : phase === "paid" ? (
            <>
              <h1 className="give-thanks">Thank you</h1>
              <p className="give-lede">{props.churchName} has received your gift. God bless you.</p>
            </>
          ) : (
            <p className="give-total">{heroTotal}</p>
          )}
        </header>

        <section className="give-sheet">
          {phase === "form" && (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <fieldset className="give-group">
                <legend className="give-label">Gift type</legend>
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
                <legend className="give-label">Mobile money network</legend>
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

              <div className="give-group">
                <label className="give-label" htmlFor="phone">Mobile money number</label>
                <input
                  id="phone"
                  className="give-input"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="024 412 3456"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <label className="give-check">
                <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                <span>Give anonymously. We will not keep your name.</span>
              </label>

              {anonymous && (
                <p className="give-note">
                  {props.churchName} will see this gift as Anonymous. Your number is never shown to the church.
                </p>
              )}

              {!anonymous && (
                <div className="give-group">
                  <label className="give-label" htmlFor="name">Your name</label>
                  <input
                    id="name"
                    className="give-input"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  <small className="give-hint">So the church can thank you.</small>
                </div>
              )}

              {fees && (
                <div className="give-sum" aria-live="polite">
                  <p className="give-row"><span>Gift</span><span>{formatCedis(fees.giftPesewas)}</span></p>
                  <p className="give-row"><span>Fees</span><span>{formatCedis(fees.feePesewas)}</span></p>
                  <p className="give-row big"><span>Total</span><span>{formatCedis(fees.totalPesewas)}</span></p>
                  <small>{props.churchName} receives the full {formatCedis(fees.giftPesewas)}.</small>
                </div>
              )}

              {error && <p className="give-error" role="alert">{error}</p>}

              <button
                className="give-button"
                type="submit"
                disabled={busy || !fees || phone.trim().length === 0 || (!anonymous && fullName.trim().length < 2)}
              >
                {fees ? `Give ${formatCedis(fees.totalPesewas)}` : "Enter an amount"}
              </button>

              <p className="give-safe">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                You approve the payment on your phone. Maizz never sees your PIN.
              </p>
            </form>
          )}

          {phase === "waiting" && (
            <div className="give-state">
              <div className="give-pulse" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#011bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="7" y="2" width="10" height="20" rx="2" />
                  <path d="M11 18h2" />
                </svg>
              </div>
              <h2>Check your phone</h2>
              <p>We sent a prompt to your phone. Enter your PIN to approve {heroTotal}. This page updates by itself.</p>
              {slow && <p className="give-ref">Still waiting. If nothing came, go back and try again.</p>}
              <button className="give-link" onClick={again}>Cancel and go back</button>
            </div>
          )}

          {phase === "confirming" && (
            <div className="give-state">
              <div className="give-pulse" aria-hidden="true" />
              <h2>Confirming your gift</h2>
              <p>Your payment went through. We are confirming it now. This page updates by itself.</p>
              {slow && <p className="give-ref">Confirmation is taking longer than usual. Your gift is safe. You can close this page.</p>}
            </div>
          )}

          {phase === "otp" && (
            <div className="give-state">
              <h2>Enter your code</h2>
              <p>Your network sent you a one-time code. It can take up to a minute to arrive.</p>
              <input
                className="give-input"
                inputMode="numeric"
                aria-label="Code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" onClick={() => void sendOtp()} disabled={busy || otp.trim().length < 3}>
                Continue
              </button>
            </div>
          )}

          {phase === "paid" && (
            <div className="give-state wide">
              {fees && (
                <div className="give-sum" aria-label="Receipt">
                  <p className="give-row"><span>Gift</span><span>{formatCedis(fees.giftPesewas)}</span></p>
                  <p className="give-row"><span>Fees</span><span>{formatCedis(fees.feePesewas)}</span></p>
                  <p className="give-row big"><span>Total</span><span>{formatCedis(fees.totalPesewas)}</span></p>
                </div>
              )}
              <p className="give-refbox"><span>Reference</span><span>{reference}</span></p>
              <button className="give-button" onClick={again}>Give again</button>
            </div>
          )}

          {phase === "failed" && (
            <div className="give-state wide">
              <h2>Your gift did not go through</h2>
              <p className="give-error">{error || "The payment did not go through."}</p>
              <p className="give-steps-title">What to do next</p>
              <ol className="give-steps">
                <li>Check you have enough in your mobile money wallet.</li>
                <li>Make sure the number is registered on the network you chose and your phone has signal.</li>
                <li>Try again. If it fails twice, choose another network or ask your church office.</li>
              </ol>
              <button className="give-button" onClick={again}>Try again</button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
