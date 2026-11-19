import { LNTECH_URL } from "./links";
import { openPage } from "./ui";

export function PopupFooter() {
  const version = chrome.runtime.getManifest().version;
  return (
    <footer className="border-t border-zinc-200 px-3 py-2 text-center dark:border-zinc-700">
      <div className="mb-1 text-[10px] text-zinc-400">v{version} · in-tab fetch</div>
      <button
        type="button"
        className="text-[10px] text-zinc-500 underline-offset-2 hover:underline"
        onClick={() => openPage(LNTECH_URL)}
      >
        LnTech 2026 all rights reserved
      </button>
    </footer>
  );
}
