"use client";

import Link from "next/link";
import { useState } from "react";

export default function ApplyForm() {
  const [churchName, setChurchName] = useState("");
  const [town, setTown] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ churchName, town, contactName, contactEmail, contactPhone, note, website }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) setDone(true);
      else setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="give-wrap">
      <main className="give">
        <header className="give-hero">
          <div className="give-top">
            <Link href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="give-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
            </Link>
          </div>
          <p className="give-eyebrow">FOR CHURCHES IN GHANA</p>
          <h1 className="give-thanks tight">{done ? "Thank you" : "Register your church"}</h1>
          <p className="give-lede">
            {done
              ? "We have your details and will contact you."
              : "Maizz is opening soon. Tell us about your church and we will get in touch. Nothing is charged and nothing goes live yet."}
          </p>
        </header>
        <section className="give-sheet">
          {done ? (
            <div className="give-form">
              <p>We will phone or email the contact person to confirm your church before anything is set up.</p>
              <Link className="give-button as-link" href="/">Back to the home page</Link>
            </div>
          ) : (
            <form
              className="give-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="give-group">
                <label className="give-label" htmlFor="a-church">Church name</label>
                <input id="a-church" className="give-input" value={churchName} onChange={(e) => setChurchName(e.target.value)} autoComplete="organization" maxLength={100} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="a-town">Town or city <span className="give-hint inline">(optional)</span></label>
                <input id="a-town" className="give-input" value={town} onChange={(e) => setTown(e.target.value)} autoComplete="address-level2" maxLength={100} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="a-name">Your name</label>
                <input id="a-name" className="give-input" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" maxLength={120} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="a-email">Your email</label>
                <input id="a-email" className="give-input" type="email" inputMode="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} autoComplete="email" maxLength={200} />
                <small className="give-hint">You will be invited to the church dashboard at this email.</small>
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="a-phone">Your phone</label>
                <input id="a-phone" className="give-input" type="tel" inputMode="tel" placeholder="055 123 4987" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="tel" maxLength={20} />
              </div>
              <div className="give-group">
                <label className="give-label" htmlFor="a-note">Anything we should know <span className="give-hint inline">(optional)</span></label>
                <textarea id="a-note" className="give-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ minHeight: 96, padding: 14, resize: "vertical" }} />
              </div>
              {/* A box people never see. Robots fill it in. */}
              <div style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }} aria-hidden="true">
                <label htmlFor="a-site">Leave this empty</label>
                <input id="a-site" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              {error && <p className="give-error" role="alert">{error}</p>}
              <button className="give-button" type="submit" disabled={busy || !churchName.trim() || !contactName.trim() || !contactEmail.trim() || !contactPhone.trim()}>
                {busy ? "Sending…" : "Send"}
              </button>
              <p className="give-hint">We only use these details to contact you about Maizz. We never share them.</p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
