/**
 * Account-bound entitlements (Supabase Auth ↔ mokstudio_entitlements).
 * Offline MS-PRO* keys remain valid locally; when signed in they bind to the account.
 * Stripe / MAS grants are written only by trusted Edge Functions.
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
import { isEntitlementActive, type EntitlementPlan, type EntitlementProvider, type EntitlementStatus } from '@shared/entitlementModel';
import { getDistributionChannel, supportsDeviceSeats } from './distribution';
import { deviceLabelForUi, getInstallDeviceId } from './deviceIdentity';
import { readValidOfflineEntitlement, saveOfflineEntitlement } from './offlineEntitlement';

export type AccountEntitlement = {
  tier: LicenseTier;
  source: 'none' | 'key' | 'stripe' | 'mas' | 'lemon' | 'paddle' | 'manual';
  provider: EntitlementProvider | null;
  plan: EntitlementPlan;
  status: EntitlementStatus;
  licensePrefix: string | null;
  updatesUntil: string | null;
  activatedAt: string | null;
  periodEnd: string | null;
  maxDevices: number;
};

export type DeviceSeat = {
  id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string;
  bound_at: string;
  last_seen_at: string;
  revoked_at: string | null;
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

async function edgePost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false, error: 'Cloud account is not configured.' };

  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in required.' };
  }

  const response = await fetch(`${url}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${snap.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    return { ok: false, error: payload.error || `Request failed (${response.status})`, status: response.status };
  }
  return { ok: true, data: payload };
}

export async function fetchAccountEntitlement(): Promise<AccountEntitlement | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const snap = await getAuthSnapshot();
  if (!snap.user) return null;

  const { data, error } = await sb
    .from('mokstudio_entitlements')
    .select(
      'tier, source, provider, plan, status, license_prefix, updates_until, activated_at, period_end, max_devices',
    )
    .eq('user_id', snap.user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      tier: 'free',
      source: 'none',
      provider: null,
      plan: 'free',
      status: 'active',
      licensePrefix: null,
      updatesUntil: null,
      activatedAt: null,
      periodEnd: null,
      maxDevices: 1,
    };
  }

  const rawTier: LicenseTier = data.tier === 'pro' || data.tier === 'pro_max' ? data.tier : 'free';
  const status = (data.status ?? 'active') as EntitlementStatus;
  const periodEnd = typeof data.period_end === 'string' ? data.period_end : null;
  const active = isEntitlementActive({ tier: rawTier, status, periodEnd });
  const tier: LicenseTier = active ? rawTier : 'free';

  const source = (
    data.source === 'key'
    || data.source === 'stripe'
    || data.source === 'mas'
    || data.source === 'lemon'
    || data.source === 'paddle'
    || data.source === 'manual'
  ) ? data.source : 'none';

  return {
    tier,
    source,
    provider: (data.provider as EntitlementProvider | null) ?? (source === 'none' ? null : source as EntitlementProvider),
    plan: (data.plan as EntitlementPlan) || 'free',
    status,
    licensePrefix: typeof data.license_prefix === 'string' ? data.license_prefix : null,
    updatesUntil: typeof data.updates_until === 'string' ? data.updates_until : null,
    activatedAt: typeof data.activated_at === 'string' ? data.activated_at : null,
    periodEnd,
    maxDevices: typeof data.max_devices === 'number' ? data.max_devices : 1,
  };
}

function accountToLicenseState(account: AccountEntitlement, local: LicenseState): LicenseState {
  if (account.tier === 'free') return local;
  const source: LicenseSource = account.source === 'mas' ? 'mas' : 'account';
  return {
    tier: account.tier,
    key: local.key && TIER_RANK[local.tier] >= TIER_RANK[account.tier] ? local.key : local.key,
    updatesUntil: account.updatesUntil ?? local.updatesUntil,
    activatedAt: account.activatedAt ?? local.activatedAt,
    source,
  };
}

/**
 * Merge account entitlement with local key / offline token state.
 * Account Pro wins when higher; local key is preserved for offline model downloads.
 */
