import FindChurch from "./FindChurch";

export default function NotFound() {
  return (
    <div className="give-wrap">
      <main className="give">
        <header className="give-hero">
          <div className="give-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="give-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
          </div>
          <h1 className="give-thanks">We cannot find that page</h1>
          <p className="give-lede">The link may have a typo. Check it with your church, or enter the link again below.</p>
        </header>
        <section className="give-sheet">
          <FindChurch />
        </section>
      </main>
    </div>
  );
}
