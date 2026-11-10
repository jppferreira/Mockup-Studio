import { useEffect, useState } from 'react';
import { deviceAssetUrl } from './devices';
import { remoteModelsConfigured, resolveDeviceModelUrl } from './modelCache';

type State = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolve a GLB URL for a catalog device.
 * When Supabase delivery is configured, models download on demand into an encrypted cache.
 * Local public/models paths are only used when remote delivery is not configured — those
 * GLBs are gitignored, so falling back to them after a remote failure blacks out the canvas.
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
        // Never fall back to missing public/models GLBs — Vite serves index.html for those
        // 404s, useGLTF throws, and the whole canvas goes black.
        setState({ url: null, loading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, fallbackUrl]);

  return state;
}
