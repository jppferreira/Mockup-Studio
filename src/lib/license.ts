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

export interface LicenseState {
  tier: LicenseTier;
  /** Activated license key (if any) */
  key: string | null;
  /** ISO date when paid updates expire (Pro / Pro Max) */
  updatesUntil: string | null;
  activatedAt: string | null;
}

const DEFAULT_LICENSE: LicenseState = {
  tier: 'free',
  key: null,
  updatesUntil: null,
  activatedAt: null,
};

function monthsFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

/** Simple offline key format for launch: MS-PRO-XXXXXX / MS-PROMAX-XXXXXX */
export function parseLicenseKey(raw: string): { tier: LicenseTier; key: string } | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!key) return null;

  const proMax = /^MS-PROMAX-([A-Z0-9]{6,16})$/.exec(key);
  if (proMax) return { tier: 'pro_max', key };

  const pro = /^MS-PRO-([A-Z0-9]{6,16})$/.exec(key);
  if (pro) return { tier: 'pro', key };

  return null;
}

export function loadLicense(): LicenseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LICENSE };
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    const tier = parsed.tier === 'pro' || parsed.tier === 'pro_max' ? parsed.tier : 'free';
    return {
      tier,
      key: typeof parsed.key === 'string' ? parsed.key : null,
      updatesUntil: typeof parsed.updatesUntil === 'string' ? parsed.updatesUntil : null,
      activatedAt: typeof parsed.activatedAt === 'string' ? parsed.activatedAt : null,
    };
  } catch {
    return { ...DEFAULT_LICENSE };
  }
}

export function saveLicense(state: LicenseState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function activateLicenseKey(raw: string): { ok: true; state: LicenseState } | { ok: false; error: string } {
  const parsed = parseLicenseKey(raw);
  if (!parsed) {
    return {
      ok: false,
      error: `Invalid key. Pro keys look like MS-PRO-XXXXXX (${formatGbp(PLAN_PRICES_GBP.pro)}).`,
    };
  }
  const months = ENTITLEMENTS[parsed.tier].updateMonths;
  const state: LicenseState = {
    tier: parsed.tier,
    key: parsed.key,
    updatesUntil: months > 0 ? monthsFromNow(months) : null,
    activatedAt: new Date().toISOString(),
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
