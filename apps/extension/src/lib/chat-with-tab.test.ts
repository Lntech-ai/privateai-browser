import { beforeEach, describe, expect, it, vi } from "vitest";

const rememberAgentTab = vi.fn(async (_tabId: number | null) => {});
const getOwuiAuth = vi.fn(async () => null as null | { baseUrl: string; token: string });
const findOwuiTab = vi.fn(async (): Promise<{ id: number; index: number; windowId: number } | undefined> => undefined);
const openOwuiTab = vi.fn(async () => ({ id: 20, index: 0, windowId: 1 }));

vi.mock("./browser-actions", () => ({
  rememberAgentTab: (tabId: number | null) => rememberAgentTab(tabId),
}));

vi.mock("./owui-storage", async () => {
  const actual = await vi.importActual<typeof import("./owui-storage")>("./owui-storage");
  return {
    ...actual,
    getOwuiAuth: () => getOwuiAuth(),
  };
});

vi.mock("./owui-session", () => ({
  findOwuiTab: () => findOwuiTab(),
  openOwuiTab: () => openOwuiTab(),
}));

describe("chatWithTab", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rememberAgentTab.mockResolvedValue(undefined);
    getOwuiAuth.mockResolvedValue({
      baseUrl: "https://owui.local",
      token: "tok",
    });
    findOwuiTab.mockResolvedValue({
      id: 20,
      index: 2,
      windowId: 1,
    });
  });

  it("requires Chrome Split View API", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn(),
        get: vi.fn(),
      },
      tabGroups: { TAB_GROUP_ID_NONE: -1 },
      scripting: { executeScript: vi.fn() },
      windows: { update: vi.fn() },
    });

    const { chatWithTab } = await import("./chat-with-tab");
    const result = await chatWithTab({ pageTabId: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Chrome 155/i);
  });

  it("requires a paired OWUI session", async () => {
    getOwuiAuth.mockResolvedValue(null);
    vi.stubGlobal("chrome", {
      tabs: {
        createSplit: vi.fn(async () => 99),
        query: vi.fn(),
        get: vi.fn(),
        unsplit: vi.fn(),
        move: vi.fn(),
        update: vi.fn(),
        ungroup: vi.fn(),
        SPLIT_VIEW_ID_NONE: -1,
      },
      tabGroups: { TAB_GROUP_ID_NONE: -1 },
      scripting: { executeScript: vi.fn() },
      windows: { update: vi.fn() },
    });

    vi.resetModules();
    vi.doMock("./browser-actions", () => ({
      rememberAgentTab: (tabId: number | null) => rememberAgentTab(tabId),
    }));
    vi.doMock("./owui-storage", async () => {
      const actual = await vi.importActual<typeof import("./owui-storage")>("./owui-storage");
      return { ...actual, getOwuiAuth: () => getOwuiAuth() };
    });
    vi.doMock("./owui-session", () => ({
      findOwuiTab: () => findOwuiTab(),
      openOwuiTab: () => openOwuiTab(),
    }));

    const { chatWithTab } = await import("./chat-with-tab");
    const result = await chatWithTab({ pageTabId: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Connect/i);
  });

  it("creates a split and remembers the page tab", async () => {
    const pageTab = {
      id: 10,
      index: 1,
      windowId: 1,
      pinned: false,
      groupId: -1,
      url: "https://example.com",
      splitViewId: -1,
    };
    const owuiTab = {
      id: 20,
      index: 2,
      windowId: 1,
      pinned: false,
      groupId: -1,
      url: "https://owui.local/",
      splitViewId: -1,
    };

    const createSplit = vi.fn(async () => 55);
    const get = vi.fn(async (id: number) => (id === 10 ? { ...pageTab } : { ...owuiTab }));
    const move = vi.fn(async (id: number, props: { index: number }) => ({
      ...(id === 10 ? pageTab : owuiTab),
      index: props.index,
    }));
    const update = vi.fn(async (id: number) => (id === 10 ? pageTab : owuiTab));
    const executeScript = vi.fn(async () => [{ result: { ok: true } }]);

    vi.stubGlobal("chrome", {
      tabs: {
        createSplit,
        get,
        move,
        update,
        unsplit: vi.fn(),
        ungroup: vi.fn(),
        SPLIT_VIEW_ID_NONE: -1,
      },
      tabGroups: { TAB_GROUP_ID_NONE: -1 },
      scripting: { executeScript },
      windows: { update: vi.fn() },
    });

    vi.resetModules();
    vi.doMock("./browser-actions", () => ({
      rememberAgentTab: (tabId: number | null) => rememberAgentTab(tabId),
    }));
    vi.doMock("./owui-storage", async () => {
      const actual = await vi.importActual<typeof import("./owui-storage")>("./owui-storage");
      return { ...actual, getOwuiAuth: () => getOwuiAuth() };
    });
    vi.doMock("./owui-session", () => ({
      findOwuiTab: () => findOwuiTab(),
      openOwuiTab: () => openOwuiTab(),
    }));

    getOwuiAuth.mockResolvedValue({ baseUrl: "https://owui.local", token: "tok" });
    findOwuiTab.mockResolvedValue(owuiTab);

    const { chatWithTab } = await import("./chat-with-tab");
    const result = await chatWithTab({ pageTabId: 10 });

    expect(result.ok).toBe(true);
    expect(createSplit).toHaveBeenCalled();
    expect(rememberAgentTab).toHaveBeenCalledWith(10);
    expect(executeScript).toHaveBeenCalled();
    expect(result.splitViewId).toBe(55);
  });
});
