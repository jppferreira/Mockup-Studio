import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { deviceAssetUrl } from './devices';
import {
  peekDeviceModelUrl,
  remoteModelsConfigured,
  resolveDeviceModelUrl,
  warmDeviceModels,
} from './modelCache';

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
  const [state, setState] = useState<State>(() => {
    if (!remote) return { url: localUrl, loading: false, error: null };
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

    if (!remoteModelsConfigured()) {
      setState({ url: deviceAssetUrl(fallbackUrl) ?? null, loading: false, error: null });
      return;
    }

    const warm = peekDeviceModelUrl(deviceId);
    if (warm) {
      setState({ url: warm, loading: false, error: null });
      try { useGLTF.preload(warm); } catch { /* ignore */ }
      return;
    }

    let cancelled = false;
    setState((prev) => (
      prev.url && !prev.loading && !prev.error
        ? prev
        : { ...prev, loading: true, error: null }
    ));
    resolveDeviceModelUrl(deviceId)
      .then((url) => {
        if (cancelled) return;
        try { useGLTF.preload(url); } catch { /* ignore */ }
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

/** Start decrypt/download + GLTF parse for the devices in the open project. */
export function warmProjectDeviceModels(deviceIds: string[]): void {
  if (!remoteModelsConfigured()) return;
  warmDeviceModels(deviceIds);
  for (const deviceId of deviceIds) {
    void resolveDeviceModelUrl(deviceId)
      .then((url) => {
        try { useGLTF.preload(url); } catch { /* ignore */ }
      })
      .catch(() => undefined);
  }
}
