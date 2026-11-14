# PrivateAI Browser

Fork of [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp) (Apache-2.0) rebranded for **Open WebUI / PrivateAI**.

This extension connects **out** to your Open WebUI instance over Socket.IO, registers as a per-user **browser bridge**, and executes chat tool calls (`browser_navigate`, `browser_screenshot`, …) with `chrome.debugger` on your machine. No WireGuard or companion app.

## Install (load unpacked)

1. Node.js 24+, `corepack enable`, then:

   ```sh
   pnpm install
   # Optional: bake the OWUI origin + instance label so users never type the URL
   WXT_OWUI_BASE_URL=https://ai.example.com \
   WXT_OWUI_BASE_NAME=Additon \
     pnpm --filter @privateai/browser-extension build
   ```

   Or copy `apps/extension/.env.example` → `apps/extension/.env` and set
   `WXT_OWUI_BASE_URL` / `WXT_OWUI_BASE_NAME`.

2. Open `chrome://extensions` → Developer mode → **Load unpacked** →
   `apps/extension/.output/chrome-mv3`.

3. Extension ID (stable via manifest key): `dabljdanjgbacbhfliadnoopcfaneeon`.

4. **With a baked URL:** on first install the extension opens OWUI and pairs from your
   existing browser session (no popup URL/password). If you are not signed in yet, sign
   in on that tab — or use **Connect with browser session** in the popup.

   **Without a baked URL:** open the popup → enter your OWUI URL → connect via session
   or email/password.

5. In OWUI chat (with native tools / builtin tools enabled), browser tools appear when the extension is **online**.

## OWUI requirements

- Permission `features.browser_bridge` (default on via `USER_PERMISSIONS_FEATURES_BROWSER_BRIDGE`).
- If `CORS_ALLOW_ORIGIN` is not `*`, allow the extension origin:

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
