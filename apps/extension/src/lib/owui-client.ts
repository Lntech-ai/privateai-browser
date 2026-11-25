/**
 * Popup-side OWUI bridge client. All work runs in the background service worker
 * so opening a tab (which closes the popup) does not abort pairing.
 */

import type { BridgeStatus } from "./owui-bridge";
import { OWUI_STATUS_KEY, type OwuiRequest, type OwuiResponse } from "./owui-messages";

const idleStatus: BridgeStatus = {
  connected: false,
  connecting: false,
  stopped: false,
};

type StatusListener = (status: BridgeStatus) => void;

const localListeners = new Set<StatusListener>();

function notifyLocal(status: BridgeStatus) {
  for (const listener of localListeners) listener(status);
}

async function send(msg: OwuiRequest): Promise<OwuiResponse> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as OwuiResponse | undefined;
    if (!res) {
      return { ok: false, error: "No response from background", status: idleStatus };
    }
    if (res.status) notifyLocal(res.status);
    return res;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: idleStatus,
    };
  }
}

export function getBridgeStatus(): BridgeStatus {
  return idleStatus;
}

export function subscribeBridgeStatus(listener: StatusListener) {
  localListeners.add(listener);
  let cancelled = false;

  void (async () => {
    const stored = await chrome.storage.session.get(OWUI_STATUS_KEY);
    if (!cancelled && stored[OWUI_STATUS_KEY]) {
      listener(stored[OWUI_STATUS_KEY] as BridgeStatus);
    }
    const res = await send({ type: "owui/getStatus" });
    if (!cancelled && res.status) listener(res.status);
  })();

  // StorageArea.onChanged only receives `changes` (no areaName). Filtering on a
  // second "area" arg dropped every live update — disconnect looked stuck until reopen.
  const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    const next = changes[OWUI_STATUS_KEY]?.newValue as BridgeStatus | undefined;
    if (next) listener(next);
  };
  chrome.storage.session.onChanged.addListener(onChanged);

  return () => {
    cancelled = true;
    localListeners.delete(listener);
    chrome.storage.session.onChanged.removeListener(onChanged);
  };
}

export async function pairFromBrowserSession(baseUrl?: string | null) {
  // Background acknowledges immediately, then opens OWUI (popup will close).
  const res = await send({ type: "owui/pair", baseUrl });
  if (!res.ok && res.error) throw new Error(res.error);
  return true;
}

export async function loginAndConnect(baseUrl: string, email: string, password: string) {
  const res = await send({ type: "owui/login", baseUrl, email, password });
  if (!res.ok) throw new Error(res.error || "Sign-in failed");
}

export async function disconnectBridge() {
  const res = await send({ type: "owui/disconnect" });
  if (!res.ok) throw new Error(res.error || "Disconnect failed");
}

export async function setBridgeStopped(value: boolean) {
  const res = await send({ type: "owui/setStopped", value });
  if (!res.ok) throw new Error(res.error || "Failed to update stop state");
}

export async function setDeviceName(name: string) {
  const res = await send({ type: "owui/setDeviceName", name });
  if (!res.ok) throw new Error(res.error || "Failed to update browser name");
}

export async function restoreBridge() {
  await send({ type: "owui/restore" });
}

export async function chatWithTabFromPopup(pageTabId?: number) {
  const res = await send({ type: "owui/chatWithTab", pageTabId });
  if (!res.ok) throw new Error(res.error || "Chat with tab failed");
  return res;
}
