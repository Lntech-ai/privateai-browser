import { beforeEach, describe, expect, it, vi } from "vitest";

const hostOnlySession = {
  name: "SESSION",
  value: "abc",
  domain: "www.kalodata.com",
  path: "/",
  hostOnly: true,
};

vi.stubGlobal("chrome", {
  cookies: {
    getAllCookieStores: vi.fn(async () => [{ id: "0" }]),
    // Host-only cookies are NOT returned for domain filters — only url lookups.
    getAll: vi.fn(async (query: { url?: string; domain?: string }) => {
      if (query.url && query.url.includes("kalodata.com")) {
        return [hostOnlySession];
      }
      return [];
    }),
  },
  storage: {
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  },
  tabs: {
    get: vi.fn(async () => ({
      id: 42,
      status: "complete",
      url: "https://www.kalodata.com/explore",
    })),
    query: vi.fn(async () => []),
    create: vi.fn(async ({ url, active }: { url: string; active?: boolean }) => ({
      id: 42,
      url,
      active: !!active,
    })),
    update: vi.fn(),
    remove: vi.fn(),
  },
  tabGroups: {
    query: vi.fn(async () => []),
    update: vi.fn(),
    TAB_GROUP_ID_NONE: -1,
  },
  scripting: {
    executeScript: vi.fn(async () => [
      {
        result: {
          ok: true,
          status: 200,
          body_text: '{"success":true,"data":1}',
          json: { success: true, data: 1 },
          via: "page",
        },
      },
    ]),
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
    (chrome.cookies.getAll as ReturnType<typeof vi.fn>).mockClear();
    (chrome.tabs.create as ReturnType<typeof vi.fn>).mockClear();
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockClear();
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

  it("collectCookiesForHost finds host-only SESSION via url lookup", async () => {
    const { collectCookiesForHost } = await import("./browser-actions");
    const cookies = await collectCookiesForHost("kalodata.com");
    expect(cookies.some((c) => c.name === "SESSION" && c.value === "abc")).toBe(true);
    const calls = (chrome.cookies.getAll as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[0]?.url)).toBe(true);
  });

  it("getCookies ensures /explore in a background tab", async () => {
    const { getCookies } = await import("./browser-actions");
    const result = await getCookies({
      domain: "kalodata.com",
      names: ["SESSION"],
      ensure_url: "https://www.kalodata.com/explore",
    });
    expect(result.ok).toBe(true);
    expect(result.cookie).toContain("SESSION=abc");
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://www.kalodata.com/explore",
      active: false,
    });
  });

  it("bridgeFetch prefers in-page credentials fetch", async () => {
    const { bridgeFetch } = await import("./browser-actions");
    const result = await bridgeFetch({
      url: "https://www.kalodata.com/video/detail",
      method: "POST",
      body: { id: "1" },
      headers: { Accept: "application/json" },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect((result as { via?: string }).via).toBe("page");
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://www.kalodata.com/explore",
      active: false,
    });
  });

  it("bridgeFetch rejects non-allowlisted host before cookies", async () => {
    const { bridgeFetch } = await import("./browser-actions");
    await expect(bridgeFetch({ url: "https://example.com/" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
  });

  it("bridgeFetch falls back to service worker when page fetch fails", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { result: { ok: false, status: 0, error: "page boom", via: "page" } },
    ]);
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
    });
    expect(result.ok).toBe(true);
    expect((result as { via?: string }).via).toBe("service_worker");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).Cookie).toContain("SESSION=abc");
  });
});
