import { useEffect, useState } from "react";

import { OwuiPanel } from "@/components/owui-panel";
import { PopupFooter } from "@/components/popup-footer";
import { PopupHeader } from "@/components/popup-header";
import { getBridgeStatus, restoreBridge, subscribeBridgeStatus } from "@/lib/owui-client";

/**
 * Popup: Open WebUI bridge login / status only (no local Browser MCP daemon).
 */
export function App() {
  const [baseUrl, setBaseUrl] = useState(() => getBridgeStatus().baseUrl || "");

  useEffect(() => {
    void restoreBridge();
  }, []);

  useEffect(
    () =>
      subscribeBridgeStatus((status) => {
        if (status.baseUrl) setBaseUrl(status.baseUrl);
      }),
    [],
  );

  return (
    <div className="w-80 text-[13px]">
      <PopupHeader baseUrl={baseUrl} />
      <OwuiPanel baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} />
      <PopupFooter />
    </div>
  );
}
