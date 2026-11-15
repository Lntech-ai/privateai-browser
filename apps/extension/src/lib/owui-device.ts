/**
 * Stable per-install device identity for OWUI multi-bridge.
 * `id` is generated once and never reused; `name` is a user-editable label
 * (names may collide across installs — OWUI distinguishes by `id`).
 */

const DEVICE_KEY = "privateai_owui_device";

export type OwuiDevice = {
  id: string;
  name: string;
};

function newDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultDeviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  return "Browser";
}

export async function getOwuiDevice(): Promise<OwuiDevice> {
  const stored = await chrome.storage.local.get(DEVICE_KEY);
  const raw = stored[DEVICE_KEY] as Partial<OwuiDevice> | undefined;
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : newDeviceId();
  const name =
    typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : defaultDeviceName();
  const device: OwuiDevice = { id, name };
  if (!raw?.id || raw.id !== id || raw.name !== name) {
    await chrome.storage.local.set({ [DEVICE_KEY]: device });
  }
  return device;
}

export async function setOwuiDeviceName(name: string): Promise<OwuiDevice> {
  const current = await getOwuiDevice();
  const trimmed = name.trim() || defaultDeviceName();
  const device: OwuiDevice = { id: current.id, name: trimmed };
  await chrome.storage.local.set({ [DEVICE_KEY]: device });
  return device;
}
