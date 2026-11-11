import { describe, expect, it } from 'vitest';
import {
  defaultMaxDevicesForTier,
  isEntitlementActive,
  stripeSkuToGrant,
  tierFromPlan,
} from './entitlementModel';

describe('entitlementModel', () => {
  it('maps commercial plans to feature tiers', () => {
    expect(tierFromPlan('free')).toBe('free');
    expect(tierFromPlan('monthly')).toBe('pro');
    expect(tierFromPlan('lifetime')).toBe('pro');
    expect(tierFromPlan('pro_max')).toBe('pro_max');
  });

  it('keeps canceled access until period_end', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isEntitlementActive({ tier: 'pro', status: 'canceled', periodEnd: future })).toBe(true);
    expect(isEntitlementActive({ tier: 'pro', status: 'canceled', periodEnd: past })).toBe(false);
  });

  it('treats lifetime active rows without period_end as valid', () => {
    expect(isEntitlementActive({ tier: 'pro', status: 'active', periodEnd: null })).toBe(true);
    expect(isEntitlementActive({ tier: 'pro', status: 'revoked', periodEnd: null })).toBe(false);
  });

  it('defaults dual seats for paid direct-download tiers', () => {
    expect(defaultMaxDevicesForTier('pro')).toBe(2);
    expect(defaultMaxDevicesForTier('pro_max')).toBe(2);
    expect(defaultMaxDevicesForTier('free')).toBe(0);
  });

  it('maps stripe SKUs', () => {
    expect(stripeSkuToGrant('yearly')).toMatchObject({ plan: 'yearly', lifetime: false });
    expect(stripeSkuToGrant('lifetime')).toMatchObject({ plan: 'lifetime', lifetime: true });
    expect(stripeSkuToGrant('pro_max')).toMatchObject({ tier: 'pro_max' });
  });
});
