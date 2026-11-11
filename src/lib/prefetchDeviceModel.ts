/**
 * Card-tap latency helper: resolve the encrypted/CDN blob, then kick useGLTF.preload
 * so parse overlaps React commit instead of waiting for Suspense mount.
 */
import { useGLTF } from '@react-three/drei';
import { ensureGltfDecoders } from './gltfDecoders';
import { bundledLocalModelUrl } from './localDeviceModels';
import {
  peekDeviceModelUrl,
  remoteModelsConfigured,
  resolveDeviceModelUrl,
} from './modelCache';

export type PrefetchStageTimings = {
  deviceId: string;
  cacheHit: boolean;
  resolveMs: number;
  decoderMs: number;
  preloadMs: number;
  totalMs: number;
  url: string | null;
  error?: string;
};

const inflight = new Map<string, Promise<PrefetchStageTimings>>();
const lastTimings = new Map<string, PrefetchStageTimings>();

function mark(name: string) {
  try {
    performance.mark(name);
  } catch {
    /* ignore */
  }
}

function measure(name: string, start: string, end: string): number {
  try {
    performance.mark(end);
    performance.measure(name, start, end);
    const entries = performance.getEntriesByName(name);
    const last = entries[entries.length - 1];
    return last ? Math.round(last.duration) : 0;
  } catch {
    return 0;
  }
}

/** Last measured prefetch for diagnostics (`window.__mokModelPrefetch`). */
export function getPrefetchTimings(deviceId?: string): PrefetchStageTimings | PrefetchStageTimings[] | null {
  if (deviceId) return lastTimings.get(deviceId) ?? null;
  return [...lastTimings.values()];
}

/**
 * Resolve + decode-ready + useGLTF.preload for a catalog device.
 * Safe to call from hover / pointerdown / project warm — deduped per deviceId.
 */
export function prefetchDeviceModel(deviceId: string | undefined): Promise<PrefetchStageTimings> {
  if (!deviceId) {
    return Promise.resolve({
      deviceId: '',
      cacheHit: false,
      resolveMs: 0,
      decoderMs: 0,
      preloadMs: 0,
      totalMs: 0,
      url: null,
      error: 'missing deviceId',
    });
  }

  const existing = inflight.get(deviceId);
  if (existing) return existing;

  const task = (async (): Promise<PrefetchStageTimings> => {
    const t0 = performance.now();
    const bundledUrl = bundledLocalModelUrl(deviceId);
    const cacheHit = Boolean(bundledUrl) || Boolean(peekDeviceModelUrl(deviceId));
    const resolveStart = `mok-model-resolve-start:${deviceId}`;
    const resolveEnd = `mok-model-resolve-end:${deviceId}`;
    const decoderStart = `mok-model-decoder-start:${deviceId}`;
    const decoderEnd = `mok-model-decoder-end:${deviceId}`;
    const preloadStart = `mok-model-preload-start:${deviceId}`;
    const preloadEnd = `mok-model-preload-end:${deviceId}`;

    try {
      // Free starters: Vite-bundled meshopt GLB — no signed URL / IDB. Still warm
      // the decoder + kick parse so card tap does not wait on Suspense.
      if (bundledUrl) {
        mark(decoderStart);
        await ensureGltfDecoders();
        const decoderMs = measure(`mok-model-decoder:${deviceId}`, decoderStart, decoderEnd);

        mark(preloadStart);
        useGLTF.preload(bundledUrl);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        const preloadMs = measure(`mok-model-preload:${deviceId}`, preloadStart, preloadEnd);
        const totalMs = Math.round(performance.now() - t0);
        const report: PrefetchStageTimings = {
          deviceId,
          cacheHit: true,
          resolveMs: 0,
          decoderMs,
          preloadMs,
          totalMs,
          url: bundledUrl,
        };
        lastTimings.set(deviceId, report);
        publishDiagnostics(report);
        return report;
      }

      if (!remoteModelsConfigured()) {
        // Local public/models path — still warm the decoder + leave parse to canvas.
        mark(decoderStart);
        await ensureGltfDecoders();
        const decoderMs = measure(`mok-model-decoder:${deviceId}`, decoderStart, decoderEnd);
        const totalMs = Math.round(performance.now() - t0);
        const report: PrefetchStageTimings = {
          deviceId,
          cacheHit: true,
          resolveMs: 0,
          decoderMs,
          preloadMs: 0,
          totalMs,
          url: null,
        };
        lastTimings.set(deviceId, report);
        publishDiagnostics(report);
        return report;
      }

      mark(resolveStart);
      const url = await resolveDeviceModelUrl(deviceId);
      const resolveMs = measure(`mok-model-resolve:${deviceId}`, resolveStart, resolveEnd);

      mark(decoderStart);
      await ensureGltfDecoders();
      const decoderMs = measure(`mok-model-decoder:${deviceId}`, decoderStart, decoderEnd);

      mark(preloadStart);
      // Parse + texture decode on a worker-ish path inside GLTFLoader; overlaps
      // with the React state update that mounts GltfDeviceContent.
      useGLTF.preload(url);
      // useGLTF.preload is sync kickoff; wait a frame so we can approximate start cost.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const preloadMs = measure(`mok-model-preload:${deviceId}`, preloadStart, preloadEnd);
      const totalMs = Math.round(performance.now() - t0);
      const report: PrefetchStageTimings = {
        deviceId,
        cacheHit,
        resolveMs,
        decoderMs,
        preloadMs,
        totalMs,
        url,
      };
      lastTimings.set(deviceId, report);
      publishDiagnostics(report);
      return report;
    } catch (error) {
      const totalMs = Math.round(performance.now() - t0);
      const report: PrefetchStageTimings = {
        deviceId,
        cacheHit,
        resolveMs: 0,
        decoderMs: 0,
        preloadMs: 0,
        totalMs,
        url: null,
        error: error instanceof Error ? error.message : String(error),
      };
      lastTimings.set(deviceId, report);
      publishDiagnostics(report);
      return report;
    }
  })();

  inflight.set(deviceId, task);
  void task.finally(() => {
    inflight.delete(deviceId);
  });
  return task;
}

function publishDiagnostics(report: PrefetchStageTimings) {
  if (typeof window === 'undefined') return;
  const host = window as Window & { __mokModelPrefetch?: PrefetchStageTimings };
  host.__mokModelPrefetch = report;
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('perf')) {
    console.info('[model-prefetch]', report);
  }
}

/** Warm several devices (project open / visible cards) without blocking UI. */
export function prefetchDeviceModels(deviceIds: string[]): void {
  const unique = [...new Set(deviceIds.filter(Boolean))];
  for (const id of unique) {
    void prefetchDeviceModel(id);
  }
}
