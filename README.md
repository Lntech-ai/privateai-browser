# PrivateAI Browser

Fork of [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp) (Apache-2.0) rebranded for **Open WebUI / PrivateAI**.

This extension connects **out** to your Open WebUI instance over Socket.IO, registers as a per-user **browser bridge**, and executes chat tool calls (`browser_navigate`, `browser_screenshot`, …) with `chrome.debugger` on your machine. No WireGuard or companion app.

## Chrome Web Store

Pushes to `main` build the extension, create a GitHub Release, and submit the zip to the
[Chrome Web Store](https://chromewebstore.google.com/detail/bknhphccokmmlbjcmlnnlanpcoebhfbp)
via `.github/workflows/release-extension.yml`. Bump `apps/extension/package.json` `version`
before merging — the store rejects uploads that do not increase the version.

## Install (load unpacked)

1. Node.js 24+, `corepack enable`, then:

   ```sh
   pnpm install
   pnpm --filter @privateai/browser-extension build
   ```

2. Open `chrome://extensions` → Developer mode → **Load unpacked** →
   `apps/extension/.output/chrome-mv3`.

3. Extension ID: development builds (`pnpm --filter @privateai/browser-extension build:dev`)
   keep a stable ID via manifest `key` (`dabljdanjgbacbhfliadnoopcfaneeon`).
   Chrome Web Store builds omit `key` (required by the store) and get a store-assigned ID —
   put that ID in your OWUI CORS allowlist after publishing.

4. Open the popup → set a **Browser name** (label) → enter your OWUI URL → connect via
   browser session or email/password. Each install also has a unique **ID**; OWUI can keep
   multiple extensions online under the same account and target one by id or name.
   The popup title shows the URL you connected to.

5. In OWUI chat (with native tools / builtin tools enabled), browser tools appear when the extension is **online**.

## OWUI requirements

- Permission `features.browser_bridge` (default on via `USER_PERMISSIONS_FEATURES_BROWSER_BRIDGE`).
- If `CORS_ALLOW_ORIGIN` is not `*`, allow the extension origin (dev ID shown; replace with the
  Chrome Web Store ID after publish):

  ```env
  CORS_ALLOW_CUSTOM_SCHEME=chrome-extension
  CORS_ALLOW_ORIGIN=https://your-owui;chrome-extension://dabljdanjgbacbhfliadnoopcfaneeon
  ```

- Status API: `GET /api/v1/browser-bridge/status` (Bearer JWT).

## Upstream local daemon

The original Browser MCP local-daemon path remains available for Cursor/Claude-style stdio MCP. The **OWUI path does not use it**.

## License

Apache-2.0. This is an independent fork; it is not the official Browser MCP product.
See upstream [LICENSE](LICENSE) and attribution obligations.
