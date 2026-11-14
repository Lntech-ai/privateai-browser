import { describe, expect, it } from "vitest";

import {
  getBakedOwuiBaseName,
  getBakedOwuiBaseUrl,
  hasBakedOwuiBaseUrl,
} from "./owui-config";
import { owuiTabUrlPatterns } from "./owui-session";

describe("getBakedOwuiBaseUrl", () => {
  it("returns null when unset", () => {
    expect(getBakedOwuiBaseUrl({ WXT_OWUI_BASE_URL: "" })).toBeNull();
    expect(getBakedOwuiBaseUrl({})).toBeNull();
    expect(hasBakedOwuiBaseUrl({})).toBe(false);
  });

  it("normalizes a baked https URL", () => {
    expect(getBakedOwuiBaseUrl({ WXT_OWUI_BASE_URL: "https://ai.example.com/" })).toBe(
      "https://ai.example.com",
    );
    expect(hasBakedOwuiBaseUrl({ WXT_OWUI_BASE_URL: "https://ai.example.com" })).toBe(true);
  });

  it("adds https when scheme is missing", () => {
    expect(getBakedOwuiBaseUrl({ WXT_OWUI_BASE_URL: "ai.example.com" })).toBe(
      "https://ai.example.com",
    );
  });

  it("returns null for invalid values", () => {
    expect(getBakedOwuiBaseUrl({ WXT_OWUI_BASE_URL: "not a url" })).toBeNull();
  });
});

describe("getBakedOwuiBaseName", () => {
  it("returns null when unset", () => {
    expect(getBakedOwuiBaseName({})).toBeNull();
    expect(getBakedOwuiBaseName({ WXT_OWUI_BASE_NAME: "  " })).toBeNull();
  });

  it("returns the trimmed instance label", () => {
    expect(getBakedOwuiBaseName({ WXT_OWUI_BASE_NAME: " Additon " })).toBe("Additon");
  });
});

describe("owuiTabUrlPatterns", () => {
  it("never returns a bare origin (Chrome rejects those)", () => {
    expect(owuiTabUrlPatterns("http://localhost:5173")).toEqual(["http://localhost:5173/*"]);
    expect(owuiTabUrlPatterns("https://ai.example.com/")).toEqual(["https://ai.example.com/*"]);
  });
});
