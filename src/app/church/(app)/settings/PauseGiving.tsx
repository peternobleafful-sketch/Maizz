"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PauseGiving({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function set(next: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/church/giving", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: next }) });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? "Something went wrong. Try again.");
      else router.refresh();
    } catch {
      setError("Could not reach Maizz. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-pause">
      <p className="dash-muted">
        {paused
          ? "Giving is paused. People who open your link see a short message and cannot give. Gifts already in progress still finish."
          : "Pausing stops new gifts straight away. People who open your link see a short message. You can resume at any time."}
      </p>
      <button className={paused ? "dash-btn" : "dash-btn ghost"} type="button" disabled={busy} onClick={() => set(!paused)}>
        {busy ? "Please wait…" : paused ? "Resume giving" : "Pause giving"}
      </button>
      {error ? <p className="give-error" role="alert">{error}</p> : null}
    </div>
  );
}
