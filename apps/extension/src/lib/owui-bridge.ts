import { io, type Socket } from "socket.io-client";

import { handleAction, isStopped, setStopped } from "./browser-actions";
import {
  fetchSessionUser,
  openOwuiTab,
  resolveOwuiBaseUrl,
  waitForTokenInTab,
} from "./owui-session";
import { isOwuiRequest, OWUI_STATUS_KEY, type OwuiRequest, type OwuiResponse } from "./owui-messages";
import { getOwuiDevice, setOwuiDeviceName } from "./owui-device";
import {
  clearOwuiAuth,
  getOwuiAuth,
  normalizeBaseUrl,
  setOwuiAuth,
  type OwuiStoredAuth,
} from "./owui-storage";

export type BridgeStatus = {
  connected: boolean;
  connecting: boolean;
  baseUrl?: string;
  email?: string;
  name?: string;
  deviceId?: string;
  deviceName?: string;
  paired?: boolean;
  stopped: boolean;
  error?: string;
};

type StatusListener = (status: BridgeStatus) => void;

let socket: Socket | null = null;
let status: BridgeStatus = { connected: false, connecting: false, stopped: false };
const listeners = new Set<StatusListener>();
let autoPairInFlight: Promise<boolean> | null = null;
let handlersRegistered = false;

function emitStatus(partial?: Partial<BridgeStatus>) {
  status = { ...status, ...partial, stopped: isStopped() };
  for (const listener of listeners) listener(status);
  // Popup reads this after it closes (opening a tab kills the popup).
  void chrome.storage.session.set({ [OWUI_STATUS_KEY]: status });
}

export function subscribeBridgeStatus(listener: StatusListener) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

export function getBridgeStatus() {
  return status;
}

async function withDevice(auth: OwuiStoredAuth): Promise<OwuiStoredAuth> {
  const device = await getOwuiDevice();
  return {
    ...auth,
    deviceId: device.id,
    deviceName: device.name,
  };
}

