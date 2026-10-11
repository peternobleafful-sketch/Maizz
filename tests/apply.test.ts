import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewApplication } from "../src/lib/ownerData";
import { FakeAudit } from "./helpers";

const state = {
  audit: new FakeAudit(),
  saved: [] as NewApplication[],
  waiting: 0,
  alerts: [] as string[],
  failSave: false,
};

vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("../src/lib/audit")>()), getAudit: () => state.audit }));
vi.mock("@/lib/notifyRuntime", () => ({ getNotifier: () => ({ paid: async () => undefined, alert: async (k: string) => void state.alerts.push(k) }) }));
vi.mock("@/lib/ownerRuntime", () => ({
  getOwnerData: () => ({
    listApplications: async () => Array.from({ length: state.waiting }, () => ({ status: "new" })),
    createApplication: async (a: NewApplication) => {
      if (state.failSave) throw new Error("db down");
      state.saved.push(a);
      return "id";
    },
  }),
}));

const { POST } = await import("../src/app/api/apply/route");

const good = { churchName: "  Grace   Chapel ", town: "Accra", contactName: "Ama Boateng", contactEmail: "Ama@Grace.org", contactPhone: "055 123 4987", note: "Hello", website: "" };

const send = (body: unknown, origin: string | null = "https://maizz.test") =>
  POST(
    new Request("https://maizz.test/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.audit = new FakeAudit();
  state.saved = [];
  state.waiting = 0;
  state.alerts = [];
  state.failSave = false;
});

describe("POST /api/apply", () => {
  it("saves a tidy application, tells the owner, and records only that one happened", async () => {
    const res = await send(good);
    expect(res.status).toBe(200);
    expect(state.saved).toEqual([
      { churchName: "Grace Chapel", town: "Accra", contactName: "Ama Boateng", contactEmail: "ama@grace.org", contactPhone: "0551234987", note: "Hello" },
    ]);
    expect(state.alerts).toEqual(["church_application"]);
    expect(state.audit.actions()).toEqual(["church.apply"]);
    expect(JSON.stringify(state.audit.entries)).not.toMatch(/Grace|ama@|0551234987/i);
  });

  it("refuses calls that do not come from our own pages", async () => {
    expect((await send(good, "https://evil.test")).status).toBe(403);
    expect((await send(good, null)).status).toBe(403);
    expect(state.saved).toHaveLength(0);
  });

  it("answers robots normally but saves nothing", async () => {
    const res = await send({ ...good, website: "http://spam.test" });
    expect(res.status).toBe(200);
    expect(state.saved).toHaveLength(0);
    expect(state.alerts).toHaveLength(0);
  });

  it("refuses bad details with plain messages", async () => {
    const bad: Record<string, unknown>[] = [
      { churchName: "A" },
      { churchName: "x".repeat(150) },
      { contactName: "" },
      { contactEmail: "nope" },
      { contactPhone: "123" },
      { contactPhone: "call me" },
      { note: "n".repeat(600) },
      { town: "t".repeat(300) },
    ];
    for (const over of bad) {
      const res = await send({ ...good, ...over });
      expect(res.status, JSON.stringify(over).slice(0, 40)).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
    }
    expect(state.saved).toHaveLength(0);
  });

  it("stops one connection after three applications a day", async () => {
    for (let i = 0; i < 3; i += 1) expect((await send(good)).status).toBe(200);
    expect((await send(good)).status).toBe(429);
    expect(state.saved).toHaveLength(3);
  });

  it("pauses when too many are waiting", async () => {
    state.waiting = 100;
    expect((await send(good)).status).toBe(503);
    expect(state.saved).toHaveLength(0);
  });

  it("does not leak why it failed", async () => {
    state.failSave = true;
    const res = await send(good);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/db down/);
  });
});
