import { describe, expect, it } from 'vitest';
import { FREE_DEVICE_IDS } from '@shared/pricing';
import {
  assertBundledDefaultsMatchFreeTier,
  BUNDLED_DEFAULT_DEVICE_IDS,
  bundledFreeDeviceIds,
  bundledLocalModelUrl,
  isBundledLocalDevice,
} from './localDeviceModels';

describe('localDeviceModels', () => {
  it('ships exactly two bundled default models', () => {
    expect(BUNDLED_DEFAULT_DEVICE_IDS).toHaveLength(2);
    expect(bundledFreeDeviceIds()).toHaveLength(2);
    expect(bundledFreeDeviceIds()).toEqual([...BUNDLED_DEFAULT_DEVICE_IDS]);
    assertBundledDefaultsMatchFreeTier();
  });

  it('bundles the free-tier starters (iPhone 15 Pro Max + Galaxy S26 Ultra)', () => {
    expect(BUNDLED_DEFAULT_DEVICE_IDS).toEqual([
      'iphone_15_pro_max',
      'galaxy_s26_ultra',
    ]);
    expect([...FREE_DEVICE_IDS]).toEqual([...BUNDLED_DEFAULT_DEVICE_IDS]);
    for (const id of BUNDLED_DEFAULT_DEVICE_IDS) {
      expect(isBundledLocalDevice(id)).toBe(true);
      const url = bundledLocalModelUrl(id);
      expect(url).toBeTruthy();
      expect(url).toMatch(/\.glb/i);
    }
  });

  it('leaves all other catalog devices on-demand (signed URL / CDN)', () => {
    const onDemandSamples = [
      'iphone_17_pro',
      'iphone_17_pro_max',
      'pixel_9',
      'pixel_10_pro',
      'macbook_pro_m3_16',
      'ipad_mini_6',
    ];
    for (const id of onDemandSamples) {
      expect(isBundledLocalDevice(id)).toBe(false);
      expect(bundledLocalModelUrl(id)).toBeNull();
    }
  });
});
