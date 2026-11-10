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

/**
 * Testing bypass — unlocks Pro Max entitlements without a key.
 * Keep `false` for freemium (few free devices; Pro unlocks the full library).
 */
export const LICENSING_DISABLED = false;

/** How the current entitlement was unlocked. `account` = Supabase-bound; `mas` reserved for App Store. */
export type LicenseSource = 'none' | 'key' | 'mas' | 'account';

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

const UNLOCKED_FOR_TESTING: LicenseState = {
  tier: 'pro_max',
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
  if (LICENSING_DISABLED) return { ...UNLOCKED_FOR_TESTING };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LICENSE };
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    const tier = parsed.tier === 'pro' || parsed.tier === 'pro_max' ? parsed.tier : 'free';
    const source: LicenseSource =
      parsed.source === 'key' || parsed.source === 'mas' || parsed.source === 'account'
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
      // Keep the Pro / Pro Max key — device downloads still need MS-PRO / MS-PROMAX.
      updatesUntil: monthsFrom(current.updatesUntil, 12),
      activatedAt: nowIso,
      source: current.source === 'account' ? 'account' : 'key',
    };
    saveLicense(state);
    return { ok: true, state };
  }

  const months = ENTITLEMENTS[parsed.product].updateMonths;
  let state: LicenseState = {
    tier: parsed.product,
    key: parsed.key,
    updatesUntil: months > 0 ? monthsFrom(null, months) : null,
    activatedAt: nowIso,
    source: 'key',
  };
  saveLicense(state);

  // When signed in, bind the grandfathered key to the account (server-validated).
  try {
    const { bindLicenseKeyToAccount } = await import('./entitlements');
    const bound = await bindLicenseKeyToAccount(parsed.key);
    if (bound.ok) {
      state = {
        ...state,
        source: 'account',
        updatesUntil: bound.updatesUntil ?? state.updatesUntil,
        activatedAt: bound.activatedAt ?? state.activatedAt,
      };
      saveLicense(state);
    }
  } catch {
    /* Offline / unsigned — local key still works. */
  }

  return { ok: true, state };
}

export function clearLicense(): LicenseState {
  saveLicense(DEFAULT_LICENSE);
  return { ...DEFAULT_LICENSE };
}

export function entitlementsFor(tier: LicenseTier) {
  return ENTITLEMENTS[LICENSING_DISABLED ? 'pro_max' : tier];
}

/** True for the freemium starter set (and custom imports). Paid catalog devices are Pro. */
export function isFreeDevice(deviceId: string): boolean {
  if (deviceId.startsWith('custom-')) return true;
  // Brand-free procedural shapes — always available; no licensed mesh download.
  if (deviceId.startsWith('generic_')) return true;
  return (FREE_DEVICE_IDS as readonly string[]).includes(deviceId);
}

export function isDeviceUnlocked(tier: LicenseTier, deviceId: string): boolean {
  if (LICENSING_DISABLED || ENTITLEMENTS[tier].allDevices) return true;
  return isFreeDevice(deviceId);
}

/**
 * License key sent to the model CDN for paid devices.
 * Free devices omit this; Pro / Pro Max require a verified MS-PRO / MS-PROMAX key.
 */
export function modelAccessLicenseKey(license: LicenseState = loadLicense()): string | null {
  if (!license.key) return null;
  const key = license.key.trim().replace(/\s+/g, '');
  if (/^MS-PROMAX\./.test(key) || /^MS-PRO\./.test(key)) return key;
  return null;
}

export function maxDevicesFor(tier: LicenseTier): number {
  return ENTITLEMENTS[LICENSING_DISABLED ? 'pro_max' : tier].maxDevicesInScene;
}

export function canExportVideo(tier: LicenseTier): boolean {
  return LICENSING_DISABLED || ENTITLEMENTS[tier].videoExport;
}

export function maxStillLongEdge(tier: LicenseTier): number {
  return ENTITLEMENTS[LICENSING_DISABLED ? 'pro_max' : tier].maxStillLongEdge;
}

export function isResolutionAllowed(tier: LicenseTier, longEdge: number): boolean {
  if (LICENSING_DISABLED) return true;
  return longEdge <= ENTITLEMENTS[tier].maxStillLongEdge;
}

export function planLabel(tier: LicenseTier): string {
  if (LICENSING_DISABLED) return 'Pro Max (test)';
  if (tier === 'pro_max') return 'Pro Max';
  if (tier === 'pro') return 'Pro';
  return 'Free';
}

export function planPriceLabel(tier: LicenseTier | 'update_pass'): string {
  return planById(tier === 'update_pass' ? 'update_pass' : tier === 'pro_max' ? 'pro_max' : tier === 'pro' ? 'pro' : 'free').priceLabel;
}
