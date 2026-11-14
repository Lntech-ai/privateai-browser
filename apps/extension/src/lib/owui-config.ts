import { normalizeBaseUrl } from "./owui-storage";

type OwuiEnv = {
  WXT_OWUI_BASE_URL?: string;
  WXT_OWUI_BASE_NAME?: string;
};

/**
 * Build-time OWUI origin. Set via `WXT_OWUI_BASE_URL` when building the extension
 * (e.g. `WXT_OWUI_BASE_URL=https://ai.example.com pnpm build`). Empty = user must
 * enter the URL in the popup (dev / generic builds).
 */
export function getBakedOwuiBaseUrl(
  env: OwuiEnv = import.meta.env as OwuiEnv,
): string | null {
  const raw = String(env.WXT_OWUI_BASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return normalizeBaseUrl(raw);
  } catch {
    return null;
  }
}

export function hasBakedOwuiBaseUrl(env: OwuiEnv = import.meta.env as OwuiEnv): boolean {
  return getBakedOwuiBaseUrl(env) !== null;
}

/**
 * Build-time instance label shown under the popup title (e.g. "Additon").
 * Set via `WXT_OWUI_BASE_NAME`.
 */
export function getBakedOwuiBaseName(
  env: OwuiEnv = import.meta.env as OwuiEnv,
): string | null {
  const raw = String(env.WXT_OWUI_BASE_NAME ?? "").trim();
  return raw || null;
}
