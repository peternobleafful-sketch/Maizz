// Money in Maizz is always whole pesewas (1 GH₵ = 100 pesewas).
// No floating-point maths on money, ever. Cedi text is parsed digit by digit.

export type Pesewas = number;

const CEDI_TEXT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** Throws unless the value is a whole, safe, non-negative number of pesewas. */
export function assertPesewas(value: unknown, label = "amount"): asserts value is Pesewas {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number of pesewas (0 or more)`);
  }
}

/** Same as assertPesewas, but the value must also be above zero. */
export function assertPositivePesewas(value: unknown, label = "amount"): asserts value is Pesewas {
  assertPesewas(value, label);
  if (value === 0) {
    throw new Error(`${label} must be more than zero`);
  }
}

/** "12", "12.5" or "12.50" becomes 1200, 1250 or 1250. Anything else is rejected. */
export function cedisToPesewas(text: string): Pesewas {
  const match = CEDI_TEXT.exec(text.trim());
  if (!match) {
    throw new Error("Enter an amount in cedis with at most two decimal places, for example 25 or 25.50");
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

/** 1250 becomes "GH₵12.50". Large amounts get commas: 123456789 becomes "GH₵1,234,567.89". */
export function formatCedis(pesewas: Pesewas): string {
  assertPesewas(pesewas);
  const whole = Math.floor(pesewas / 100);
  const fraction = String(pesewas % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `GH₵${grouped}.${fraction}`;
}
