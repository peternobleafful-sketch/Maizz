"use client";

export default function PrintButton() {
  return (
    <button className="dash-btn" onClick={() => window.print()}>
      Print this card
    </button>
  );
}
