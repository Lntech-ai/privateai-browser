import { useEffect, useState } from "react";

import {
  disconnectBridge,
  getBridgeStatus,
  loginAndConnect,
  setBridgeStopped,
  subscribeBridgeStatus,
  type BridgeStatus,
} from "@/lib/owui-bridge";
import { resumeAgents, stopAgents } from "@/lib/browser-actions";

export function OwuiPanel() {
  const [status, setStatus] = useState<BridgeStatus>(getBridgeStatus());
  const [baseUrl, setBaseUrl] = useState(status.baseUrl || "http://localhost:8080");
  const [email, setEmail] = useState(status.email || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeBridgeStatus(setStatus), []);

  async function onLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await loginAndConnect(baseUrl, email, password);
      setPassword("");
    } catch {
      // error shown via status
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    try {
      await disconnectBridge();
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStop() {
    if (status.stopped) {
      await resumeAgents();
      await setBridgeStopped(false);
    } else {
      await stopAgents();
      await setBridgeStopped(true);
    }
  }

  const connected = status.connected;

  return (
    <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">Open WebUI</div>
          <div className="text-[11px] text-zinc-500">
            {connected
              ? `Connected as ${status.email || status.name || "user"}`
              : status.connecting
                ? "Connecting…"
                : "Sign in to register this browser"}
          </div>
        </div>
        <span
          className={`inline-block size-2 rounded-full ${
            connected ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
          }`}
          title={connected ? "Online" : "Offline"}
        />
      </div>

      {status.error ? (
        <div className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {status.error}
        </div>
      ) : null}

      {!connected ? (
        <form className="space-y-2" onSubmit={onLogin}>
          <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
            OWUI URL
            <input
              className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-900"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://ai.example.com"
              required
            />
          </label>
          <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
            Email
            <input
              className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-900"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
            Password
            <input
              className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-900"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <p className="text-[10px] leading-snug text-zinc-500">
            Signing in pairs this extension to your OWUI account and registers browser tools for
            your chats only.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-zinc-900 px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Signing in…" : "Sign in & connect"}
          </button>
        </form>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleStop}
            className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-[12px] dark:border-zinc-600"
          >
            {status.stopped ? "Resume" : "Stop"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDisconnect}
            className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-[12px] dark:border-zinc-600"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
