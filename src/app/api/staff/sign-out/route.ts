import { staffHandlers } from "@/lib/staffHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = staffHandlers("church").signOut;
