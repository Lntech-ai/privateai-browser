import { useEffect, useState } from "react";

import { OwuiPanel } from "@/components/owui-panel";
import { PopupHeader } from "@/components/popup-header";
import { SettingsScreen } from "@/components/settings-screen";
import { restoreBridge } from "@/lib/owui-bridge";

/**
 * Popup: Open WebUI bridge login / status only (no local Browser MCP daemon).
 */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void restoreBridge();
  }, []);

  if (settingsOpen) {
    return <SettingsScreen onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <div className="w-80 text-[13px]">
      <PopupHeader onOpenSettings={() => setSettingsOpen(true)} />
      <OwuiPanel />
    </div>
  );
}
