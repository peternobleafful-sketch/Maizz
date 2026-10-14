import { describe, expect, it } from "vitest";
import { removalDecision } from "../src/lib/teamRules";
import type { StaffUser } from "../src/lib/staff";

const u = (id: string, role: StaffUser["role"], status: StaffUser["status"] = "active"): StaffUser => ({
  id, churchId: "c", email: `${id}@c.org`, fullName: id, role, status, passwordHash: "x", failedAttempts: 0, lockedUntil: null,
});

describe("removing a church owner (C6)", () => {
  it("is refused when it would leave only one active owner", () => {
    expect(removalDecision([u("a", "owner"), u("b", "owner")], "b")).toBe("last_other_owner");
  });
  it("is allowed when two owners remain", () => {
    expect(removalDecision([u("a", "owner"), u("b", "owner"), u("c", "owner")], "c")).toBe("ok");
  });
  it("only counts active owners", () => {
    expect(removalDecision([u("a", "owner"), u("b", "owner"), u("c", "owner", "disabled")], "b")).toBe("last_other_owner");
    expect(removalDecision([u("a", "owner"), u("b", "owner"), u("c", "owner", "invited")], "b")).toBe("last_other_owner");
  });
  it("lets anyone else go, and an owner who never became active", () => {
    expect(removalDecision([u("a", "owner"), u("f", "finance"), u("v", "viewer")], "f")).toBe("ok");
    expect(removalDecision([u("a", "owner"), u("b", "owner", "invited")], "b")).toBe("ok");
    expect(removalDecision([u("a", "owner")], "missing")).toBe("ok");
  });
});
