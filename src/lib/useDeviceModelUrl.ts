import { useEffect, useState } from 'react';
import { deviceAssetUrl } from './devices';
import { isFreeDevice } from './license';
import { remoteModelsConfigured, resolveDeviceModelUrl } from './modelCache';

type State = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolve a GLB URL for a catalog device.
 * When Supabase delivery is configured, Pro downloads on demand into an encrypted cache.
 * Otherwise falls back to the local/public path (dev without remote config).
 */
export function useDeviceModelUrl(
  deviceId: string | undefined,
  fallbackUrl: string | undefined,
): State {
  const localUrl = deviceAssetUrl(fallbackUrl) ?? null;
  const remote = remoteModelsConfigured();
  const [state, setState] = useState<State>(() => ({
    url: remote ? null : localUrl,
    loading: Boolean(remote && deviceId && fallbackUrl),
    error: null,
  }));

  useEffect(() => {
    if (!deviceId || !fallbackUrl) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    if (!remoteModelsConfigured()) {
      setState({ url: deviceAssetUrl(fallbackUrl) ?? null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    resolveDeviceModelUrl(deviceId)
      .then((url) => {
        if (cancelled) return;
        setState({ url, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load device model';
        // Paid catalog models must use the Pro signed-URL path — never a leftover local GLB.
        const fallback = isFreeDevice(deviceId)
          ? (deviceAssetUrl(fallbackUrl) ?? null)
          : null;
        setState({ url: fallback, loading: false, error: fallback ? null : message });
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, fallbackUrl]);

  return state;
}
