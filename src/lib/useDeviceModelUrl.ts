import { useEffect, useState } from 'react';
import { deviceAssetUrl } from './devices';
import { bundledLocalModelUrl, isBundledLocalDevice } from './localDeviceModels';
import {
  peekDeviceModelUrl,
  remoteModelsConfigured,
  resolveDeviceModelUrl,
  warmDeviceModels,
} from './modelCache';
import { prefetchDeviceModel } from './prefetchDeviceModel';

type State = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolve a loadable GLB URL for a catalog device.
 *
 * Hybrid delivery:
 * - Free starters (`FREE_DEVICE_IDS`) → bundled Vite asset URLs (instant, no network).
 * - Paid catalog → Supabase signed URL → encrypted IDB cache → blob URL.
 * - When remote delivery is not configured, fall back to `public/models` paths.
 *
 * Deliberately does not call useGLTF.preload here — parsing stays with the canvas
 * Suspense tree that mounts the mesh.
 */
export function useDeviceModelUrl(
  deviceId: string | undefined,
  fallbackUrl: string | undefined,
): State {
  const bundledUrl = bundledLocalModelUrl(deviceId);
  const localFallback = deviceAssetUrl(fallbackUrl) ?? null;
  const remote = remoteModelsConfigured();

  const [state, setState] = useState<State>(() => {
    // Local free starters resolve synchronously — no loading flash on card tap.
    if (bundledUrl) return { url: bundledUrl, loading: false, error: null };
    if (!remote) return { url: localFallback, loading: false, error: null };
    const warm = peekDeviceModelUrl(deviceId);
    if (warm) return { url: warm, loading: false, error: null };
    return {
      url: null,
      loading: Boolean(deviceId && fallbackUrl),
      error: null,
    };
  });

  useEffect(() => {
    if (!deviceId || !fallbackUrl) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    // Path A — bundled free starter (instant).
    const local = bundledLocalModelUrl(deviceId);
    if (local) {
      setState({ url: local, loading: false, error: null });
      return;
    }

    // Path B — no Supabase config: relative public/models URL.
    if (!remoteModelsConfigured()) {
      setState({ url: deviceAssetUrl(fallbackUrl) ?? null, loading: false, error: null });
      return;
    }

    // Path C — paid / catalog CDN (signed URL + cache).
    const warm = peekDeviceModelUrl(deviceId);
    if (warm) {
      setState({ url: warm, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true, error: null });
    resolveDeviceModelUrl(deviceId)
      .then((url) => {
        if (cancelled) return;
        setState({ url, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load device model';
        console.error('[device-model]', deviceId, message);
        setState({ url: null, loading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, fallbackUrl]);

  return state;
}

/**
 * Warm project devices before Suspense asks:
 * - Free starters → meshopt decoder + useGLTF.preload on the bundled URL
 * - Paid ids → decrypt/download into the encrypted blob cache (+ preload via prefetch)
 */
export function warmProjectDeviceModels(deviceIds: string[]): void {
  const unique = [...new Set(deviceIds.filter(Boolean))];
  if (!unique.length) return;

  const remoteIds = unique.filter((id) => !isBundledLocalDevice(id));
  if (remoteIds.length && remoteModelsConfigured()) {
    warmDeviceModels(remoteIds);
  }

  for (const deviceId of unique) {
    void prefetchDeviceModel(deviceId);
  }
}