async function signIn(baseUrl: string, email: string, password: string) {
  const origin = normalizeBaseUrl(baseUrl);
  const res = await fetch(`${origin}/api/v1/auths/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.detail || body?.message || `Sign-in failed (${res.status})`);
  }
  const token = body.token as string | undefined;
  if (!token) throw new Error("Sign-in response missing token");
  const auth = await withDevice({
    baseUrl: origin,
    token,
    email: body.email || email,
    name: body.name,
    allowedOrigin: origin,
    pairedAt: Date.now(),
  });
  await setOwuiAuth(auth);
  return auth;
}

export async function loginAndConnect(baseUrl: string, email: string, password: string) {
  emitStatus({ connecting: true, error: undefined });
  try {
    const auth = await signIn(baseUrl, email, password);
    await connectSocket(auth);
  } catch (error) {
    emitStatus({
      connecting: false,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Persist a harvested/session JWT and open the Socket.IO bridge. */
export async function connectWithToken(
  baseUrl: string,
  token: string,
  profile?: { email?: string; name?: string },
) {
  emitStatus({ connecting: true, error: undefined, baseUrl: normalizeBaseUrl(baseUrl) });
  try {
    const origin = normalizeBaseUrl(baseUrl);
    const session = await fetchSessionUser(origin, token);
    const auth = await withDevice({
      baseUrl: origin,
      token: session.token,
      email: session.email || profile?.email,
      name: session.name || profile?.name,
      allowedOrigin: origin,
      pairedAt: Date.now(),
    });
    await setOwuiAuth(auth);
    await connectSocket(auth);
  } catch (error) {
    emitStatus({
      connecting: false,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Open the OWUI origin from user input, wait for a browser session JWT,
 * then connect the bridge. Used from the popup "Connect" button.
 */
export async function pairFromBrowserSession(explicitBaseUrl?: string | null): Promise<boolean> {
  if (autoPairInFlight) return autoPairInFlight;

  autoPairInFlight = (async () => {
    try {
      const origin = resolveOwuiBaseUrl(explicitBaseUrl);
      if (!origin) {
        emitStatus({ error: "Enter your Open WebUI URL" });
        return false;
      }

      const existing = await getOwuiAuth();
      if (existing?.token && existing.baseUrl === origin && status.connected) {
        return true;
      }

      emitStatus({
        connecting: true,
        baseUrl: origin,
        error: undefined,
      });

      const tab = await openOwuiTab(origin, true);
      if (tab.id == null) throw new Error("Could not open OWUI tab");

      const token = await waitForTokenInTab(tab.id);
      if (!token) {
        emitStatus({
          connecting: false,
          connected: false,
          baseUrl: origin,
          error: "Sign in to PrivateAI in the opened tab, then click Connect again",
        });
        return false;
      }

      await connectWithToken(origin, token);
      return true;
    } catch (error) {
      emitStatus({
        connecting: false,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      autoPairInFlight = null;
    }
  })();

  return autoPairInFlight;
}

export async function disconnectBridge() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  const device = await getOwuiDevice();
  await clearOwuiAuth();
  emitStatus({
    connected: false,
    connecting: false,
    baseUrl: undefined,
    email: undefined,
    name: undefined,
    deviceId: device.id,
    deviceName: device.name,
    paired: false,
    error: undefined,
  });
}

export async function restoreBridge() {
  const auth = await getOwuiAuth();
  const device = await getOwuiDevice();
  if (!auth?.token || !auth.baseUrl) {
    emitStatus({
      deviceId: device.id,
      deviceName: device.name,
    });
    return;
  }
  setStopped(!!auth.stopped);
  const withIds = await withDevice(auth);
  if (withIds.deviceId !== auth.deviceId || withIds.deviceName !== auth.deviceName) {
    await setOwuiAuth(withIds);
  }
  emitStatus({
    connecting: true,
    baseUrl: withIds.baseUrl,
    email: withIds.email,
    name: withIds.name,
    deviceId: withIds.deviceId,
    deviceName: withIds.deviceName,
    paired: !!withIds.pairedAt,
  });
  try {
    await connectSocket(withIds);
  } catch (error) {
    emitStatus({
      connecting: false,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateDeviceName(name: string) {
  const device = await setOwuiDeviceName(name);
  const auth = await getOwuiAuth();
  if (auth) {
    await setOwuiAuth({ ...auth, deviceId: device.id, deviceName: device.name });
  }
  emitStatus({ deviceId: device.id, deviceName: device.name });
  // Reconnect so OWUI picks up the new label while keeping the same id.
  if (auth?.token && auth.baseUrl && status.connected) {
    await connectSocket({ ...auth, deviceId: device.id, deviceName: device.name });
  }
  return device;
}

async function connectSocket(auth: OwuiStoredAuth) {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  const device = await getOwuiDevice();
  const deviceId = auth.deviceId || device.id;
  const deviceName = auth.deviceName || device.name;

  emitStatus({
    connecting: true,
    baseUrl: auth.baseUrl,
    email: auth.email,
    name: auth.name,
    deviceId,
    deviceName,
    paired: !!auth.pairedAt,
    error: undefined,
  });

  const next = io(auth.baseUrl, {
    path: "/ws/socket.io",
    transports: ["websocket", "polling"],
    auth: {
      token: auth.token,
      client_type: "browser_bridge",
      client_id: deviceId,
      client_name: deviceName,
    },
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 15000,
  });

  socket = next;

  next.on("connect", () => {
    emitStatus({
      connected: true,
      connecting: false,
      error: undefined,
      deviceId,
      deviceName,
    });
  });

  next.on("disconnect", () => {
    emitStatus({ connected: false, connecting: false });
  });

  next.on("connect_error", (err) => {
    emitStatus({
      connected: false,
      connecting: false,
      error: err?.message || "Socket connection failed",
    });
  });

  // OWUI uses sio.call('events', ...) — answer with the ack callback.
  next.on("events", async (payload: { data?: { type?: string; data?: any } }, ack?: (result: unknown) => void) => {
    const event = payload?.data;
    if (!event || event.type !== "request:browser_bridge") {
      ack?.({ ok: false, error: "Unsupported event" });
      return;
    }
    const action = event.data?.action as string;
    const params = (event.data?.params || {}) as Record<string, unknown>;
    try {
      const result = await handleAction(action, params);
      ack?.(result);
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function setBridgeStopped(value: boolean) {
  setStopped(value);
  const auth = await getOwuiAuth();
  if (auth) {
    await setOwuiAuth({ ...auth, stopped: value });
  }
  emitStatus({ stopped: value });
}

async function handleOwuiRequest(msg: OwuiRequest): Promise<OwuiResponse> {
  try {
    switch (msg.type) {
      case "owui/getStatus":
        return { ok: true, status: getBridgeStatus() };
      case "owui/pair": {
        // Do not await: opening the OWUI tab closes the popup and drops the
        // message port. Kick off pairing in this SW and acknowledge immediately.
        emitStatus({
          connecting: true,
          baseUrl: resolveOwuiBaseUrl(msg.baseUrl) || undefined,
          error: undefined,
        });
        void pairFromBrowserSession(msg.baseUrl);
        return { ok: true, status: getBridgeStatus(), paired: false };
      }
      case "owui/login":
        await loginAndConnect(msg.baseUrl, msg.email, msg.password);
        return { ok: true, status: getBridgeStatus() };
      case "owui/disconnect":
        await disconnectBridge();
        return { ok: true, status: getBridgeStatus() };
      case "owui/setStopped":
        await setBridgeStopped(msg.value);
        return { ok: true, status: getBridgeStatus() };
      case "owui/setDeviceName":
        await updateDeviceName(msg.name);
        return { ok: true, status: getBridgeStatus() };
      case "owui/restore":
        await restoreBridge();
        return { ok: true, status: getBridgeStatus() };
      default:
        return { ok: false, error: "Unknown OWUI message", status: getBridgeStatus() };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: getBridgeStatus(),
    };
  }
}

/** Register runtime message handlers so the popup can drive the bridge in this SW. */
export function registerOwuiBridgeHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  emitStatus();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isOwuiRequest(message)) return;
    void handleOwuiRequest(message).then(sendResponse);
    return true; // async response
  });
}
