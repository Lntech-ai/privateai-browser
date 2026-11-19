import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
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

  it("bridgeFetch uses in-page credentials fetch only", async () => {
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

  it("bridgeFetch rejects non-allowlisted host before opening a tab", async () => {
    const { bridgeFetch } = await import("./browser-actions");
    await expect(bridgeFetch({ url: "https://example.com/" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("bridgeFetch returns the page error when in-tab fetch fails", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { result: { ok: false, status: 0, error: "page boom", via: "page" } },
    ]);

    const { bridgeFetch } = await import("./browser-actions");
    const result = await bridgeFetch({
      url: "https://www.kalodata.com/video/detail",
      method: "POST",
      body: { id: "1" },
    });
    expect(result.ok).toBe(false);
    expect((result as { via?: string }).via).toBe("page");
    expect((result as { error?: string }).error).toBe("page boom");
  });
});
