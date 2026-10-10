/** Turns "+233 55 123 4987", "233551234987" or "055 123 4987" into "0551234987". Returns null if it is not a Ghana number. */
export function normaliseGhanaPhone(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, "");
  let local: string;
  if (/^\+233\d{9}$/.test(digits)) local = `0${digits.slice(4)}`;
  else if (/^233\d{9}$/.test(digits)) local = `0${digits.slice(3)}`;
  else local = digits;
  return /^0\d{9}$/.test(local) ? local : null;
}