export async function syncLicenseWithAccount(
  local: LicenseState = loadLicense(),
): Promise<LicenseState> {
  const account = await fetchAccountEntitlement();
  if (!account) {
    const offline = await readValidOfflineEntitlement();
    if (offline && TIER_RANK[offline.tier] > TIER_RANK[local.tier]) {
      const next: LicenseState = {
        tier: offline.tier,
        key: local.key,
        updatesUntil: offline.updatesUntil,
        activatedAt: local.activatedAt,
        source: 'account',
      };
      saveLicense(next);
      return next;
    }
    return local;
  }

  if (TIER_RANK[account.tier] >= TIER_RANK[local.tier] && account.tier !== 'free') {
    const merged = accountToLicenseState(account, local);
    saveLicense(merged);
    if (supportsDeviceSeats()) {
      void activateThisDevice().catch(() => undefined);
      void refreshOfflineEntitlement().catch(() => undefined);
    }
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

  const result = await edgePost<{
    tier?: string;
    updatesUntil?: string;
    activatedAt?: string;
  }>('bind-license', { licenseKey });

  if (!result.ok) {
    if (result.error === 'license_already_bound') {
      return { ok: false, error: 'This license key is already linked to another account.' };
    }
    if (result.error === 'invalid_license') {
      return { ok: false, error: 'Invalid or forged license key.' };
    }
    if (result.error === 'auth_required') {
      return { ok: false, error: 'Sign in to link this key to your account.', skipped: true };
    }
    return { ok: false, error: result.error };
  }

  const tier: LicenseTier = result.data.tier === 'pro_max' ? 'pro_max' : result.data.tier === 'pro' ? 'pro' : 'free';
  return {
    ok: true,
    tier,
    updatesUntil: result.data.updatesUntil ?? null,
    activatedAt: result.data.activatedAt ?? null,
  };
}

export async function clearAccountEntitlement(): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in required.', skipped: true };
  }
  const result = await edgePost('bind-license', { action: 'clear' });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export async function listDevices(): Promise<
  { ok: true; devices: DeviceSeat[]; maxDevices: number } | { ok: false; error: string }
> {
  const result = await edgePost<{ devices?: DeviceSeat[]; maxDevices?: number }>('bind-device', {
    action: 'list',
  });
  if (!result.ok) return result;
  return {
    ok: true,
    devices: result.data.devices ?? [],
    maxDevices: result.data.maxDevices ?? 1,
  };
}

export async function activateThisDevice(): Promise<
  { ok: true; deviceId?: string; skipped?: boolean } | { ok: false; error: string }
> {
  if (!supportsDeviceSeats()) return { ok: true, skipped: true };
  const fingerprint = await getInstallDeviceId();
  const result = await edgePost<{ deviceId?: string; skipped?: boolean }>('bind-device', {
    action: 'activate',
    deviceFingerprint: fingerprint,
    label: deviceLabelForUi(),
    platform: getDistributionChannel() === 'mac_mas' ? 'mac_mas' : 'mac_direct',
  });
  if (!result.ok) {
    if (result.error === 'device_limit_reached') {
      return { ok: false, error: 'Device limit reached. Deactivate another Mac first.' };
    }
    return { ok: false, error: result.error };
  }
  return { ok: true, deviceId: result.data.deviceId, skipped: result.data.skipped };
}

export async function deactivateDevice(deviceId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const result = await edgePost('bind-device', { action: 'deactivate', deviceId });
  if (!result.ok) return result;
  return { ok: true };
}

export async function refreshOfflineEntitlement(): Promise<
  { ok: true; expiresAt?: string } | { ok: false; error: string; skipped?: boolean }
> {
  if (!supportsDeviceSeats()) return { ok: false, error: 'Not applicable.', skipped: true };
  const fingerprint = await getInstallDeviceId();
  const result = await edgePost<{
    token?: string;
    expiresAt?: string;
    tier?: string;
    plan?: string;
    status?: string;
  }>('issue-offline-entitlement', { deviceFingerprint: fingerprint });
  if (!result.ok) {
    if (result.error === 'no_paid_entitlement' || result.error === 'entitlement_inactive') {
      saveOfflineEntitlement(null);
    }
    return { ok: false, error: result.error };
  }
  if (!result.data.token || !result.data.expiresAt) {
    return { ok: false, error: 'Invalid offline entitlement response.' };
  }
  saveOfflineEntitlement({
    token: result.data.token,
    tier: result.data.tier === 'pro_max' ? 'pro_max' : 'pro',
    plan: result.data.plan ?? 'pro',
    status: result.data.status ?? 'active',
    expiresAt: result.data.expiresAt,
    updatesUntil: null,
    periodEnd: null,
  });
  return { ok: true, expiresAt: result.data.expiresAt };
}

/** Session access token for model CDN — preferred over offline license keys. */
export async function modelAccessSessionToken(): Promise<string | null> {
  const snap = await ensureFreshSession();
  return snap.session?.access_token ?? null;
}
