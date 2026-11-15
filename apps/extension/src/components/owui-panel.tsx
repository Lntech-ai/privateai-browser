import { useEffect, useState } from "react";

import type { BridgeStatus } from "@/lib/owui-bridge";
import {
  disconnectBridge,
  getBridgeStatus,
  loginAndConnect,
  pairFromBrowserSession,
  setBridgeStopped,
  setDeviceName,
  subscribeBridgeStatus,
} from "@/lib/owui-client";
import { resumeAgents, stopAgents } from "@/lib/browser-actions";

export function OwuiPanel({
  baseUrl,
  onBaseUrlChange,
}: {
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
}) {
  const [status, setStatus] = useState<BridgeStatus>(getBridgeStatus());
  const [email, setEmail] = useState(status.email || "");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceNameInput] = useState(status.deviceName || "");
  const [showPasswordForm, setShowPasswordForm] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeBridgeStatus(setStatus), []);

  useEffect(() => {
    if (status.baseUrl) onBaseUrlChange(status.baseUrl);
    if (status.email) setEmail(status.email);
    if (status.deviceName) setDeviceNameInput(status.deviceName);
  }, [status.baseUrl, status.email, status.deviceName, onBaseUrlChange]);

  async function persistDeviceName() {
    const next = deviceName.trim();
    if (!next || next === status.deviceName) return;
    await setDeviceName(next);
  }

  async function onLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await persistDeviceName();
      await loginAndConnect(baseUrl, email, password);
      setPassword("");
    } catch {
      // error shown via status
    } finally {
      setBusy(false);
    }
  }

  async function onConnectSession() {
    setBusy(true);
    try {
      await persistDeviceName();
      // Background opens the OWUI tab; Chrome closes this popup on focus change,
      // so pairing must not run in the popup context.
      await pairFromBrowserSession(baseUrl);
    } catch {
      // error shown via status (storage) when popup is reopened
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
  const shortId = status.deviceId ? status.deviceId.slice(0, 8) : "";

  return (
    <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">PrivateAI</div>
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

      <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
        Device name
        <input
          className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-900"
          value={deviceName}
          onChange={(e) => setDeviceNameInput(e.target.value)}
          onBlur={() => void persistDeviceName()}
          placeholder="e.g. Office PC"
          maxLength={64}
        />
      </label>
      {shortId ? (
        <p className="text-[10px] leading-snug text-zinc-500" title={status.deviceId}>
          ID: <span className="font-mono text-zinc-600 dark:text-zinc-400">{shortId}…</span>
          {connected && status.deviceName
            ? ` · shown in OWUI as “${status.deviceName}”`
            : " · unique per install even if names match"}
        </p>
      ) : null}

      {!connected ? (
        <div className="space-y-2">
          <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
            OWUI URL
            <input
              className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-900"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
              placeholder="https://example.com"
              required
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void onConnectSession()}
            className="w-full rounded bg-zinc-900 px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Connecting…" : "Connect with browser session"}
          </button>
          <p className="text-[10px] leading-snug text-zinc-500">
            Opens PrivateAI and pairs using your existing login. If you are not signed in, sign in
            there.
          </p>

          {showPasswordForm ? (
            <form className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-700" onSubmit={onLogin}>
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
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded border border-zinc-300 px-2 py-1.5 text-[12px] dark:border-zinc-600 disabled:opacity-50"
              >
                {busy ? "Signing in…" : "Sign in & connect"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="w-full text-[11px] text-zinc-500 underline"
              onClick={() => setShowPasswordForm(true)}
            >
              Use email / password instead
            </button>
          )}
        </div>
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
