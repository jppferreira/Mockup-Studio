/**
 * Devices whose pack terms do not clearly permit SaaS / browser delivery.
 * Keep in sync with DeviceModel.licenseClarity === 'needs_review' in src/lib/devices.ts
 * and docs/ip-legal-audit.md. Edge Functions duplicate this set (Deno cannot import here).
 */
export const NEEDS_REVIEW_DEVICE_IDS = [
  'pixel_fold',
  'galaxy_z_flip8',
  'galaxy_z_fold8',
  'galaxy_z_fold8_ultra',
  'apple_watch_series_12',
  'pixel_watch_7',
  'ipad_pro_m5',
  'macbook_pro_m5',
  'imac_24',
  'imac_m4',
  'apple_homeview',
] as const;

export type NeedsReviewDeviceId = (typeof NEEDS_REVIEW_DEVICE_IDS)[number];

export function isNeedsReviewDeviceId(deviceId: string): boolean {
  return (NEEDS_REVIEW_DEVICE_IDS as readonly string[]).includes(deviceId);
}
