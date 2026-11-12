export type OwuiStoredAuth = {
  baseUrl: string;
  token: string;
  email?: string;
  name?: string;
  allowedOrigin?: string;
  pairedAt?: number;
  stopped?: boolean;
};

const KEY = "privateai_owui";

export async function getOwuiAuth(): Promise<OwuiStoredAuth | null> {
  const result = await chrome.storage.local.get(KEY);
  return (result[KEY] as OwuiStoredAuth | undefined) ?? null;
}

export async function setOwuiAuth(auth: OwuiStoredAuth): Promise<void> {
  await chrome.storage.local.set({ [KEY]: auth });
}

export async function clearOwuiAuth(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("OWUI URL is required");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OWUI URL must be http(s)");
  }
  return url.origin;
}
