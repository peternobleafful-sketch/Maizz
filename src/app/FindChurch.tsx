"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Sends the giver to a church's giving page. The page itself decides whether the church exists.
export default function FindChurch() {
  const router = useRouter();
  const [text, setText] = useState("");
  const slug = text.trim().toLowerCase().replace(/^.*\/give\//, "").replace(/[^a-z0-9-]/g, "");

  return (
    <form
      className="give-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (slug) router.push(`/give/${slug}`);
      }}
    >
      <div className="give-group">
        <label className="give-label" htmlFor="church-link">Church giving link</label>
        <div className="find-box">
          <span>/give/</span>
          <input
            id="church-link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="church-name"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
      <button className="give-button" type="submit" disabled={!slug}>Find my church</button>
      <p className="give-hint centre">Still stuck? Ask your church office for a new link or QR code.</p>
    </form>
  );
}
