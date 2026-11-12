/**
 * Minimal chrome.tabs / chrome.debugger actions for the OWUI bridge.
 * Tab rules: refuse chrome:// and extension pages; honor Stop.
 */

const AGENT_GROUP_TITLE = "PrivateAI Browser";

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

async function ensureAgentGroup(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId);
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

async function attachDebugger(tabId: number) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    const message = String(error);
    if (!message.includes("Already attached")) throw error;
  }
}

async function detachDebugger(tabId: number) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // ignore
  }
}

async function cdp(tabId: number, method: string, params?: Record<string, unknown>) {
  await attachDebugger(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

export async function navigate(params: { url: string; new_tab?: boolean }) {
  assertNotStopped();
  const url = assertNavigableUrl(params.url);
  let tabId = activeTabId;
  if (params.new_tab || tabId == null) {
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id!;
  } else {
    await chrome.tabs.update(tabId, { url, active: true });
  }
  activeTabId = tabId;
  await ensureAgentGroup(tabId);
  return { ok: true, tabId, url };
}

export async function tabList() {
  const tabs = await chrome.tabs.query({});
  const items = tabs
    .filter((t) => t.id != null && t.url && /^https?:/i.test(t.url))
    .map((t) => ({
      id: t.id,
      title: t.title ?? "",
      url: t.url ?? "",
      active: t.active,
      agent: t.id === activeTabId,
    }));
  return { ok: true, tabs: items, activeTabId, stopped };
}

export async function screenshot() {
  assertNotStopped();
  if (activeTabId == null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    activeTabId = tab.id;
  }
  await chrome.tabs.update(activeTabId, { active: true });
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  return { ok: true, tabId: activeTabId, dataUrl };
}

export async function click(params: { selector: string }) {
  assertNotStopped();
  if (activeTabId == null) throw new Error("No agent tab; navigate first");
  const selector = params.selector;
  const result = (await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { ok: false, error: `No element for selector: ${sel}` };
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true };
    },
    args: [selector],
  })) as Array<{ result?: { ok: boolean; error?: string } }>;
  const out = result[0]?.result ?? { ok: false, error: "Script failed" };
  return out;
}

export async function typeText(params: { selector: string; text: string; submit?: boolean }) {
  assertNotStopped();
  if (activeTabId == null) throw new Error("No agent tab; navigate first");
  const result = (await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: (sel: string, text: string, submit: boolean) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return { ok: false, error: `No element for selector: ${sel}` };
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        const form = el.closest("form");
        if (form) form.requestSubmit();
        else
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
          );
      }
      return { ok: true };
    },
    args: [params.selector, params.text, !!params.submit],
  })) as Array<{ result?: { ok: boolean; error?: string } }>;
  return result[0]?.result ?? { ok: false, error: "Script failed" };
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

export async function handleAction(action: string, params: Record<string, unknown> = {}) {
  switch (action) {
    case "navigate":
      return navigate(params as { url: string; new_tab?: boolean });
    case "screenshot":
      return screenshot();
    case "tab_list":
      return tabList();
    case "click":
      return click(params as { selector: string });
    case "type":
      return typeText(params as { selector: string; text: string; submit?: boolean });
    case "stop":
      return stopAgents();
    case "resume":
      return resumeAgents();
    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}
