import { getBakedOwuiBaseUrl } from "./owui-config";
import { normalizeBaseUrl } from "./owui-storage";

export type OwuiSessionUser = {
  token: string;
  email?: string;
  name?: string;
};

/** Read OWUI's JWT from a tab's page localStorage (`token`). */
export async function readTokenFromTab(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          return localStorage.getItem("token");
        } catch {
          return null;
        }
      },
    });
    const token = results?.[0]?.result;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Validate a JWT against OWUI and return session profile fields. */
export async function fetchSessionUser(
  baseUrl: string,
  token: string,
): Promise<OwuiSessionUser> {
  const origin = normalizeBaseUrl(baseUrl);
  const res = await fetch(`${origin}/api/v1/auths/`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.detail || body?.message || `Session check failed (${res.status})`);
  }
  const sessionToken = (body.token as string | undefined) || token;
  return {
    token: sessionToken,
    email: body.email,
    name: body.name,
  };
}

/**
 * Chrome match patterns require a path (`http://host:port` alone throws
 * "Invalid url pattern"). Use `${origin}/*` only.
 */
export function owuiTabUrlPatterns(baseUrl: string): string[] {
  const origin = normalizeBaseUrl(baseUrl);
  return [`${origin}/*`];
}

export async function findOwuiTab(baseUrl: string): Promise<chrome.tabs.Tab | undefined> {
  const origin = normalizeBaseUrl(baseUrl);
  try {
    const tabs = await chrome.tabs.query({ url: owuiTabUrlPatterns(origin) });
    return tabs.find((t) => typeof t.id === "number");
  } catch {
    // Fall back: scan open tabs (covers odd origins / query failures).
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => {
      if (typeof t.id !== "number" || !t.url) return false;
      try {
        return new URL(t.url).origin === origin;
      } catch {
        return false;
      }
    });
  }
}

export async function openOwuiTab(baseUrl: string, active = true): Promise<chrome.tabs.Tab> {
  const origin = normalizeBaseUrl(baseUrl);
  const existing = await findOwuiTab(origin);
  if (existing?.id != null) {
    const updated = await chrome.tabs.update(existing.id, { active });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: active });
    }
    return updated ?? existing;
  }
  // Always open with a real path so navigation succeeds even if query matched nothing.
  return chrome.tabs.create({ url: `${origin}/`, active });
}

/**
 * Wait until an OWUI tab has a usable JWT, or until `timeoutMs`.
 * Returns null if the user never signed in within the window.
 */
export async function waitForTokenInTab(
  tabId: number,
  timeoutMs = 5 * 60 * 1000,
): Promise<string | null> {
  const immediate = await readTokenFromTab(tabId);
  if (immediate) return immediate;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(token);
    };

    const tryRead = async () => {
      const token = await readTokenFromTab(tabId);
      if (token) finish(token);
    };

    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete" || changeInfo.url) {
        void tryRead();
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) finish(null);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    const poll = setInterval(() => void tryRead(), 2000);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Resolve which OWUI origin to use: baked build URL, else explicit, else null. */
export function resolveOwuiBaseUrl(explicit?: string | null): string | null {
  if (explicit?.trim()) {
    try {
      return normalizeBaseUrl(explicit);
    } catch {
      return null;
    }
  }
  return getBakedOwuiBaseUrl();
}
