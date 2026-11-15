/**
 * Stable per-install device identity for OWUI multi-bridge.
 * `id` is generated once and never reused; `name` is a user-editable label
 * (names may collide across installs — OWUI distinguishes by `id`).
 *
 * Default name prefers the real PC hostname when Chrome Enterprise exposes it;
 * otherwise OS + browser brand (e.g. "Mac Chrome"). True hostname is not
 * available to ordinary Web Store / unpacked extensions.
 */

const DEVICE_KEY = "privateai_owui_device";

export type OwuiDevice = {
  id: string;
  name: string;
};

const GENERIC_BROWSER_NAMES = new Set([
  "browser",
  "chrome",
  "chromium",
  "edge",
  "brave",
  "opera",
  "vivaldi",
]);

function newDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function browserBrandFromUa(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Brave\//.test(ua) || /Brave Chrome\//.test(ua)) return "Brave";
  if (/OPR\//.test(ua) || /Opera\//.test(ua)) return "Opera";
  if (/Vivaldi\//.test(ua)) return "Vivaldi";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  return "Browser";
}

function platformLabel(os: string | undefined): string {
  switch (os) {
    case "mac":
      return "Mac";
    case "win":
      return "Windows";
    case "linux":
      return "Linux";
    case "cros":
      return "Chromebook";
    case "android":
      return "Android";
    case "openbsd":
      return "OpenBSD";
    default:
      return "";
  }
}

async function enterpriseHostname(): Promise<string | null> {
  try {
    const attrs = (
      chrome as typeof chrome & {
        enterprise?: {
          deviceAttributes?: {
            getDeviceHostname?: (callback: (hostname: string) => void) => void;
          };
        };
      }
    ).enterprise?.deviceAttributes;
    if (!attrs?.getDeviceHostname) return null;

    const hostname = await new Promise<string | null>((resolve) => {
      try {
        attrs.getDeviceHostname!((name) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(typeof name === "string" && name.trim() ? name.trim() : null);
        });
      } catch {
        resolve(null);
      }
    });
    return hostname;
  } catch {
    return null;
  }
}

async function platformBrowserName(): Promise<string> {
  const browser = browserBrandFromUa();
  try {
    const info = await chrome.runtime.getPlatformInfo();
    const platform = platformLabel(info?.os);
    return platform ? `${platform} ${browser}` : browser;
  } catch {
    return browser;
  }
}

/** Best-effort default label for a new (or still-generic) install. */
export async function defaultDeviceName(): Promise<string> {
  const hostname = await enterpriseHostname();
  if (hostname) return hostname;
  return platformBrowserName();
}

/** Bare brand labels from older builds — upgrade once to OS + browser / hostname. */
function isLegacyBareBrowserName(name: string): boolean {
  return GENERIC_BROWSER_NAMES.has(name.trim().toLowerCase());
}

export async function getOwuiDevice(): Promise<OwuiDevice> {
  const stored = await chrome.storage.local.get(DEVICE_KEY);
  const raw = stored[DEVICE_KEY] as Partial<OwuiDevice> | undefined;
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : newDeviceId();

  let name = typeof raw?.name === "string" ? raw.name.trim() : "";
  // First run, or upgrade from a bare browser-brand default → prefer PC/OS label.
  if (!name || isLegacyBareBrowserName(name)) {
    name = await defaultDeviceName();
  }

  const device: OwuiDevice = { id, name };
  if (!raw?.id || raw.id !== id || raw.name !== name) {
    await chrome.storage.local.set({ [DEVICE_KEY]: device });
  }
  return device;
}

export async function setOwuiDeviceName(name: string): Promise<OwuiDevice> {
  const current = await getOwuiDevice();
  const trimmed = name.trim() || (await defaultDeviceName());
  const device: OwuiDevice = { id: current.id, name: trimmed };
  await chrome.storage.local.set({ [DEVICE_KEY]: device });
  return device;
}
