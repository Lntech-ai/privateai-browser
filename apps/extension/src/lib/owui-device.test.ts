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
  runtime: {
    getPlatformInfo: vi.fn(async () => ({ os: "mac", arch: "arm" })),
    lastError: undefined as { message?: string } | undefined,
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
    (chrome.runtime.getPlatformInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      os: "mac",
      arch: "arm",
    });
  });

  it("creates a stable id and OS + browser default name", async () => {
    const { getOwuiDevice } = await import("./owui-device");
    const first = await getOwuiDevice();
    const second = await getOwuiDevice();
    expect(first.id).toBe("11111111-2222-4333-8444-555555555555");
    expect(first.name).toBe("Mac Chrome");
    expect(second).toEqual(first);
  });

  it("upgrades a bare browser-brand name to OS + browser", async () => {
    localStore.set("privateai_owui_device", {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Chrome",
    });
    const { getOwuiDevice } = await import("./owui-device");
    const device = await getOwuiDevice();
    expect(device.name).toBe("Mac Chrome");
  });

  it("keeps a custom user-chosen name", async () => {
    localStore.set("privateai_owui_device", {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Office PC",
    });
    const { getOwuiDevice } = await import("./owui-device");
    const device = await getOwuiDevice();
    expect(device.name).toBe("Office PC");
  });

  it("updates name without changing id", async () => {
    const { getOwuiDevice, setOwuiDeviceName } = await import("./owui-device");
    const created = await getOwuiDevice();
    const renamed = await setOwuiDeviceName("  MacBook Chrome  ");
    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe("MacBook Chrome");
  });

  it("uses enterprise hostname when available", async () => {
    (chrome as any).enterprise = {
      deviceAttributes: {
        getDeviceHostname: (cb: (name: string) => void) => cb("desk-42.corp.local"),
      },
    };
    const { getOwuiDevice } = await import("./owui-device");
    const device = await getOwuiDevice();
    expect(device.name).toBe("desk-42.corp.local");
    delete (chrome as any).enterprise;
  });
});
