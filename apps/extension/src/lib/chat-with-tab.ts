/**
 * Extension-initiated “Chat with this tab”: open/focus OWUI beside the page
 * via Chrome Split View (Chrome 155+), remember the page as the agent tab,
 * and show the agent overlay.
 */

import {
  ensureAgentOverlayInPage,
  isChatWithTabPageUrl,
  isSplitViewApiAvailable,
} from "./agent-overlay";
import { rememberAgentTab } from "./browser-actions";
import { findOwuiTab, openOwuiTab } from "./owui-session";
import { getOwuiAuth, normalizeBaseUrl } from "./owui-storage";

const SPLIT_VIEW_NONE = -1;

type TabsWithSplit = typeof chrome.tabs & {
  createSplit?: (tabIds: [number, number]) => Promise<number>;
  unsplit?: (splitViewId: number) => Promise<void>;
  SPLIT_VIEW_ID_NONE?: number;
};

type TabWithSplit = chrome.tabs.Tab & {
  splitViewId?: number;
};

export type ChatWithTabResult = {
  ok: boolean;
  error?: string;
  pageTabId?: number;
  owuiTabId?: number;
  splitViewId?: number;
};

export function splitViewSupported(): boolean {
  return isSplitViewApiAvailable(chrome.tabs as TabsWithSplit);
}

async function unsplitIfNeeded(tab: TabWithSplit) {
  const tabsApi = chrome.tabs as TabsWithSplit;
  const none = tabsApi.SPLIT_VIEW_ID_NONE ?? SPLIT_VIEW_NONE;
  const splitId = tab.splitViewId;
  if (splitId == null || splitId === none) return;
  if (typeof tabsApi.unsplit === "function") {
    try {
      await tabsApi.unsplit(splitId);
    } catch {
      // ignore — may already be unsplit
    }
  }
}

async function ungroupTab(tabId: number) {
  try {
    await chrome.tabs.ungroup(tabId);
  } catch {
    // already ungrouped / API unavailable
  }
}

/**
 * Align pinned + group so createSplit can succeed, then place OWUI adjacent
 * to the page and create the split. Page is remembered as the agent tab;
 * OWUI is focused for chat.
 */
export async function chatWithTab(params: {
  pageTabId?: number;
} = {}): Promise<ChatWithTabResult> {
  if (!splitViewSupported()) {
    return {
      ok: false,
      error: "Chat with tab needs Chrome 155+ (Split View API). Update Chrome and try again.",
    };
  }

  const auth = await getOwuiAuth();
  const baseUrl = auth?.baseUrl;
  if (!baseUrl || !auth?.token) {
    return {
      ok: false,
      error: "Connect PrivateAI Browser to Open WebUI first (open the extension popup).",
    };
  }

  let origin: string;
  try {
    origin = normalizeBaseUrl(baseUrl);
  } catch {
    return { ok: false, error: "Invalid Open WebUI URL in extension settings" };
  }

  if (params.pageTabId == null) {
    return {
      ok: false,
      error: "No page tab selected. Open the popup on the page you want to chat with.",
    };
  }

  let pageTab: TabWithSplit;
  try {
    pageTab = (await chrome.tabs.get(params.pageTabId)) as TabWithSplit;
  } catch {
    return { ok: false, error: "Page tab no longer exists" };
  }

  if (!pageTab.id) {
    return { ok: false, error: "No active tab to chat with" };
  }

  const urlCheck = isChatWithTabPageUrl(pageTab.url || pageTab.pendingUrl, origin);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };

  const pageTabId = pageTab.id;
  const windowId = pageTab.windowId;

  // Find or create OWUI tab (prefer same window later).
  let owuiTab = await findOwuiTab(origin);
  if (!owuiTab?.id) {
    owuiTab = await openOwuiTab(origin, false);
  }
  if (!owuiTab?.id) {
    return { ok: false, error: "Could not open Open WebUI tab" };
  }
  let owuiTabId = owuiTab.id;

  // Move OWUI into the page's window if needed.
  if (owuiTab.windowId !== windowId) {
    try {
      owuiTab = await chrome.tabs.move(owuiTabId, { windowId, index: -1 });
      owuiTabId = owuiTab.id!;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not move Open WebUI into this window for Split View",
      };
    }
  }

  // Fresh tab state after moves
  pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
  owuiTab = (await chrome.tabs.get(owuiTabId)) as TabWithSplit;

  await unsplitIfNeeded(pageTab);
  await unsplitIfNeeded(owuiTab);

  // Align pinned + group (createSplit requires matching state; leave both ungrouped).
  const noneGroup = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;
  if (pageTab.groupId != null && pageTab.groupId !== noneGroup) {
    await ungroupTab(pageTabId);
  }
  if (owuiTab.groupId != null && owuiTab.groupId !== noneGroup) {
    await ungroupTab(owuiTabId);
  }

  pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
  owuiTab = (await chrome.tabs.get(owuiTabId)) as TabWithSplit;

  if (!!pageTab.pinned !== !!owuiTab.pinned) {
    try {
      await chrome.tabs.update(owuiTabId, { pinned: !!pageTab.pinned });
    } catch {
      await chrome.tabs.update(pageTabId, { pinned: false });
      await chrome.tabs.update(owuiTabId, { pinned: false });
    }
  }

  // Place OWUI immediately to the right of the page (page left, chat right).
  try {
    pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
    await chrome.tabs.move(owuiTabId, { index: (pageTab.index ?? 0) + 1 });
    pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
    owuiTab = (await chrome.tabs.get(owuiTabId)) as TabWithSplit;
    if ((owuiTab.index ?? 0) !== (pageTab.index ?? 0) + 1) {
      await chrome.tabs.move(owuiTabId, { index: (pageTab.index ?? 0) + 1 });
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not place Open WebUI next to this tab",
    };
  }

  const tabsApi = chrome.tabs as TabsWithSplit;
  let splitViewId: number;
  try {
    splitViewId = await tabsApi.createSplit!([pageTabId, owuiTabId]);
  } catch (error) {
    // Non-destructive retry: re-align then createSplit again.
    try {
      pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
      owuiTab = (await chrome.tabs.get(owuiTabId)) as TabWithSplit;
      await unsplitIfNeeded(pageTab);
      await unsplitIfNeeded(owuiTab);
      pageTab = (await chrome.tabs.get(pageTabId)) as TabWithSplit;
      await chrome.tabs.move(owuiTabId, { index: (pageTab.index ?? 0) + 1 });
      splitViewId = await tabsApi.createSplit!([pageTabId, owuiTabId]);
    } catch (fallbackError) {
      return {
        ok: false,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "Could not create Split View",
      };
    }
  }

  await rememberAgentTab(pageTabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: pageTabId },
      func: ensureAgentOverlayInPage,
    });
  } catch {
    // Restricted pages / inject failure — split still useful
  }

  try {
    await chrome.tabs.update(owuiTabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  } catch {
    // ignore focus failures
  }

  return {
    ok: true,
    pageTabId,
    owuiTabId,
    splitViewId,
  };
}
