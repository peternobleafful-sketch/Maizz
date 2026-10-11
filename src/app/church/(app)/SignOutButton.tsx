"use client";

export default function SignOutButton({ area = "church" }: { area?: "church" | "owner" }) {
  const api = area === "owner" ? "/api/owner" : "/api/staff";
  const home = area === "owner" ? "/owner" : "/church";
  return (
    <button
      className="give-secondary"
      onClick={async () => {
        try {
          await fetch(`${api}/sign-out`, { method: "POST" });
        } finally {
          window.location.assign(`${home}/sign-in`);
        }
      }}
    >
      Sign out
    </button>
  );
}
