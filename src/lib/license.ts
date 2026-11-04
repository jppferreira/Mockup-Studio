import {
  ENTITLEMENTS,
  FREE_DEVICE_IDS,
  PLAN_PRICES_GBP,
  PLANS,
  UPDATE_PASS,
  formatGbp,
  planById,
  upgradeCopy,
  type LicenseTier,
  type PlanId,
} from '@shared/pricing';
import { LICENSE_PUBLIC_KEY_SPKI_B64 } from './licensePublicKey';

export {
  ENTITLEMENTS,
  FREE_DEVICE_IDS,
  PLAN_PRICES_GBP,
  PLANS,
  UPDATE_PASS,
  formatGbp,
  planById,
  upgradeCopy,
};
export type { LicenseTier, PlanId };

const STORAGE_KEY = 'mockup-studio.license.v1';

/** How the current entitlement was unlocked. `mas` reserved for a future App Store build. */
export type LicenseSource = 'none' | 'key' | 'mas';

export interface LicenseState {
  tier: LicenseTier;
  /** Activated license key (if any) */
  key: string | null;
  /** ISO date when paid updates expire (Pro / Pro Max / Update Pass) */
  updatesUntil: string | null;
  activatedAt: string | null;
  /** Channel that granted the tier — gates stay tier-based for MAS later */
  source: LicenseSource;
}

const DEFAULT_LICENSE: LicenseState = {
  tier: 'free',
  key: null,
  updatesUntil: null,
  activatedAt: null,
  source: 'none',
};

export type LicenseProduct = 'pro' | 'pro_max' | 'update_pass';

interface LicensePayload {
  v: number;
  tier: LicenseProduct;
  iat: number;
}

function monthsFrom(isoOrNow: string | null, months: number): string {
  const d = isoOrNow ? new Date(isoOrNow) : new Date();
  const base = Number.isNaN(d.getTime()) || d.getTime() < Date.now() ? new Date() : d;
  base.setMonth(base.getMonth() + months);
  return base.toISOString();
}

function b64UrlToBytes(value: string): Uint8Array {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copy into a standalone ArrayBuffer — required by some SubtleCrypto backends. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function prefixProduct(prefix: string): LicenseProduct | null {
  if (prefix === 'MS-PROMAX') return 'pro_max';
  if (prefix === 'MS-PRO') return 'pro';
  if (prefix === 'MS-UPDATE') return 'update_pass';
  return null;
}

function decodeSpki(): Uint8Array {
  const pad = '='.repeat((4 - (LICENSE_PUBLIC_KEY_SPKI_B64.length % 4)) % 4);
  const bin = atob(LICENSE_PUBLIC_KEY_SPKI_B64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

let verifyKeyPromise: Promise<CryptoKey> | null = null;

function getVerifyKey(): Promise<CryptoKey> {
  if (!verifyKeyPromise) {
    verifyKeyPromise = crypto.subtle.importKey(
      'spki',
      asBufferSource(decodeSpki()),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  }
  return verifyKeyPromise;
}

/**
 * Parse + cryptographically verify a signed key.
 * Format: MS-PRO.<payloadB64url>.<sigB64url> (also MS-PROMAX / MS-UPDATE)
 */
export async function parseLicenseKey(
  raw: string,
): Promise<{ product: LicenseProduct; key: string; payload: LicensePayload } | null> {
  const key = raw.trim().replace(/\s+/g, '');
  if (!key) return null;

  const match = /^(MS-PROMAX|MS-PRO|MS-UPDATE)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!match) return null;

  const productFromPrefix = prefixProduct(match[1]);
  if (!productFromPrefix) return null;

  const payloadBytes = b64UrlToBytes(match[2]);
  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
  } catch {
    return null;
  }

  if (payload.v !== 1) return null;
  if (payload.tier !== productFromPrefix) return null;
  if (payload.tier !== 'pro' && payload.tier !== 'pro_max' && payload.tier !== 'update_pass') {
    return null;
  }
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return null;

  try {
    const cryptoKey = await getVerifyKey();
    const ok = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      asBufferSource(b64UrlToBytes(match[3])),
      asBufferSource(payloadBytes),
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  return { product: payload.tier, key, payload };
}

export function loadLicense(): LicenseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LICENSE };
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    const tier = parsed.tier === 'pro' || parsed.tier === 'pro_max' ? parsed.tier : 'free';
    const source: LicenseSource =
      parsed.source === 'key' || parsed.source === 'mas'
        ? parsed.source
        : tier === 'free'
          ? 'none'
          : 'key';
    return {
      tier,
      key: typeof parsed.key === 'string' ? parsed.key : null,
      updatesUntil: typeof parsed.updatesUntil === 'string' ? parsed.updatesUntil : null,
      activatedAt: typeof parsed.activatedAt === 'string' ? parsed.activatedAt : null,
      source: tier === 'free' ? 'none' : source,
    };
  } catch {
    return { ...DEFAULT_LICENSE };
  }
}

