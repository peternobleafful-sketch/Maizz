import Link from "next/link";
import "../../app/public.css";

// The floating dark menu at the top of every public page.
export default function SiteNav() {
  return (
    <div className="pub-nav-wrap">
      <nav className="pub-nav" aria-label="Main">
        <Link href="/" className="pub-nav-logo" aria-label="Maizz home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
        </Link>
        <div className="pub-nav-links">
          <Link href="/#how">How it works</Link>
          <Link href="/#fees">Fees</Link>
          <Link href="/#why">Why Maizz</Link>
          <Link href="/#security">Security</Link>
        </div>
        <div className="pub-nav-actions">
          <Link className="pub-btn ghost" href="/church/sign-in">Sign in</Link>
          <Link className="pub-btn blue" href="/register">
            <span className="long">Register your church</span>
            <span className="short">Register</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
