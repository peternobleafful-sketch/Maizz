import { describe, expect, it } from "vitest";
import { addFees, providerFee, PROVIDER_FEE_BPS } from "../src/lib/fees";

describe("provider fee", () => {
  it("is 1.95% rounded up", () => {
    expect(PROVIDER_FEE_BPS).toBe(195);
    expect(providerFee(10_000)).toBe(195);
    expect(providerFee(100)).toBe(2); // 1.95 pesewas rounds up
    expect(providerFee(1)).toBe(1);
  });
  it("rejects bad amounts", () => {
    for (const bad of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => providerFee(bad)).toThrow();
  });
});

describe("addFees", () => {
  it("gives known answers", () => {
    expect(addFees(10_000)).toEqual({ giftPesewas: 10_000, feePesewas: 199, totalPesewas: 10_199 });
    expect(addFees(100)).toEqual({ giftPesewas: 100, feePesewas: 2, totalPesewas: 102 });
  });

  it("always leaves the church at least the gift, and never overcharges by more than a pesewa", () => {
    for (let gift = 1; gift <= 60_000; gift++) {
      const { feePesewas, totalPesewas } = addFees(gift);
      const left = totalPesewas - providerFee(totalPesewas);
      expect(left).toBeGreaterThanOrEqual(gift);
      expect(left - gift).toBeLessThanOrEqual(1);
      expect(totalPesewas).toBe(gift + feePesewas);
      // minimal: one pesewa less would not cover it
      expect(totalPesewas - 1 - providerFee(totalPesewas - 1)).toBeLessThan(gift);
    }
  });

  it("stays exact for very large gifts", () => {
    const gift = 100_000_000_000; // GH₵1 billion
    const { totalPesewas } = addFees(gift);
    expect(Number.isSafeInteger(totalPesewas)).toBe(true);
    expect(totalPesewas - providerFee(totalPesewas)).toBeGreaterThanOrEqual(gift);
  });

  it("rejects bad gifts and rates", () => {
    expect(() => addFees(0)).toThrow();
    expect(() => addFees(10.5)).toThrow();
    expect(() => addFees(100, 10_000)).toThrow();
    expect(() => addFees(100, -1)).toThrow();
  });
});