export function saveLicense(state: LicenseState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function activateLicenseKey(
  raw: string,
  current: LicenseState = loadLicense(),
): Promise<{ ok: true; state: LicenseState } | { ok: false; error: string }> {
  const parsed = await parseLicenseKey(raw);
  if (!parsed) {
    return {
      ok: false,
      error: `Invalid or forged key. Buy on the website — keys look like MS-PRO.<payload>.<sig> (${formatGbp(PLAN_PRICES_GBP.pro)}).`,
    };
  }

  const nowIso = new Date().toISOString();

  if (parsed.product === 'update_pass') {
    if (current.tier === 'free') {
      return {
        ok: false,
        error: 'Update Pass extends an existing Pro or Pro Max license. Activate Pro first.',
      };
    }
    const state: LicenseState = {
      ...current,
      key: parsed.key,
      updatesUntil: monthsFrom(current.updatesUntil, 12),
      activatedAt: nowIso,
      source: 'key',
    };
    saveLicense(state);
    return { ok: true, state };
  }

  const months = ENTITLEMENTS[parsed.product].updateMonths;
  const state: LicenseState = {
    tier: parsed.product,
    key: parsed.key,
    updatesUntil: months > 0 ? monthsFrom(null, months) : null,
    activatedAt: nowIso,
    source: 'key',
  };
  saveLicense(state);
  return { ok: true, state };
}

export function clearLicense(): LicenseState {
  saveLicense(DEFAULT_LICENSE);
  return { ...DEFAULT_LICENSE };
}

export function entitlementsFor(tier: LicenseTier) {
  return ENTITLEMENTS[tier];
}

export function isDeviceUnlocked(tier: LicenseTier, deviceId: string): boolean {
  if (ENTITLEMENTS[tier].allDevices) return true;
  if (deviceId.startsWith('custom-')) return true;
  return (FREE_DEVICE_IDS as readonly string[]).includes(deviceId);
}

export function maxDevicesFor(tier: LicenseTier): number {
  return ENTITLEMENTS[tier].maxDevicesInScene;
}

export function canExportVideo(tier: LicenseTier): boolean {
  return ENTITLEMENTS[tier].videoExport;
}

export function maxStillLongEdge(tier: LicenseTier): number {
  return ENTITLEMENTS[tier].maxStillLongEdge;
}

export function isResolutionAllowed(tier: LicenseTier, longEdge: number): boolean {
  return longEdge <= ENTITLEMENTS[tier].maxStillLongEdge;
}

export function planLabel(tier: LicenseTier): string {
  if (tier === 'pro_max') return 'Pro Max';
  if (tier === 'pro') return 'Pro';
  return 'Free';
}

export function planPriceLabel(tier: LicenseTier | 'update_pass'): string {
  return planById(tier === 'update_pass' ? 'update_pass' : tier === 'pro_max' ? 'pro_max' : tier === 'pro' ? 'pro' : 'free').priceLabel;
}
