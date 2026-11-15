import type { BridgeStatus } from "./owui-bridge";

export const OWUI_STATUS_KEY = "privateai_owui_status";

export type OwuiRequest =
  | { type: "owui/getStatus" }
  | { type: "owui/pair"; baseUrl?: string | null }
  | { type: "owui/login"; baseUrl: string; email: string; password: string }
  | { type: "owui/disconnect" }
  | { type: "owui/setStopped"; value: boolean }
  | { type: "owui/setDeviceName"; name: string }
  | { type: "owui/restore" };

export type OwuiResponse =
  | { ok: true; status: BridgeStatus; paired?: boolean }
  | { ok: false; error: string; status?: BridgeStatus };

export function isOwuiRequest(msg: unknown): msg is OwuiRequest {
  return !!msg && typeof msg === "object" && typeof (msg as { type?: unknown }).type === "string"
    && String((msg as { type: string }).type).startsWith("owui/");
}
