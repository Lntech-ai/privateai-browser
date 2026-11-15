import { beforeEach, describe, expect, it, vi } from "vitest";

const localStore = new Map<string, unknown>();

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        if (localStore.has(key)) return { [key]: localStore.get(key) };
        return {};
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
      }),
    },
  },
});

vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/120.0.0.0" });
vi.stubGlobal("crypto", {
  randomUUID: () => "11111111-2222-4333-8444-555555555555",
});

describe("owui-device", () => {
  beforeEach(() => {
    localStore.clear();
    vi.resetModules();
  });

  it("creates a stable id and default Chrome name", async () => {
    const { getOwuiDevice } = await import("./owui-device");
    const first = await getOwuiDevice();
    const second = await getOwuiDevice();
    expect(first.id).toBe("11111111-2222-4333-8444-555555555555");
    expect(first.name).toBe("Chrome");
    expect(second).toEqual(first);
  });

  it("updates name without changing id", async () => {
    const { getOwuiDevice, setOwuiDeviceName } = await import("./owui-device");
    const created = await getOwuiDevice();
    const renamed = await setOwuiDeviceName("  MacBook Chrome  ");
    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe("MacBook Chrome");
  });
});
