import type { AuditLog } from "./audit";

export interface CspReport {
  directive: string;
  blocked: string;
  page: string;
}

const MAX = 10_000;

function origin(v: unknown): string {
  if (typeof v !== "string" || v === "") return "unknown";
  if (v === "inline" || v === "eval" || v === "data" || v === "self") return v;
  try {
    const u = new URL(v);
    return u.protocol === "data:" ? "data" : u.origin + u.pathname;
  } catch {
    return v.slice(0, 40).replace(/[^\w.:/-]/g, "");
  }
}

function pathOnly(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  try {
    return new URL(v).pathname.slice(0, 100);
  } catch {
    return "unknown";
  }
}

/** Reads the two report formats browsers send. Returns only the rule, the blocked address and the page path. */
export function readCspReport(text: string): CspReport | null {
  if (text.length === 0 || text.length > MAX) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  // Older format: { "csp-report": {...} }. Newer: [ { type: "csp-violation", body: {...} } ].
  let body: unknown;
  if (Array.isArray(json)) body = (json.find((x) => typeof x === "object" && x !== null && (x as { type?: unknown }).type === "csp-violation") as { body?: unknown } | undefined)?.body;
  else if (typeof json === "object" && json !== null) body = (json as { "csp-report"?: unknown })["csp-report"];
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const directive = b["effective-directive"] ?? b.effectiveDirective ?? b["violated-directive"] ?? b.violatedDirective;
  if (typeof directive !== "string") return null;
  return {
    directive: directive.split(" ")[0]!.slice(0, 40).replace(/[^\w-]/g, ""),
    blocked: origin(b["blocked-uri"] ?? b.blockedURL),
    page: pathOnly(b["document-uri"] ?? b.documentURL),
  };
}

/** At most 20 reports per source per hour are kept, so a noisy or hostile visitor cannot fill the audit log. */
export const CSP_REPORTS_PER_HOUR = 20;

export const CSP_REPORTS_PER_DAY = 200;

export async function saveCspReport(audit: AuditLog, sourceKey: string, report: CspReport): Promise<boolean> {
  try {
    if ((await audit.hit({ action: "csp.report", sourceKey, minutes: 60 })) > CSP_REPORTS_PER_HOUR) return false;
    // A day-wide ceiling for everyone together, so many different visitors cannot fill the permanent log either.
    if ((await audit.hit({ action: "csp.report_all", sourceKey: "all", minutes: 24 * 60 })) > CSP_REPORTS_PER_DAY) return false;
    await audit.record({
      actor: "browser",
      action: "csp.report",
      target: `${report.directive} ${report.blocked}`.slice(0, 200),
      outcome: "denied",
      sourceKey,
      detail: { page: report.page },
    });
    return true;
  } catch {
    return false; // a report that cannot be saved is not worth an error
  }
}
