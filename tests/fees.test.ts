import { describe, expect, it } from "vitest";
import { addFees, MAIZZ_FEE_BPS, maizzFee, providerFee, PROVIDER_FEE_BPS } from "../src/lib/fees";

describe("rates", () => {
  it("are 1.95% to the provider and 1% to Maizz", () => {
    expect(PROVIDER_FEE_BPS).toBe(195);
    expect(MAIZZ_FEE_BPS).toBe(100);
  });
  it("are rounded up to the next pesewa", () => {
    expect(providerFee(10_000)).toBe(195);
    expect(providerFee(100)).toBe(2);
    expect(providerFee(1)).toBe(1);
    expect(maizzFee(10_000)).toBe(100);
    expect(maizzFee(150)).toBe(2); // 1.5 pesewas
    expect(maizzFee(1)).toBe(1);
  });
  it("reject bad amounts", () => {
    for (const bad of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => providerFee(bad)).toThrow();
      expect(() => maizzFee(bad)).toThrow();
    }
  });
});

describe("addFees", () => {
  it("gives known answers, worked out by hand", () => {
    // GH₵100: Maizz 100p, so 10,100p must remain after the provider's cut; 10,301 - ceil(200.87) = 10,100.
    expect(addFees(10_000)).toEqual({
      giftPesewas: 10_000,
      feePesewas: 301,
      totalPesewas: 10_301,
      maizzFeePesewas: 100,
      providerFeePesewas: 201,
    });
    // GH₵1: Maizz 1p, 101p must remain; 104 - ceil(2.03) = 101.
    expect(addFees(100)).toMatchObject({ feePesewas: 4, totalPesewas: 104, maizzFeePesewas: 1, providerFeePesewas: 3 });
  });

  it("always leaves the church the gift and Maizz its fee, and never overcharges by more than a pesewa", () => {
    for (let gift = 1; gift <= 60_000; gift++) {
      const f = addFees(gift);
      const left = f.totalPesewas - providerFee(f.totalPesewas);
      expect(left).toBeGreaterThanOrEqual(gift + f.maizzFeePesewas);
      expect(left - gift - f.maizzFeePesewas).toBeLessThanOrEqual(1);
      expect(f.totalPesewas).toBe(gift + f.feePesewas);
      expect(f.feePesewas).toBeGreaterThanOrEqual(f.maizzFeePesewas);
      // smallest total that works: one pesewa less would not cover it
      expect(f.totalPesewas - 1 - providerFee(f.totalPesewas - 1)).toBeLessThan(gift + f.maizzFeePesewas);
    }
  });

  it("stays exact for very large gifts", () => {
    const gift = 100_000_000_000; // GH₵1 billion
    const f = addFees(gift);
    expect(Number.isSafeInteger(f.totalPesewas)).toBe(true);
    expect(f.totalPesewas - providerFee(f.totalPesewas)).toBeGreaterThanOrEqual(gift + f.maizzFeePesewas);
  });

  it("can charge no Maizz fee, as the first version did", () => {
    expect(addFees(10_000, { maizzBps: 0 })).toMatchObject({ feePesewas: 199, totalPesewas: 10_199, maizzFeePesewas: 0 });
  });

  it("rejects bad gifts and rates", () => {
    expect(() => addFees(0)).toThrow();
    expect(() => addFees(10.5)).toThrow();
    expect(() => addFees(100, { providerBps: 10_000 })).toThrow();
    expect(() => addFees(100, { maizzBps: -1 })).toThrow();
  });
});
