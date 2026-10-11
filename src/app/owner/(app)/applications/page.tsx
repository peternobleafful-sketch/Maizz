import type { Metadata } from "next";
import { requireOwnerSession } from "@/lib/ownerRuntime";
import ApplicationsClient from "./ApplicationsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Applications | Maizz owner", robots: { index: false } };

export default async function OwnerApplications() {
  const { data } = await requireOwnerSession();
  const apps = await data.listApplications();
  return (
    <>
      <div className="dash-head"><h1>Applications</h1><p>Churches that asked to join</p></div>
      <ApplicationsClient
        apps={apps.map((a) => ({
          id: a.id,
          churchName: a.churchName,
          town: a.town,
          contactName: a.contactName,
          contactEmail: a.contactEmail,
          contactPhone: a.contactPhone,
          note: a.note,
          status: a.status,
          createdAt: a.createdAt,
        }))}
      />
    </>
  );
}
