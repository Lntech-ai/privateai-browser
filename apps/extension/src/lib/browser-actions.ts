/**
 * chrome.tabs / chrome.scripting actions for the OWUI bridge.
 * Tab rules: refuse chrome:// and extension pages; honor Stop.
 * Prefer a11y snapshot refs (e12) over fragile CSS selectors.
 */

import { buildSnapshotInPage, clickInPage, typeInPage } from "./page-snapshot";

const AGENT_GROUP_TITLE = "PrivateAI Browser";
const ACTIVE_TAB_KEY = "privateai_agent_tab_id";

let stopped = false;
let activeTabId: number | null = null;

export function setStopped(value: boolean) {
  stopped = value;
}

export function isStopped() {
  return stopped;
}

function assertNotStopped() {
  if (stopped) {
    throw new Error("Browser bridge is stopped. Click Resume in the extension popup.");
  }
}

function assertNavigableUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) URLs are allowed");
  }
  return parsed.href;
}

async function rememberActiveTab(tabId: number | null) {
  activeTabId = tabId;
  try {
    if (tabId == null) {
      await chrome.storage.session.remove(ACTIVE_TAB_KEY);
    } else {
      await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
    }
  } catch {
    // session storage may be unavailable in some builds
  }
}

async function loadRememberedTabId(): Promise<number | null> {
  if (activeTabId != null) {
    try {
      await chrome.tabs.get(activeTabId);
      return activeTabId;
    } catch {
      activeTabId = null;
    }
  }
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_KEY);
    const id = stored[ACTIVE_TAB_KEY];
    if (typeof id === "number") {
      await chrome.tabs.get(id);
      activeTabId = id;
      return id;
    }
  } catch {
    // missing / closed
  }
  return null;
}

async function findAgentGroupId(windowId?: number): Promise<number | null> {
  try {
    const query: chrome.tabGroups.QueryInfo = { title: AGENT_GROUP_TITLE };
    if (windowId != null) query.windowId = windowId;
    const groups = await chrome.tabGroups.query(query);
    if (groups[0]?.id != null) return groups[0].id;
    // Fallback: any window, in case the agent group is on another window
    if (windowId != null) {
      const any = await chrome.tabGroups.query({ title: AGENT_GROUP_TITLE });
      if (any[0]?.id != null) return any[0].id;
    }
  } catch {
    // tabGroups may be unavailable
  }
  return null;
}

/** Reuse existing PrivateAI group; never spawn a second group for the same agent. */
async function ensureAgentGroup(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const existingGroupId = await findAgentGroupId(tab.windowId);

    if (existingGroupId != null) {
      if (tab.groupId !== existingGroupId) {
        await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroupId });
      }
      await chrome.tabGroups.update(existingGroupId, {
        title: AGENT_GROUP_TITLE,
        color: "blue",
      });
      return;
    }

    if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await chrome.tabGroups.update(tab.groupId, {
        title: AGENT_GROUP_TITLE,
        color: "blue",
      });
      return;
    }

    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: AGENT_GROUP_TITLE,
      color: "blue",
    });
  } catch {
    // tabGroups may be unavailable in some Chromium builds
  }
}

/**
 * Resolve the current agent tab for click/snapshot/type (no navigation).
 * Does not care about origin — just the remembered / grouped agent tab.
 */
async function resolveActiveAgentTabId(): Promise<number | null> {
  const remembered = await loadRememberedTabId();
  if (remembered != null) return remembered;

  const groupId = await findAgentGroupId();
  if (groupId != null) {
    const grouped = await chrome.tabs.query({ groupId });
    const active = grouped.find((t) => t.active && t.id != null);
    if (active?.id != null) return active.id;
    if (grouped[0]?.id != null) return grouped[0].id;
  }
  return null;
}

