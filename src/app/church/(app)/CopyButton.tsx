"use client";

import { useState } from "react";

export default function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="dash-btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // The link is shown in full next to the button, so it can be copied by hand.
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
