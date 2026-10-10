"use client";

export default function SignOutButton() {
  return (
    <button
      className="give-secondary"
      onClick={async () => {
        try {
          await fetch("/api/staff/sign-out", { method: "POST" });
        } finally {
          window.location.assign("/church/sign-in");
        }
      }}
    >
      Sign out
    </button>
  );
}
