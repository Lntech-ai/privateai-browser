import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  cookies: {
    getAll: vi.fn(async () => [
      { name: "SESSION", value: "abc", domain: ".kalodata.com", path: "/" },
    ]),
  },
  storage: {
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  },
  tabs: {
    get: vi.fn(),
    query: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  tabGroups: {
    query: vi.fn(async () => []),
    update: vi.fn(),
    TAB_GROUP_ID_NONE: -1,
  },
  debugger: {
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(),
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe("bridge allowlist + fetch", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("assertAllowedUrl accepts kalodata https hosts", async () => {
    const { assertAllowedUrl } = await import("./browser-actions");
    expect(assertAllowedUrl("https://www.kalodata.com/api/x").hostname).toBe(
      "www.kalodata.com",
    );
    expect(assertAllowedUrl("https://kalodata.com/").hostname).toBe("kalodata.com");
    expect(assertAllowedUrl("https://api.kalodata.com/v1").hostname).toBe(
      "api.kalodata.com",
    );
  });

  it("assertAllowedUrl rejects non-allowlisted or non-https", async () => {
    const { assertAllowedUrl } = await import("./browser-actions");
    expect(() => assertAllowedUrl("http://www.kalodata.com/")).toThrow(/https/i);
    expect(() => assertAllowedUrl("https://evil.com/")).toThrow(/not allowed/i);
    expect(() => assertAllowedUrl("https://kalodata.com.evil.com/")).toThrow(
      /not allowed/i,
    );
  });

  it("sanitizeBridgeHeaders strips Cookie/Host overrides", async () => {
    const { sanitizeBridgeHeaders } = await import("./browser-actions");
    const headers = sanitizeBridgeHeaders({
      Cookie: "evil=1",
      Host: "evil.com",
      Accept: "application/json",
      "X-Custom": "ok",
    });
    expect(headers).toEqual({ Accept: "application/json", "X-Custom": "ok" });
  });

  it("bridgeFetch rejects non-allowlisted host before cookies", async () => {
    const { bridgeFetch } = await import("./browser-actions");
    await expect(bridgeFetch({ url: "https://example.com/" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
  });

  it("bridgeFetch returns status for allowlisted URL", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, data: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { bridgeFetch } = await import("./browser-actions");
    const result = await bridgeFetch({
      url: "https://www.kalodata.com/video/detail",
      method: "POST",
      body: { id: "1" },
      headers: { Accept: "application/json" },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect((result as { json?: { success?: boolean } }).json?.success).toBe(true);
    expect(chrome.cookies.getAll).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).Cookie).toContain("SESSION=abc");
  });

  it("bridgeFetch rejects off-allowlist redirect Location", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.com/steal" },
        });
      }),
    );
    const { bridgeFetch } = await import("./browser-actions");
    const result = await bridgeFetch({
      url: "https://www.kalodata.com/api/x",
    });
    expect(result.ok).toBe(false);
    expect(String((result as { error?: string }).error || "")).toMatch(/not allowlisted/i);
  });
});
