import { LICENSE_PUBLIC_KEY_SPKI_B64 } from './licensePublicKey';
import type { LicenseTier } from './license';

const STORAGE_KEY = 'mockup-studio.offline-entitlement.v1';

export type OfflineEntitlement = {
  token: string;
  tier: LicenseTier;
  plan: string;
  status: string;
  expiresAt: string;
  updatesUntil: string | null;
  periodEnd: string | null;
};

type OfflinePayload = {
  v: number;
  typ?: string;
  tier?: string;
  plan?: string;
  status?: string;
  periodEnd?: string | null;
  updatesUntil?: string | null;
  exp?: number;
};

function b64UrlToBytes(value: string): Uint8Array {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function verifyOfflineToken(token: string): Promise<OfflinePayload | null> {
  const match = /^MS-OFFLINE\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  const payloadBytes = b64UrlToBytes(match[1]);
  let payload: OfflinePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as OfflinePayload;
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.typ !== 'offline_entitlement') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;

  try {
    const pad = '='.repeat((4 - (LICENSE_PUBLIC_KEY_SPKI_B64.length % 4)) % 4);
    const spkiBin = atob(LICENSE_PUBLIC_KEY_SPKI_B64 + pad);
    const spki = new Uint8Array(spkiBin.length);
    for (let i = 0; i < spkiBin.length; i += 1) spki[i] = spkiBin.charCodeAt(i);
    const key = await crypto.subtle.importKey(
      'spki',
      asBufferSource(spki),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'Ed25519',
      key,
      asBufferSource(b64UrlToBytes(match[2])),
      asBufferSource(payloadBytes),
    );
    return ok ? payload : null;
  } catch {
    return null;
  }
}

export function loadOfflineEntitlement(): OfflineEntitlement | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OfflineEntitlement;
  } catch {
    return null;
  }
}

export function saveOfflineEntitlement(value: OfflineEntitlement | null): void {
  try {
    if (!value) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function readValidOfflineEntitlement(): Promise<OfflineEntitlement | null> {
  const stored = loadOfflineEntitlement();
  if (!stored?.token) return null;
  const payload = await verifyOfflineToken(stored.token);
  if (!payload) {
    saveOfflineEntitlement(null);
    return null;
  }
  const tier: LicenseTier = payload.tier === 'pro_max' ? 'pro_max' : payload.tier === 'pro' ? 'pro' : 'free';
  if (tier === 'free') return null;
  return {
    ...stored,
    tier,
    plan: payload.plan ?? stored.plan,
    status: payload.status ?? stored.status,
    expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    updatesUntil: payload.updatesUntil ?? null,
    periodEnd: payload.periodEnd ?? null,
  };
}
