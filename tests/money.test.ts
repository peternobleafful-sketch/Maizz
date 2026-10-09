import { describe, expect, it } from "vitest";
import {
  assertPesewas,
  assertPositivePesewas,
  cedisToPesewas,
  formatCedis,
} from "../src/lib/money";

describe("cedisToPesewas", () => {
  it("converts whole cedis", () => {
    expect(cedisToPesewas("25")).toBe(2500);
  });

  it("converts one and two decimal places exactly", () => {
    expect(cedisToPesewas("25.5")).toBe(2550);
    expect(cedisToPesewas("25.50")).toBe(2550);
    expect(cedisToPesewas("0.10")).toBe(10);
    expect(cedisToPesewas("0.1")).toBe(10);
    expect(cedisToPesewas("19.99")).toBe(1999);
  });

  it("has no floating-point drift on awkward amounts", () => {
    // 0.1 + 0.2 style traps: 1.15 * 100 is 114.99999999999999 in floating point.
    expect(cedisToPesewas("1.15")).toBe(115);
    expect(cedisToPesewas("4.35")).toBe(435);
    expect(cedisToPesewas("8.20")).toBe(820);
  });

  it("rejects anything that is not plain cedis with up to two decimals", () => {
    for (const bad of ["", " ", "abc", "-5", "12.505", "12.", ".5", "1,000", "1e3", "GH₵5", "5 cedis"]) {
      expect(() => cedisToPesewas(bad), `"${bad}"`).toThrow();
    }
  });
});

describe("formatCedis", () => {
  it("formats with two decimals", () => {
    expect(formatCedis(0)).toBe("GH₵0.00");
    expect(formatCedis(5)).toBe("GH₵0.05");
    expect(formatCedis(1250)).toBe("GH₵12.50");
  });

  it("groups thousands with commas", () => {
    expect(formatCedis(123456789)).toBe("GH₵1,234,567.89");
    expect(formatCedis(100000)).toBe("GH₵1,000.00");
  });

  it("round-trips with cedisToPesewas", () => {
    for (const p of [1, 99, 100, 101, 1999, 250000, 99999999]) {
      expect(cedisToPesewas(formatCedis(p).replace("GH₵", "").replace(/,/g, ""))).toBe(p);
    }
  });
});

describe("assertPesewas", () => {
  it("accepts whole non-negative numbers", () => {
    expect(() => assertPesewas(0)).not.toThrow();
    expect(() => assertPesewas(1250)).not.toThrow();
  });

  it("rejects decimals, negatives, NaN, strings and unsafe numbers", () => {
    for (const bad of [12.5, -1, Number.NaN, Infinity, "100", null, undefined, 2 ** 53]) {
      expect(() => assertPesewas(bad), String(bad)).toThrow();
    }
  });

  it("assertPositivePesewas also rejects zero", () => {
    expect(() => assertPositivePesewas(0)).toThrow();
    expect(() => assertPositivePesewas(1)).not.toThrow();
  });
});
