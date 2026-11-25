import { defineBackground } from "wxt/utils/define-background";

import { browserSupportsSplitView } from "@/lib/agent-overlay";
import { chatWithTab } from "@/lib/chat-with-tab";
import { registerOwuiBridgeHandlers, restoreBridge } from "@/lib/owui-bridge";

const CHAT_WITH_TAB_MENU_ID = "privateai-chat-with-tab";
let chatMenuListenerRegistered = false;

/**
 * Service worker for PrivateAI Browser (OWUI reverse bridge only).
 *
 * Upstream Browser MCP's local-daemon probe (`127.0.0.1:9010–9012/browsermcp/status`)
 * is intentionally NOT started here — it spams ERR_CONNECTION_REFUSED when no
 * local daemon is running, and the OWUI path does not need it.
 *
 * Bridge socket + session pairing live here so popup actions survive the popup
 * closing when a login tab is opened.
 */
function registerChatWithTabContextMenu() {
  if (!chrome.contextMenus || !browserSupportsSplitView()) return;

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CHAT_WITH_TAB_MENU_ID,
      title: "Chat with this tab",
      contexts: ["page", "action"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });

  if (chatMenuListenerRegistered) return;
  chatMenuListenerRegistered = true;
  chrome.contextMenus.onClicked.addListener(
    (info: { menuItemId: string | number }, tab?: { id?: number }) => {
      if (info.menuItemId !== CHAT_WITH_TAB_MENU_ID) return;
      if (tab?.id == null) return;
      void chatWithTab({ pageTabId: tab.id });
    },
  );
}

export default defineBackground(() => {
  registerOwuiBridgeHandlers();
  void restoreBridge();
  registerChatWithTabContextMenu();

  chrome.runtime.onStartup.addListener(() => {
    void restoreBridge();
  });

  chrome.runtime.onInstalled.addListener(() => {
    void restoreBridge();
    registerChatWithTabContextMenu();
  });

  chrome.alarms.create("privateai-owui-keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "privateai-owui-keepalive") void restoreBridge();
  });
});
