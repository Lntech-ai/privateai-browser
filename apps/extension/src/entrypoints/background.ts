import { defineBackground } from "wxt/utils/define-background";

import { registerOwuiBridgeHandlers, restoreBridge } from "@/lib/owui-bridge";

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
export default defineBackground(() => {
  registerOwuiBridgeHandlers();
  void restoreBridge();

  chrome.runtime.onStartup.addListener(() => {
    void restoreBridge();
  });

  chrome.runtime.onInstalled.addListener(() => {
    void restoreBridge();
  });

  chrome.alarms.create("privateai-owui-keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "privateai-owui-keepalive") void restoreBridge();
  });
});
