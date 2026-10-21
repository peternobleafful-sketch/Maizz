import Link from "next/link";
import FindChurch from "./FindChurch";
import SiteFooter from "@/components/site/SiteFooter";
import SiteNav from "@/components/site/SiteNav";

export default function NotFound() {
  return (
    <div className="pub">
      <SiteNav />
      <main className="pub-lost">
        <p className="pub-chip">Page not found</p>
        <h1>We cannot find that page</h1>
        <p className="pub-lede">The link may have a typo. Check it with your church, or enter the link again below.</p>
        <div className="pub-card">
          <FindChurch />
        </div>
        <Link className="pub-btn line big" href="/">Back to the home page</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
