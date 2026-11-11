/**
 * Exactly two free starter devices ship inside the app bundle (Vite asset URLs).
 * GLBs are meshopt + WebP compressed (`scripts/recompress-device-models.mjs`).
 * Every other catalog device downloads on demand via Supabase signed URL + CDN
 * (`modelCache.resolveDeviceModelUrl`).
 */
import { FREE_DEVICE_IDS } from '@shared/pricing';
import iphone15ProMaxUrl from '../assets/device-models/iphone_15_pro_max.glb?url';
import galaxyS26UltraUrl from '../assets/device-models/galaxy_s26_ultra.glb?url';

/** Must stay length-2 and match FREE_DEVICE_IDS (iPhone + Galaxy free starters). */
export const BUNDLED_DEFAULT_DEVICE_IDS = [
  'iphone_15_pro_max',
  'galaxy_s26_ultra',
] as const;

const BUNDLED_FREE_MODEL_URLS: Record<(typeof BUNDLED_DEFAULT_DEVICE_IDS)[number], string> = {
  iphone_15_pro_max: iphone15ProMaxUrl,
  galaxy_s26_ultra: galaxyS26UltraUrl,
};

/** True when this catalog id has a GLB compiled into the app (zero network). */
export function isBundledLocalDevice(deviceId: string | undefined): boolean {
  if (!deviceId) return false;
  return Object.prototype.hasOwnProperty.call(BUNDLED_FREE_MODEL_URLS, deviceId);
}

/** Vite-emitted URL for a bundled default GLB, or null for on-demand CDN devices. */
export function bundledLocalModelUrl(deviceId: string | undefined): string | null {
  if (!deviceId) return null;
  return (BUNDLED_FREE_MODEL_URLS as Record<string, string>)[deviceId] ?? null;
}

/** The two default device ids that ship in the app bundle. */
export function bundledFreeDeviceIds(): readonly string[] {
  return BUNDLED_DEFAULT_DEVICE_IDS;
}

/** Dev/test guard: bundled defaults must stay aligned with free-tier pricing. */
export function assertBundledDefaultsMatchFreeTier(): void {
  const free = [...FREE_DEVICE_IDS].sort();
  const bundled = [...BUNDLED_DEFAULT_DEVICE_IDS].sort();
  if (bundled.length !== 2) {
    throw new Error(`Expected exactly 2 bundled default models, got ${bundled.length}`);
  }
  if (free.join('|') !== bundled.join('|')) {
    throw new Error(
      `Bundled defaults (${bundled.join(', ')}) must match FREE_DEVICE_IDS (${free.join(', ')})`,
    );
  }
}
