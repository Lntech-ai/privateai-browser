import { describe, expect, it, vi } from "vitest";

import {
  browserSupportsSplitView,
  isChatWithTabPageUrl,
  isSplitViewApiAvailable,
} from "./agent-overlay";

describe("isSplitViewApiAvailable", () => {
  it("returns true when createSplit is a function", () => {
    expect(isSplitViewApiAvailable({ createSplit: async () => 1 })).toBe(true);
  });

  it("returns false when createSplit is missing", () => {
    expect(isSplitViewApiAvailable({})).toBe(false);
    expect(isSplitViewApiAvailable({ createSplit: undefined })).toBe(false);
  });

  it("browserSupportsSplitView reads global chrome.tabs", () => {
    vi.stubGlobal("chrome", { tabs: { createSplit: async () => 1 } });
    expect(browserSupportsSplitView()).toBe(true);
    vi.stubGlobal("chrome", { tabs: {} });
    expect(browserSupportsSplitView()).toBe(false);
  });
});

describe("isChatWithTabPageUrl", () => {
  it("accepts http(s) pages", () => {
    expect(isChatWithTabPageUrl("https://example.com/path", "https://owui.local")).toEqual({
      ok: true,
    });
  });

  it("rejects chrome and missing urls", () => {
    expect(isChatWithTabPageUrl("chrome://extensions", null).ok).toBe(false);
    expect(isChatWithTabPageUrl(undefined, null).ok).toBe(false);
  });

  it("rejects the OWUI origin itself", () => {
    const result = isChatWithTabPageUrl("https://owui.local/chat", "https://owui.local");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/chat tab/i);
  });
});