function urlsMatch(a: string | undefined, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    // Ignore hash; treat trailing slash as equivalent on pathname
    const norm = (u: URL) => {
      const path = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${path}${u.search}`;
    };
    return norm(ua) === norm(ub);
  } catch {
    return false;
  }
}

/** Exact URL already open (agent group first, then any window). */
async function findExactTabForUrl(url: string): Promise<number | null> {
  const groupId = await findAgentGroupId();
  if (groupId != null) {
    const grouped = await chrome.tabs.query({ groupId });
    const hit = grouped.find(
      (t) => t.id != null && (urlsMatch(t.url, url) || urlsMatch(t.pendingUrl, url)),
    );
    if (hit?.id != null) return hit.id;
  }

  const all = await chrome.tabs.query({});
  const hit = all.find(
    (t) => t.id != null && (urlsMatch(t.url, url) || urlsMatch(t.pendingUrl, url)),
  );
  return hit?.id ?? null;
}

async function detachDebugger(tabId: number) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // ignore
  }
}

async function ensureAgentTab(): Promise<number> {
  const reusable = await resolveActiveAgentTabId();
  if (reusable != null) {
    await rememberActiveTab(reusable);
    return reusable;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  await rememberActiveTab(tab.id);
  return tab.id;
}

function resolveTarget(params: {
  ref?: string;
  selector?: string;
  target?: string;
}): string {
  return String(params.ref || params.target || params.selector || "").trim();
}

export async function navigate(params: {
  url: string;
  new_tab?: boolean;
  /** When true, steal focus. Default false — keep the user's current tab. */
  activate?: boolean;
}) {
  assertNotStopped();
  const url = assertNavigableUrl(params.url);
  // Background by default so agent work does not yank the user's tab.
  const activate = params.activate === true;

  // Default: open a new tab in the PrivateAI group (AI decides later what to close).
  // new_tab=false → reuse the current agent tab in place (e.g. follow a link path).
  // Exact URL already open → reuse (focus only if activate=true).
  const forceNew = params.new_tab !== false;
  let tabId: number | null = await findExactTabForUrl(url);
  let created = false;

  if (tabId != null) {
    if (activate) await chrome.tabs.update(tabId, { active: true });
  } else if (!forceNew) {
    tabId = await resolveActiveAgentTabId();
    if (tabId != null) {
      await chrome.tabs.update(tabId, { url, ...(activate ? { active: true } : {}) });
    }
  }

  if (tabId == null) {
    const tab = await chrome.tabs.create({ url, active: activate });
    tabId = tab.id!;
    created = true;
  }

  await rememberActiveTab(tabId);
  await ensureAgentGroup(tabId);
  return { ok: true, tabId, url, created, activated: activate };
}

export async function tabList() {
  const groupId = await findAgentGroupId();
  const tabs = await chrome.tabs.query({});
  const items = tabs
    .filter((t) => t.id != null && t.url && /^https?:/i.test(t.url))
    .map((t) => ({
      id: t.id,
      title: t.title ?? "",
      url: t.url ?? "",
      active: t.active,
      agent: t.id === activeTabId,
      in_group: groupId != null && t.groupId === groupId,
    }));
  return {
    ok: true,
    tabs: items,
    agent_tabs: items.filter((t) => t.in_group || t.agent),
    activeTabId,
    stopped,
  };
}

export async function tabSwitch(params: {
  tab_id?: number;
  url_contains?: string;
}) {
  assertNotStopped();
  let tabId = typeof params.tab_id === "number" ? params.tab_id : null;
  const needle = String(params.url_contains || "").trim().toLowerCase();

  if (tabId == null && needle) {
    const groupId = await findAgentGroupId();
    const pool =
      groupId != null
        ? await chrome.tabs.query({ groupId })
        : await chrome.tabs.query({});
    const hit = pool.find(
      (t) =>
        t.id != null &&
        ((t.url || "").toLowerCase().includes(needle) ||
          (t.title || "").toLowerCase().includes(needle)),
    );
    tabId = hit?.id ?? null;
  }

  if (tabId == null) {
    return {
      ok: false,
      error: "Provide tab_id from browser_tab_list, or url_contains (e.g. 'web.whatsapp.com').",
    };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await rememberActiveTab(tabId);
    await ensureAgentGroup(tabId);
    return {
      ok: true,
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
    };
  } catch {
    return { ok: false, error: `Tab ${tabId} not found` };
  }
}

export async function tabClose(params: { tab_id?: number } = {}) {
  assertNotStopped();
  let tabId =
    typeof params.tab_id === "number" ? params.tab_id : await resolveActiveAgentTabId();
  if (tabId == null) {
    return { ok: false, error: "No tab to close" };
  }

  try {
    await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: `Tab ${tabId} not found` };
  }

  await chrome.tabs.remove(tabId);

  if (activeTabId === tabId) {
    const next = await resolveActiveAgentTabId();
    if (next != null && next !== tabId) {
      await rememberActiveTab(next);
      try {
        await chrome.tabs.update(next, { active: true });
      } catch {
        // ignore
      }
    } else {
      await rememberActiveTab(null);
    }
  }

  return { ok: true, closed: tabId, activeTabId };
}

export async function screenshot() {
  assertNotStopped();
  const tabId = await ensureAgentTab();
  await chrome.tabs.update(tabId, { active: true });
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  return { ok: true, tabId, dataUrl };
}

export async function snapshot(params: {
  interactive?: boolean;
  max_nodes?: number;
} = {}) {
  assertNotStopped();
  const tabId = await ensureAgentTab();
  const interactiveOnly = params.interactive !== false;
  const maxNodes = Math.min(Math.max(Number(params.max_nodes) || 200, 1), 500);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: buildSnapshotInPage,
    args: [interactiveOnly, maxNodes],
  });
  const out = results[0]?.result ?? { ok: false, error: "Snapshot failed" };
  return { ...out, tabId };
}

export async function click(params: {
  ref?: string;
  selector?: string;
  target?: string;
}) {
  assertNotStopped();
  const tabId = await ensureAgentTab();
  const target = resolveTarget(params);
  if (!target) {
    return { ok: false, error: "Provide ref (from snapshot) or selector" };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: clickInPage,
      args: [target],
    });
    return results[0]?.result ?? { ok: false, error: "Click failed (no script result)" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function typeText(params: {
  ref?: string;
  selector?: string;
  target?: string;
  text?: string;
  submit?: boolean;
}) {
  assertNotStopped();
  const tabId = await ensureAgentTab();
  // Empty target is allowed: page script focuses compose/textbox automatically.
  const target = resolveTarget(params);
  const text = String(params.text ?? "");

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: typeInPage,
      args: [target, text, !!params.submit],
    });
    return results[0]?.result ?? { ok: false, error: "Type failed (no script result)" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function stopAgents() {
  stopped = true;
  if (activeTabId != null) await detachDebugger(activeTabId);
  return { ok: true, stopped: true };
}

export async function resumeAgents() {
  stopped = false;
  return { ok: true, stopped: false };
}

/** Hosts OWUI may fetch / listen on (never arbitrary sites). Auth via in-tab credentials only. */
export const BRIDGE_HOST_ALLOWLIST = new Set(["kalodata.com", "www.kalodata.com"]);

const FETCH_BODY_MAX_BYTES = 1_500_000;
const NETWORK_BUFFER_MAX = 50;
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

type NetworkLogEntry = {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  resourceType?: string;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body_text?: string;
  body_truncated?: boolean;
};

let networkListening = false;
let networkListenTabId: number | null = null;
let networkAttachedByUs = false;
let networkBuffer: NetworkLogEntry[] = [];
const networkPending = new Map<string, NetworkLogEntry>();
let networkEventHandler:
  | ((source: chrome.debugger.Debuggee, method: string, params?: object) => void)
  | null = null;

/** True when hostname is allowlisted or a subdomain of an allowlisted registrable host. */
export function isAllowedHost(hostname: string): boolean {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) return false;
  if (BRIDGE_HOST_ALLOWLIST.has(host)) return true;
  for (const allowed of BRIDGE_HOST_ALLOWLIST) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/** https-only URL whose host is on the bridge allowlist. */
export function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only https URLs are allowed for bridge fetch/listen");
  }
  if (!isAllowedHost(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Allowlist: ${[...BRIDGE_HOST_ALLOWLIST].join(", ")}`,
    );
  }
  return parsed;
}

