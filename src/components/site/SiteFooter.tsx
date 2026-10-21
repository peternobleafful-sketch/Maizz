import Link from "next/link";

// Contact is the register form until Maizz has its own mailbox. No email address is shown on purpose.
export default function SiteFooter({ onRegisterPage = false }: { onRegisterPage?: boolean }) {
  return (
    <footer className="pub-foot">
      <div className="pub-foot-inner">
        <div className="pub-foot-top">
          <h2>Contact us</h2>
          <p>
            Register your church and we will phone or email you.{" "}
            {onRegisterPage ? null : <Link href="/register">Go to the form</Link>}
          </p>
        </div>
        <div className="pub-foot-grid">
          <div className="pub-foot-cols">
            <div>
              <h3>Product</h3>
              <Link href="/#how">How it works</Link>
              <Link href="/#fees">Fees</Link>
              <Link href="/#why">Why Maizz</Link>
              <Link href="/#security">Security</Link>
            </div>
            <div>
              <h3>For churches</h3>
              <Link href="/register">Register your church</Link>
              <Link href="/church/sign-in">Church sign-in</Link>
            </div>
            <div>
              <h3>For givers</h3>
              <Link href="/#find">Find your church</Link>
            </div>
          </div>
          <div className="pub-foot-note">
            <h3>Giving to your church?</h3>
            <p>Ask your church office for its Maizz giving link or QR code. You pay from your own phone with MTN, Vodafone or AirtelTigo.</p>
          </div>
        </div>
        <p className="pub-foot-small">&copy; {new Date().getFullYear()} Maizz. Giving for churches in Ghana.</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="pub-foot-word" src="/brand/maizz-logo-ink.png" alt="" width={1101} height={296} aria-hidden="true" />
    </footer>
  );
}
