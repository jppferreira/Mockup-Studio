/**
 * Run work when the browser is idle (or after `timeoutMs` so saves still land).
 * Falls back to setTimeout on browsers without requestIdleCallback.
 */
export function scheduleIdle(work: () => void, timeoutMs = 2000): () => void {
  if (typeof window === 'undefined') {
    work();
    return () => undefined;
  }
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  }).requestIdleCallback;
  const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(() => work(), { timeout: timeoutMs });
    return () => {
      if (typeof cic === 'function') cic(id);
    };
  }
  const id = window.setTimeout(work, Math.min(timeoutMs, 250));
  return () => window.clearTimeout(id);
}
