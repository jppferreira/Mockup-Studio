/**
 * Account-bound entitlements (Supabase Auth ↔ mokstudio_entitlements).
 * Offline MS-PRO* keys remain valid locally; when signed in they bind to the account.
 */

import { ensureFreshSession, getSupabase, getAuthSnapshot } from './supabaseClient';
import {
  isDeviceUnlocked,
  loadLicense,
  modelAccessLicenseKey,
  saveLicense,
  type LicenseSource,
  type LicenseState,
  type LicenseTier,
} from './license';
import { isNeedsReviewDeviceId } from '@shared/deviceLicenseGate';

export type AccountEntitlement = {
  tier: LicenseTier;
  source: 'none' | 'key' | 'stripe';
  licensePrefix: string | null;
  updatesUntil: string | null;
  activatedAt: string | null;
};

const TIER_RANK: Record<LicenseTier, number> = { free: 0, pro: 1, pro_max: 2 };

export function isWebRuntime(): boolean {
  return typeof window === 'undefined' || !window.mockupDesktop;
}

/** Browser delivery blocked for needs_review packs until counsel clears them. */
export function isDeviceBlockedOnWeb(deviceId: string): boolean {
  return isWebRuntime() && isNeedsReviewDeviceId(deviceId);
}

/** Tier unlock + web licence gate. */
export function canUseDevice(tier: LicenseTier, deviceId: string): boolean {
  if (isDeviceBlockedOnWeb(deviceId)) return false;
  return isDeviceUnlocked(tier, deviceId);
}

export async function fetchAccountEntitlement(): Promise<AccountEntitlement | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const snap = await getAuthSnapshot();
  if (!snap.user) return null;

  const { data, error } = await sb
    .from('mokstudio_entitlements')
    .select('tier, source, license_prefix, updates_until, activated_at')
    .eq('user_id', snap.user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      tier: 'free',
      source: 'none',
      licensePrefix: null,
      updatesUntil: null,
      activatedAt: null,
    };
  }

  const tier: LicenseTier = data.tier === 'pro' || data.tier === 'pro_max' ? data.tier : 'free';
  const source: AccountEntitlement['source'] =
    data.source === 'key' || data.source === 'stripe' ? data.source : 'none';

  return {
    tier,
    source,
    licensePrefix: typeof data.license_prefix === 'string' ? data.license_prefix : null,
    updatesUntil: typeof data.updates_until === 'string' ? data.updates_until : null,
    activatedAt: typeof data.activated_at === 'string' ? data.activated_at : null,
  };
}

function accountToLicenseState(account: AccountEntitlement, local: LicenseState): LicenseState {
  if (account.tier === 'free') return local;
  const source: LicenseSource = 'account';
  return {
    tier: account.tier,
    // Keep local key for offline / header fallback when present and matching tier.
    key: local.key && TIER_RANK[local.tier] >= TIER_RANK[account.tier] ? local.key : local.key,
    updatesUntil: account.updatesUntil ?? local.updatesUntil,
    activatedAt: account.activatedAt ?? local.activatedAt,
    source,
  };
}

/**
 * Merge account entitlement with local key state.
 * Account Pro wins when higher; local key is preserved for offline model downloads.
 */
export async function syncLicenseWithAccount(
  local: LicenseState = loadLicense(),
): Promise<LicenseState> {
  const account = await fetchAccountEntitlement();
  if (!account) return local;

  if (TIER_RANK[account.tier] >= TIER_RANK[local.tier] && account.tier !== 'free') {
    const merged = accountToLicenseState(account, local);
    saveLicense(merged);
    return merged;
  }

  // Local Pro key, account free → bind the key to the account.
  const key = modelAccessLicenseKey(local);
  if (key && local.tier !== 'free' && account.tier === 'free') {
    const bound = await bindLicenseKeyToAccount(key);
    if (bound.ok) {
      const next: LicenseState = {
        ...local,
        source: 'account',
        updatesUntil: bound.updatesUntil ?? local.updatesUntil,
        activatedAt: bound.activatedAt ?? local.activatedAt,
      };
      saveLicense(next);
      return next;
    }
  }

  return local;
}

export async function bindLicenseKeyToAccount(licenseKey: string): Promise<
  | { ok: true; tier: LicenseTier; updatesUntil: string | null; activatedAt: string | null }
  | { ok: false; error: string; skipped?: boolean }
> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };

  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in to link this key to your account.', skipped: true };
  }

  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  }

  const response = await fetch(`${url}/functions/v1/bind-license`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${snap.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ licenseKey }),
  });

  const payload = await response.json().catch(() => ({})) as {
    error?: string;
    tier?: string;
    updatesUntil?: string;
    activatedAt?: string;
  };

  if (!response.ok) {
    if (payload.error === 'license_already_bound') {
      return { ok: false, error: 'This license key is already linked to another account.' };
    }
    if (payload.error === 'invalid_license') {
      return { ok: false, error: 'Invalid or forged license key.' };
    }
    if (payload.error === 'auth_required') {
      return { ok: false, error: 'Sign in to link this key to your account.', skipped: true };
    }
    return { ok: false, error: payload.error || `Could not link license (${response.status})` };
  }

  const tier: LicenseTier = payload.tier === 'pro_max' ? 'pro_max' : payload.tier === 'pro' ? 'pro' : 'free';
  return {
    ok: true,
    tier,
    updatesUntil: payload.updatesUntil ?? null,
    activatedAt: payload.activatedAt ?? null,
  };
}

export async function clearAccountEntitlement(): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in required.', skipped: true };
  }
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false, error: 'Cloud account is not configured.', skipped: true };

  const response = await fetch(`${url}/functions/v1/bind-license`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${snap.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'clear' }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: payload.error || 'Could not clear account entitlement.' };
  }
  return { ok: true };
}

/** Session access token for model CDN — preferred over offline license keys. */
export async function modelAccessSessionToken(): Promise<string | null> {
  const snap = await ensureFreshSession();
  return snap.session?.access_token ?? null;
}
