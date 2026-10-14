import { describe, expect, it } from "vitest";
import { publicBaseUrl } from "../src/lib/config";

describe("publicBaseUrl (C3)", () => {
  it("accepts a plain https address and tidies the end", () => {
    expect(publicBaseUrl({ MAIZZ_PUBLIC_URL: "https://maizz-nu.vercel.app" })).toBe("https://maizz-nu.vercel.app");
    expect(publicBaseUrl({ MAIZZ_PUBLIC_URL: " https://maizz-nu.vercel.app/// " })).toBe("https://maizz-nu.vercel.app");
  });
  it("allows http only for the developer's own computer", () => {
    expect(publicBaseUrl({ MAIZZ_PUBLIC_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(publicBaseUrl({ MAIZZ_PUBLIC_URL: "http://maizz.example" })).toBeNull();
  });
  it("is null when missing or odd, never a guess from the request", () => {
    for (const v of [undefined, "", "  ", "maizz.app", "https://m.test/path", "https://m.test/?a=1", "https://u:p@m.test", "javascript:alert(1)", "https://"]) {
      expect(publicBaseUrl({ MAIZZ_PUBLIC_URL: v })).toBeNull();
    }
  });
});
