/**
 * Lightweight DEV / ?perf=1 diagnostics for startup + live canvas.
 * Avoids production UI and expensive continuous probes unless enabled.
 */

export type PerfMarkName =
  | 'boot'
  | 'shell-ready'
  | 'session-local'
  | 'session-ready'
  | 'model-resolve-start'
  | 'model-resolve-end'
  | 'model-visible'
  | 'first-interactive';

type OrbitReport = {
  avg: number;
  min: number;
  max: number;
  p95: number;
  samples: number;
  mode: string;
  shadowMap?: number;
  drawCalls?: number;
  triangles?: number;
};

type PerfBag = {
  marks: Partial<Record<PerfMarkName, number>>;
  durations: Record<string, number>;
  orbit?: OrbitReport;
  lastFrame?: {
    fps: number;
    frameMs: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    shadowMode: string;
  };
};

const STORE_KEY = '__mokPerf';

function enabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).has('perf');
  } catch {
    return false;
  }
}

function bag(): PerfBag {
  const w = window as Window & { [STORE_KEY]?: PerfBag };
  if (!w[STORE_KEY]) {
    w[STORE_KEY] = { marks: {}, durations: {} };
  }
  return w[STORE_KEY]!;
}

/** Record a named mark (ms since navigationStart via performance.now()). */
export function perfMark(name: PerfMarkName): void {
  if (!enabled()) return;
  const now = performance.now();
  const store = bag();
  if (store.marks[name] == null) store.marks[name] = now;
  if (typeof performance !== 'undefined' && performance.mark) {
    try {
      performance.mark(`mok:${name}`);
    } catch {
      /* ignore duplicate marks */
    }
  }
}

/** Duration between two marks, stored under `label`. */
export function perfMeasure(label: string, start: PerfMarkName, end: PerfMarkName): number | null {
  if (!enabled()) return null;
  const store = bag();
  const a = store.marks[start];
  const b = store.marks[end];
  if (a == null || b == null) return null;
  const ms = Math.round((b - a) * 10) / 10;
  store.durations[label] = ms;
  return ms;
}

export function perfNote(label: string, ms: number): void {
  if (!enabled()) return;
  bag().durations[label] = Math.round(ms * 10) / 10;
}

export function recordOrbitFps(report: OrbitReport): void {
  if (!enabled()) return;
  bag().orbit = report;
  (window as Window & { __mokOrbitFps?: OrbitReport }).__mokOrbitFps = report;
}

export function recordFrameStats(stats: NonNullable<PerfBag['lastFrame']>): void {
  if (!enabled()) return;
  bag().lastFrame = stats;
}

export function getPerfBag(): PerfBag | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { [STORE_KEY]?: PerfBag })[STORE_KEY] ?? null;
}

/** Pretty-print current diagnostics to the console (DEV / ?perf=1). */
export function logPerfSummary(reason = 'summary'): void {
  if (!enabled()) return;
  const store = bag();
  // eslint-disable-next-line no-console
  console.info(`[mokstudio:perf] ${reason}`, {
    marks: store.marks,
    durations: store.durations,
    orbit: store.orbit,
    lastFrame: store.lastFrame,
  });
}
