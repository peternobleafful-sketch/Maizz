"use client";

import { useState } from "react";

export default function SystemTools() {
  const [busy, setBusy] = useState("");
  const [daily, setDaily] = useState("");
  const [books, setBooks] = useState("");
  const [reference, setReference] = useState("");
  const [removed, setRemoved] = useState("");
  const [removeError, setRemoveError] = useState("");

  async function runDaily() {
    setBusy("daily");
    setDaily("");
    try {
      const res = await fetch("/api/owner/reconcile", { method: "POST" });
      const data = (await res.json()) as { error?: string; summary?: Record<string, number | boolean> };
      if (res.status === 401) window.location.href = "/owner/sign-in";
      else if (!res.ok || !data.summary) setDaily(data.error ?? "Something went wrong.");
      else {
        const s = data.summary;
        setDaily(
          `Waiting gifts checked: ${s.checkedPending} (paid ${s.settledPaid}, failed ${s.settledFailed}, closed ${s.abandoned}, still waiting ${s.stillPending}). ` +
            `Paid gifts re-checked: ${s.paidChecked}. Closed gifts looked at again: ${s.closedChecked} (late payments found ${s.latePaymentsRecovered}). Problems: ${Number(s.mismatches) + Number(s.paidNotConfirmed) + Number(s.errors)}.` +
            (s.incomplete ? " Not everything fitted in one run." : ""),
        );
      }
    } catch {
      setDaily("Could not reach Maizz. Check your connection.");
    } finally {
      setBusy("");
    }
  }

  async function removeGiver() {
    if (!window.confirm("Remove this giver's name, phone number and email for good? This cannot be undone.")) return;
    setBusy("giver");
    setRemoved("");
    setRemoveError("");
    try {
      const res = await fetch("/api/owner/giver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 401) window.location.href = "/owner/sign-in";
      else if (!res.ok) setRemoveError(data.error ?? "Something went wrong.");
      else {
        setRemoved(data.message ?? "Done.");
        setReference("");
      }
    } catch {
      setRemoveError("Could not reach Maizz. Check your connection.");
    } finally {
      setBusy("");
    }
  }

  async function download() {
    setBusy("books");
    setBooks("");
    try {
      const res = await fetch("/api/owner/export", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/owner/sign-in";
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBooks(data.error ?? "Something went wrong.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `maizz-books-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setBooks("Downloaded. Keep the file somewhere safe, away from Supabase.");
    } catch {
      setBooks("Could not reach Maizz. Check your connection.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="dash-card">
        <h2>Daily check of the books</h2>
        <p className="dash-muted">Asks Paystack about every waiting gift and re-checks recent paid gifts. It also runs by itself every night.</p>
        <button className="dash-btn" type="button" disabled={busy !== ""} onClick={() => void runDaily()}>{busy === "daily" ? "Checking…" : "Run the daily check now"}</button>
        {daily && <p className="dash-ok" role="status">{daily}</p>}
      </section>
      <section className="dash-card">
        <h2>Copy of the books</h2>
        <p className="dash-muted">Downloads every gift and its status as a CSV, with no names, phone numbers or emails. Keep a copy away from Supabase until paid backups are on.</p>
        <button className="dash-btn" type="button" disabled={busy !== ""} onClick={() => void download()}>{busy === "books" ? "Preparing…" : "Download the books"}</button>
        {books && <p className="dash-ok" role="status">{books}</p>}
      </section>
      <section className="dash-card">
        <h2>Remove a giver's details</h2>
        <p className="dash-muted">For when a giver asks for their details to be deleted. Paste any one of their gift references. Their name, phone number and email are removed for good; the gifts and the church's totals stay the same.</p>
        <form className="give-form" onSubmit={(e) => { e.preventDefault(); void removeGiver(); }}>
          <div className="give-group">
            <label className="give-label" htmlFor="giver-ref">Gift reference</label>
            <input id="giver-ref" className="give-input" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <button className="give-button" type="submit" disabled={busy !== "" || reference.trim().length < 8}>{busy === "giver" ? "Removing…" : "Remove details"}</button>
        </form>
        {removed && <p className="dash-ok" role="status">{removed}</p>}
        {removeError && <p className="give-error" role="alert">{removeError}</p>}
      </section>
    </>
  );
}
