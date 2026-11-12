import { defineBackground } from "wxt/utils/define-background";

import {
  addBrowserControl,
  handleBrowserControlMessages,
} from "@browsermcp/extension-core";

import { restoreBridge } from "@/lib/owui-bridge";

/**
 * Service worker: optional local Browser MCP daemon control (upstream) plus
 * PrivateAI OWUI reverse bridge (Socket.IO + chrome.debugger actions).
 */
export default defineBackground(() => {
  handleBrowserControlMessages(
    addBrowserControl({
      legacyPortOverride: import.meta.env.MODE !== "production",
    }),
  );

  // Keep OWUI bridge alive across SW wake-ups.
  void restoreBridge();
  chrome.runtime.onStartup.addListener(() => {
    void restoreBridge();
  });
  chrome.alarms.create("privateai-owui-keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "privateai-owui-keepalive") void restoreBridge();
  });
});
