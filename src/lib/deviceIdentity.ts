/**
 * Privacy-conscious install identifier for desktop seat management.
 * Not a hardware fingerprint — random UUID persisted in localStorage / Electron userData.
 */

const STORAGE_KEY = 'mockup-studio.device-id.v1';

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getInstallDeviceId(): Promise<string> {
  try {
    const fromDesktop = await window.mockupDesktop?.getInstallDeviceId?.();
    if (fromDesktop && fromDesktop.length >= 16) return fromDesktop;
  } catch {
    /* fall through */
  }

  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 16) return existing;
    const next = randomId();
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return randomId();
  }
}

export function deviceLabelForUi(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Mac/.test(ua)) return 'This Mac';
  if (/Win/.test(ua)) return 'This PC';
  return 'This device';
}
