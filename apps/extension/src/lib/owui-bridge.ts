import { io, type Socket } from "socket.io-client";

import { handleAction, isStopped, setStopped } from "./browser-actions";
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
  paired?: boolean;
  stopped: boolean;
  error?: string;
};

type StatusListener = (status: BridgeStatus) => void;

let socket: Socket | null = null;
let status: BridgeStatus = { connected: false, connecting: false, stopped: false };
const listeners = new Set<StatusListener>();

function emitStatus(partial?: Partial<BridgeStatus>) {
  status = { ...status, ...partial, stopped: isStopped() };
  for (const listener of listeners) listener(status);
}

export function subscribeBridgeStatus(listener: StatusListener) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function getBridgeStatus() {
  return status;
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
  const auth: OwuiStoredAuth = {
    baseUrl: origin,
    token,
    email: body.email || email,
    name: body.name,
    allowedOrigin: origin,
    pairedAt: Date.now(),
  };
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

export async function disconnectBridge() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  await clearOwuiAuth();
  emitStatus({
    connected: false,
    connecting: false,
    baseUrl: undefined,
    email: undefined,
    name: undefined,
    paired: false,
    error: undefined,
  });
}

export async function restoreBridge() {
  const auth = await getOwuiAuth();
  if (!auth?.token || !auth.baseUrl) return;
  setStopped(!!auth.stopped);
  emitStatus({
    connecting: true,
    baseUrl: auth.baseUrl,
    email: auth.email,
    name: auth.name,
    paired: !!auth.pairedAt,
  });
  try {
    await connectSocket(auth);
  } catch (error) {
    emitStatus({
      connecting: false,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function connectSocket(auth: OwuiStoredAuth) {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  emitStatus({
    connecting: true,
    baseUrl: auth.baseUrl,
    email: auth.email,
    name: auth.name,
    paired: !!auth.pairedAt,
    error: undefined,
  });

  const next = io(auth.baseUrl, {
    path: "/ws/socket.io",
    transports: ["websocket", "polling"],
    auth: {
      token: auth.token,
      client_type: "browser_bridge",
    },
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 15000,
  });

  socket = next;

  next.on("connect", () => {
    emitStatus({ connected: true, connecting: false, error: undefined });
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
