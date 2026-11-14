/// <reference types="wxt/vite-builder-env" />

interface ImportMetaEnv {
  /** Baked OWUI origin for install-time auto-pair. Empty in generic builds. */
  readonly WXT_OWUI_BASE_URL?: string;
  /** Instance label under the popup title (e.g. Additon). */
  readonly WXT_OWUI_BASE_NAME?: string;
}
