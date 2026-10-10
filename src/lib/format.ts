import { GIFT_TYPE_LABELS } from "./checkout";

export const typeLabel = (t: string): string => (GIFT_TYPE_LABELS as Record<string, string>)[t] ?? (t === "project" ? "Project" : "Other");

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" });
const longFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });

export const shortDate = (iso: string): string => dateFmt.format(new Date(iso));
export const longDate = (iso: string): string => longFmt.format(new Date(iso));
export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