export function sanitizeBridgeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (FORBIDDEN_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (rawVal == null) continue;
    out[key] = String(rawVal);
  }
  return out;
}

function pushNetworkEntry(entry: NetworkLogEntry) {
  networkBuffer.push(entry);
  if (networkBuffer.length > NETWORK_BUFFER_MAX) {
    networkBuffer = networkBuffer.slice(-NETWORK_BUFFER_MAX);
  }
}

function isAllowlistedUrlString(url: string): boolean {
  try {
    assertAllowedUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function onNetworkDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object,
) {
  if (!networkListening) return;
  if (source.tabId == null || source.tabId !== networkListenTabId) return;
  const p = (params || {}) as Record<string, any>;

  if (method === "Network.requestWillBeSent") {
    const url = String(p.request?.url || "");
    if (!isAllowlistedUrlString(url)) return;
    const entry: NetworkLogEntry = {
      requestId: String(p.requestId || ""),
      url,
      method: String(p.request?.method || "GET"),
      resourceType: p.type ? String(p.type) : undefined,
      timestamp: Date.now(),
      requestHeaders:
        p.request?.headers && typeof p.request.headers === "object"
          ? { ...p.request.headers }
          : undefined,
    };
    if (!entry.requestId) return;
    networkPending.set(entry.requestId, entry);
    return;
  }

  if (method === "Network.responseReceived") {
    const requestId = String(p.requestId || "");
    const entry = networkPending.get(requestId);
    if (!entry) return;
    entry.status = typeof p.response?.status === "number" ? p.response.status : undefined;
    entry.mimeType = p.response?.mimeType ? String(p.response.mimeType) : undefined;
    if (p.response?.headers && typeof p.response.headers === "object") {
      entry.responseHeaders = { ...p.response.headers };
    }
    return;
  }

  if (method === "Network.loadingFinished") {
    const requestId = String(p.requestId || "");
    const entry = networkPending.get(requestId);
    if (!entry) return;
    networkPending.delete(requestId);
    try {
      const body = (await chrome.debugger.sendCommand({ tabId: source.tabId }, "Network.getResponseBody", {
        requestId,
      })) as { body?: string; base64Encoded?: boolean } | undefined;
      if (body?.body != null) {
        let text = body.base64Encoded
          ? // Avoid bundling a decoder; mark binary payloads as truncated metadata.
            `[base64 ${body.body.length} chars]`
          : String(body.body);
        if (text.length > FETCH_BODY_MAX_BYTES) {
          text = text.slice(0, FETCH_BODY_MAX_BYTES);
          entry.body_truncated = true;
        }
        entry.body_text = text;
      }
    } catch {
      // body may be unavailable; metadata still useful
    }
    pushNetworkEntry(entry);
  }

  if (method === "Network.loadingFailed") {
    const requestId = String(p.requestId || "");
    const entry = networkPending.get(requestId);
    if (!entry) return;
    networkPending.delete(requestId);
    entry.status = entry.status ?? 0;
    pushNetworkEntry(entry);
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Open/reuse an allowlisted URL in a background tab (no focus steal). */
export async function ensureBackgroundTab(url: string): Promise<{
  tabId: number;
  created: boolean;
  url: string;
}> {
  const href = assertAllowedUrl(url).href;
  const exact = await findExactTabForUrl(href);
  if (exact != null) {
    await rememberActiveTab(exact);
    await ensureAgentGroup(exact);
    return { tabId: exact, created: false, url: href };
  }

  const origin = new URL(href).origin;
  const existing = (await chrome.tabs.query({})).find(
    (t) =>
      t.id != null &&
      typeof t.url === "string" &&
      t.url.startsWith(origin) &&
      !t.url.includes("/login"),
  );
  if (existing?.id != null) {
    await rememberActiveTab(existing.id);
    await ensureAgentGroup(existing.id);
    return { tabId: existing.id, created: false, url: existing.url || href };
  }

  const tab = await chrome.tabs.create({ url: href, active: false });
  const tabId = tab.id!;
  await rememberActiveTab(tabId);
  await ensureAgentGroup(tabId);
  await waitForTabComplete(tabId);
  return { tabId, created: true, url: href };
}

/** In-tab fetch with the page's live cookie jar (incl. httpOnly). No focus steal. */
async function fetchInPageTab(
  tabId: number,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  // Never inject Cookie — the page credentials handle auth.
  const pageHeaders = { ...headers };
  for (const key of Object.keys(pageHeaders)) {
    if (key.toLowerCase() === "cookie") delete pageHeaders[key];
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [url, method, pageHeaders, body ?? null, timeoutMs, FETCH_BODY_MAX_BYTES] as const,
    func: async (reqUrl, reqMethod, reqHeaders, reqBody, timeout, maxBytes) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const init: RequestInit = {
          method: reqMethod,
          headers: reqHeaders as HeadersInit,
          credentials: "include",
          redirect: "manual",
          signal: controller.signal,
        };
        if (reqBody != null && reqMethod !== "GET" && reqMethod !== "HEAD") {
          init.body = reqBody;
        }
        const res = await fetch(reqUrl, init);
        if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
          return {
            ok: false,
            status: res.status,
            error: `HTTP redirect not followed (${res.status})`,
            location: res.headers.get("Location"),
            via: "page",
          };
        }
        let text = await res.text();
        let truncated = false;
        if (text.length > maxBytes) {
          text = text.slice(0, maxBytes);
          truncated = true;
        }
        let json: unknown;
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("json") || /^\s*[\[{]/.test(text)) {
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
        }
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });
        return {
          ok: res.ok,
          status: res.status,
          headers: responseHeaders,
          body_text: text,
          body_truncated: truncated,
          ...(json !== undefined ? { json } : {}),
          via: "page",
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
          via: "page",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
  const result = results?.[0]?.result;
  if (!result || typeof result !== "object") {
    return { ok: false, status: 0, error: "In-page fetch returned no result", via: "page" };
  }
  return result as Record<string, unknown>;
}

/**
 * Authenticated fetch for allowlisted https URLs.
 * Runs in a background allowlisted tab so the page's live session credentials apply.
 * Never reads or copies cookies into the service worker.
 */
export async function bridgeFetch(params: {
  url?: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: string | Record<string, unknown> | null;
  timeout_ms?: number;
} = {}) {
  assertNotStopped();
  const parsed = assertAllowedUrl(params.url || "");
  const method = String(params.method || "GET").toUpperCase();
  const timeoutMs = Math.max(
    1_000,
    Math.min(120_000, Number(params.timeout_ms) || 30_000),
  );

  const headers = sanitizeBridgeHeaders(params.headers);
  let body: string | undefined;
  if (params.body != null && method !== "GET" && method !== "HEAD") {
    if (typeof params.body === "string") {
      body = params.body;
    } else {
      body = JSON.stringify(params.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const explore =
    parsed.hostname.includes("kalodata")
      ? "https://www.kalodata.com/explore"
      : `${parsed.origin}/`;
  const ensured = await ensureBackgroundTab(explore);
  return fetchInPageTab(
    ensured.tabId,
    parsed.href,
    method,
    headers,
    body,
    timeoutMs,
  );
}

export async function networkListen(params: { enabled?: boolean } = {}) {
  assertNotStopped();
  const enabled = params.enabled !== false;

  if (!enabled) {
    if (networkEventHandler) {
      try {
        chrome.debugger.onEvent.removeListener(networkEventHandler);
      } catch {
        // ignore
      }
      networkEventHandler = null;
    }
    if (networkAttachedByUs && networkListenTabId != null) {
      await detachDebugger(networkListenTabId);
    }
    networkListening = false;
    networkListenTabId = null;
    networkAttachedByUs = false;
    networkPending.clear();
    return { ok: true, listening: false, buffer_size: networkBuffer.length };
  }

  const tabId = await ensureAgentTab();
  let attachedByUs = false;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedByUs = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Already attached by another debugger session — reuse it.
    if (!/already attached/i.test(msg)) {
      throw new Error(`Failed to attach debugger for network listen: ${msg}`);
    }
  }

  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});

  if (networkEventHandler) {
    try {
      chrome.debugger.onEvent.removeListener(networkEventHandler);
    } catch {
      // ignore
    }
  }
  networkEventHandler = onNetworkDebuggerEvent;
  chrome.debugger.onEvent.addListener(networkEventHandler);

  networkListening = true;
  networkListenTabId = tabId;
  networkAttachedByUs = attachedByUs;
  return {
    ok: true,
    listening: true,
    tabId,
    buffer_size: networkBuffer.length,
    allowlist: [...BRIDGE_HOST_ALLOWLIST],
  };
}

export async function networkLog(params: { clear?: boolean; limit?: number } = {}) {
  assertNotStopped();
  const limit = Math.max(1, Math.min(NETWORK_BUFFER_MAX, Number(params.limit) || NETWORK_BUFFER_MAX));
  const entries = networkBuffer.slice(-limit);
  if (params.clear) networkBuffer = [];
  return {
    ok: true,
    listening: networkListening,
    tabId: networkListenTabId,
    count: entries.length,
    entries,
  };
}

const BRIDGE_ACTIONS = [
  "capabilities",
  "navigate",
  "ensure_tab",
  "screenshot",
  "snapshot",
  "tab_list",
  "tab_switch",
  "tab_close",
  "click",
  "type",
  "fetch",
  "network_listen",
  "network_log",
  "stop",
  "resume",
] as const;

export async function bridgeCapabilities() {
  const manifest = chrome.runtime.getManifest();
  return {
    ok: true,
    name: manifest.name,
    version: manifest.version,
    actions: [...BRIDGE_ACTIONS],
    supports: {
      fetch: true,
      network_listen: true,
      in_page_fetch: true,
    },
  };
}

export async function handleAction(action: string, params: Record<string, unknown> = {}) {
  switch (action) {
    case "capabilities":
      return bridgeCapabilities();
    case "navigate":
      return navigate(params as { url: string; new_tab?: boolean; activate?: boolean });
    case "ensure_tab":
      return ensureBackgroundTab(String(params.url || ""));
    case "screenshot":
      return screenshot();
    case "snapshot":
      return snapshot(params as { interactive?: boolean; max_nodes?: number });
    case "tab_list":
      return tabList();
    case "tab_switch":
      return tabSwitch(params as { tab_id?: number; url_contains?: string });
    case "tab_close":
      return tabClose(params as { tab_id?: number });
    case "click":
      return click(params as { ref?: string; selector?: string; target?: string });
    case "type":
      return typeText(
        params as {
          ref?: string;
          selector?: string;
          target?: string;
          text?: string;
          submit?: boolean;
        },
      );
    case "fetch":
      return bridgeFetch(
        params as {
          url?: string;
          method?: string;
          headers?: Record<string, unknown>;
          body?: string | Record<string, unknown> | null;
          timeout_ms?: number;
        },
      );
    case "network_listen":
      return networkListen(params as { enabled?: boolean });
    case "network_log":
      return networkLog(params as { clear?: boolean; limit?: number });
    case "stop":
      return stopAgents();
    case "resume":
      return resumeAgents();
    default:
      return {
        ok: false,
        error: `Unknown action: ${action}. This extension build does not support it. Supported: ${BRIDGE_ACTIONS.join(", ")}. Install PrivateAI Browser ≥ 0.1.4.`,
      };
  }
}
