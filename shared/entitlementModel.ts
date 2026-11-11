/**
 * Shared commercial entitlement model for web, desktop, and Edge Functions.
 * Feature gates still use LicenseTier (free | pro | pro_max); this describes billing state.
 */

export type EntitlementPlan =
  | 'free'
  | 'trial'
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'pro'
  | 'pro_max'
  | 'update_pass';

export type EntitlementStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'revoked';

export type EntitlementProvider =
  | 'key'
  | 'stripe'
  | 'mas'
  | 'lemon'
  | 'paddle'
  | 'manual';

export type DistributionChannel = 'web' | 'mac_direct' | 'mac_mas';

export type CheckoutSku = 'pro' | 'pro_max' | 'update_pass' | 'monthly' | 'yearly' | 'lifetime';

/** Maps a commercial plan/SKU onto the feature tier used by the editor. */
export function tierFromPlan(plan: EntitlementPlan): 'free' | 'pro' | 'pro_max' {
  if (plan === 'pro_max') return 'pro_max';
  if (
    plan === 'pro'
    || plan === 'trial'
    || plan === 'monthly'
    || plan === 'yearly'
    || plan === 'lifetime'
  ) {
    return 'pro';
  }
  return 'free';
}

export function defaultMaxDevicesForTier(tier: 'free' | 'pro' | 'pro_max'): number {
  if (tier === 'pro_max') return 2;
  if (tier === 'pro') return 2;
  return 0;
}

/**
 * Paid access is valid when status is active/trialing/past_due,
 * or canceled with period_end still in the future.
 * Lifetime rows keep period_end null.
 */
export function isEntitlementActive(input: {
  tier: 'free' | 'pro' | 'pro_max';
  status: EntitlementStatus;
  periodEnd?: string | null;
  now?: number;
}): boolean {
  if (input.tier === 'free') return false;
  const now = input.now ?? Date.now();
  if (input.status === 'revoked' || input.status === 'expired') return false;
  if (input.status === 'active' || input.status === 'trialing' || input.status === 'past_due') {
    if (!input.periodEnd) return true;
    const end = Date.parse(input.periodEnd);
    return Number.isFinite(end) ? end > now : true;
  }
  if (input.status === 'canceled') {
    if (!input.periodEnd) return true;
    const end = Date.parse(input.periodEnd);
    return Number.isFinite(end) ? end > now : false;
  }
  return false;
}

export function stripeSkuToGrant(sku: CheckoutSku): {
  tier: 'pro' | 'pro_max';
  plan: EntitlementPlan;
  maxDevices: number;
  lifetime: boolean;
} {
  if (sku === 'pro_max') {
    return { tier: 'pro_max', plan: 'pro_max', maxDevices: 2, lifetime: true };
  }
  if (sku === 'lifetime' || sku === 'pro') {
    return { tier: 'pro', plan: sku === 'lifetime' ? 'lifetime' : 'pro', maxDevices: 2, lifetime: true };
  }
  if (sku === 'yearly') {
    return { tier: 'pro', plan: 'yearly', maxDevices: 2, lifetime: false };
  }
  if (sku === 'monthly') {
    return { tier: 'pro', plan: 'monthly', maxDevices: 2, lifetime: false };
  }
  // update_pass does not raise tier by itself — callers extend updates_until.
  return { tier: 'pro', plan: 'update_pass', maxDevices: 2, lifetime: false };
}

/** Offline entitlement grace: 7 days. */
export const OFFLINE_ENTITLEMENT_TTL_SECONDS = 7 * 24 * 60 * 60;
