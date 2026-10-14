import { describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret,
  normaliseRecoveryCode, otpauthUri, totpCode, totpStep, verifyTotp,
} from "../src/lib/totp";

// RFC 6238 test vectors (SHA-1, secret "12345678901234567890", 8 digits there; we use the last 6).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("authenticator codes", () => {
  it("match the RFC 6238 test values", () => {
    expect(totpCode(RFC_SECRET, totpStep(59_000))).toBe("287082");
    expect(totpCode(RFC_SECRET, totpStep(1_111_111_109_000))).toBe("081804");
    expect(totpCode(RFC_SECRET, totpStep(1_234_567_890_000))).toBe("005924");
    expect(totpCode(RFC_SECRET, totpStep(2_000_000_000_000))).toBe("279037");
  });

  it("round-trips base32", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(() => base32Decode("0189")).toThrow();
  });

  it("accepts the current code and one step either side, nothing further", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const at = (d: number) => totpCode(RFC_SECRET, step + d);
    expect(verifyTotp(RFC_SECRET, at(0), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, at(-1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, at(1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, at(-2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(2), now)).toBeNull();
  });

  it("works once: a step already used is refused", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step)).toBeNull();
  });

  it("ignores spaces and refuses anything that is not six digits", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, totpStep(now));
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", null, 123456, undefined]) expect(verifyTotp(RFC_SECRET, bad, now)).toBeNull();
  });

  it("makes the link an authenticator app reads", () => {
    const u = otpauthUri("isaac@maizz.test", "ABCDEFGH");
    expect(u).toBe("otpauth://totp/Maizz%3Aisaac%40maizz.test?secret=ABCDEFGH&issuer=Maizz&algorithm=SHA1&digits=6&period=30");
  });
});

describe("secret at rest", () => {
  const pepper = "p".repeat(40);
  it("encrypts so the stored text does not contain the secret, and decrypts with the same key only", () => {
    const secret = newTotpSecret();
    const stored = encryptSecret(secret, pepper);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, pepper)).toBe(secret);
    expect(decryptSecret(stored, "q".repeat(40))).toBeNull();
    expect(decryptSecret(stored.slice(0, -3) + "AAA", pepper)).toBeNull();
    expect(decryptSecret("junk", pepper)).toBeNull();
    expect(encryptSecret(secret, pepper)).not.toBe(stored); // fresh nonce each time
  });
});

describe("recovery codes", () => {
  it("makes eight different, easy-to-read codes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("accepts however it is typed", () => {
    expect(normaliseRecoveryCode("abcd-efgh")).toBe("ABCD-EFGH");
    expect(normaliseRecoveryCode(" abcdefgh ")).toBe("ABCD-EFGH");
    expect(normaliseRecoveryCode("ABCD-EFG0")).toBeNull(); // 0 is not used
    expect(normaliseRecoveryCode("123456")).toBeNull();
    expect(normaliseRecoveryCode(5)).toBeNull();
  });
  it("stores only a keyed hash", () => {
    const h = hashRecoveryCode("ABCD-EFGH", "p".repeat(40));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("ABCD");
    expect(hashRecoveryCode("ABCD-EFGH", "q".repeat(40))).not.toBe(h);
  });
});
