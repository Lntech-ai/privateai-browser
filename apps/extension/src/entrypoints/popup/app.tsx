import { useEffect, useState } from "react";

import { sendBrowserControlMessage } from "@browsermcp/extension-core/popup";

import { BrowserControlPanel } from "@/components/browser-control-panel";
import { OwuiPanel } from "@/components/owui-panel";
import { PopupHeader } from "@/components/popup-header";
import { SettingsScreen } from "@/components/settings-screen";
import { restoreBridge } from "@/lib/owui-bridge";

/**
 * Popup: Open WebUI bridge login + optional local Browser MCP daemon status.
 */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    sendBrowserControlMessage("ping").catch((error: unknown) => {
      console.warn("Couldn't reach the background", error);
    });
    void restoreBridge();
  }, []);

  if (settingsOpen) {
    return <SettingsScreen onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <div className="w-80 text-[13px]">
      <PopupHeader onOpenSettings={() => setSettingsOpen(true)} />
      <OwuiPanel />
      <BrowserControlPanel />
    </div>
  );
}
