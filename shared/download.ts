function readEnv(name: string): string | undefined {
  try {
    const value = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    /* non-vite contexts */
  }
  return undefined;
}

/** Direct URL to the macOS Apple Silicon .dmg (GitHub Release, CDN, etc.). */
export function getMacDownloadUrl(): string | undefined {
  return readEnv('VITE_DOWNLOAD_MAC_URL');
}

export function isMacDownloadConfigured(url = getMacDownloadUrl()): boolean {
  return Boolean(url);
}

/**
 * Href for download CTAs. When unset, falls back to the landing #download section
 * so the page can explain that the build is not hosted yet.
 */
export function macDownloadHref(fallback = '#download'): string {
  return getMacDownloadUrl() || fallback;
}

export function macDownloadLabel(short = false): string {
  if (short) return 'Download Free';
  return 'Download Free for Mac';
}
