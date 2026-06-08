import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const SECRET = "0x-secret";
const TOKEN = "cf-token";

function mockFetch(impl: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("returns false for an empty token without calling the network", async () => {
    const spy = vi.fn();
    mockFetch(spy as unknown as typeof fetch);
    const ok = await verifyTurnstile("", SECRET);
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns true when siteverify reports success", async () => {
    mockFetch(
      (async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    expect(await verifyTurnstile(TOKEN, SECRET)).toBe(true);
  });

  it("returns false when siteverify reports failure", async () => {
    mockFetch(
      (async () =>
        new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
          { status: 200 },
        )) as unknown as typeof fetch,
    );
    expect(await verifyTurnstile(TOKEN, SECRET)).toBe(false);
  });

  it("fails closed on a non-OK HTTP response", async () => {
    mockFetch(
      (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    );
    expect(await verifyTurnstile(TOKEN, SECRET)).toBe(false);
  });

  it("fails closed when fetch throws", async () => {
    mockFetch(
      (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    expect(await verifyTurnstile(TOKEN, SECRET)).toBe(false);
  });

  it("forwards secret, token and remoteip to siteverify", async () => {
    const calls: { url: string; body: string }[] = [];
    mockFetch(
      (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    await verifyTurnstile(TOKEN, SECRET, "203.0.113.7");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("secret")).toBe(SECRET);
    expect(params.get("response")).toBe(TOKEN);
    expect(params.get("remoteip")).toBe("203.0.113.7");
  });

  it("omits remoteip when it is the 'unknown' sentinel", async () => {
    let sentBody = "";
    mockFetch(
      (async (_url: string, init: RequestInit) => {
        sentBody = String(init.body);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    await verifyTurnstile(TOKEN, SECRET, "unknown");
    expect(new URLSearchParams(sentBody).has("remoteip")).toBe(false);
  });
});
