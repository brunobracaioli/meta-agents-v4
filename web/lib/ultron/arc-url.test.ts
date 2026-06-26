import { describe, expect, it } from "vitest";
import { isB2TechUrl } from "./arc-url";

describe("isB2TechUrl", () => {
  it("accepts https apex and subdomains of b2tech.io", () => {
    expect(isB2TechUrl("https://b2tech.io")).toBe(true);
    expect(isB2TechUrl("https://promo.b2tech.io")).toBe(true);
    expect(isB2TechUrl("https://imersao-agencia.b2tech.io/path?x=1")).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(isB2TechUrl("http://promo.b2tech.io")).toBe(false);
    expect(isB2TechUrl("javascript:alert(1)")).toBe(false);
    expect(isB2TechUrl("data:text/html,<script>")).toBe(false);
  });

  it("rejects look-alike and foreign hosts (no suffix spoofing)", () => {
    expect(isB2TechUrl("https://b2tech.io.evil.com")).toBe(false);
    expect(isB2TechUrl("https://evilb2tech.io")).toBe(false); // endsWith without the dot boundary
    expect(isB2TechUrl("https://example.com")).toBe(false);
    expect(isB2TechUrl("https://promo.b2tech.io.attacker.net")).toBe(false);
  });

  it("rejects empty / nullish / malformed", () => {
    expect(isB2TechUrl(null)).toBe(false);
    expect(isB2TechUrl(undefined)).toBe(false);
    expect(isB2TechUrl("")).toBe(false);
    expect(isB2TechUrl("not a url")).toBe(false);
  });
});
