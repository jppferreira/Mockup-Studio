import { Component, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CaptureApi } from './DeviceCanvas';
import { acquireThumbBaker, releaseThumbBaker } from '../lib/thumbBakerLock';

class ThumbErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Holds the single thumbnail WebGL slot, and keeps a bad model from stopping the queue. */
export function ThumbStage({ children, onError }: { children: ReactNode; onError: () => void }) {
  const [open, setOpen] = useState(false);
  const holding = useRef(false);
  const reported = useRef(false);

  useEffect(() => {
    let cancel = false;
    void acquireThumbBaker().then(() => {
      if (cancel) {
        releaseThumbBaker();
        return;
      }
      holding.current = true;
      setOpen(true);
    });
    return () => {
      cancel = true;
      if (holding.current) {
        holding.current = false;
        releaseThumbBaker();
      }
    };
  }, []);

  const fail = () => {
    if (reported.current) return;
    reported.current = true;
    onError();
  };

  if (!open) return null;
  return <ThumbErrorBoundary onError={fail}>{children}</ThumbErrorBoundary>;
}

/** Flat frames are empty studios. Reject them so the card can try again. */
async function frameHasSubject(url: string): Promise<boolean> {
  if (!url.startsWith('data:image')) return false;
  const img = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 2000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
  if (!loaded || img.naturalWidth < 8) return false;
  const canvas = document.createElement('canvas');
  const width = 48;
  const height = 28;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  // Transparent card thumbs clear to alpha 0 — only score the subject.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const y = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += y;
    sum2 += y * y;
    n += 1;
  }
  if (n < 8) return false;
  const mean = sum / n;
  const stdev = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return stdev > 6 && mean > 4;
}

/** Capture only after the device meshes exist, then always settle the job. */
export function useThumbCapture(
  captureRef: RefObject<CaptureApi | null>,
  sceneReady: boolean,
  width: number,
  height: number,
  onDone: (url: string) => void,
) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const settled = useRef(false);

  useEffect(() => {
    let cancel = false;
    let timer = 0;
    const started = performance.now();

    const settle = (url: string) => {
      if (cancel || settled.current) return;
      settled.current = true;
      onDoneRef.current(url);
    };

    const tick = () => {
      if (cancel || settled.current) return;
      const capture = captureRef.current;
      if (sceneReady && capture) {
        timer = window.setTimeout(() => {
          if (cancel || settled.current) return;
          const shot = Promise.race([
            capture.toPresentedImage()
              .catch(() => capture.toImage(width, height, 'image/webp', 0.82))
              .catch(() => capture.toSnapshot(width, height))
              .catch(() => capture.toPng(width, height)),
            new Promise<string>((_, reject) => {
              window.setTimeout(() => reject(new Error('thumb timeout')), 8000);
            }),
          ]);
          void shot.then(async (url) => {
            if (url && !(await frameHasSubject(url))) {
              settle('');
              return;
            }
            settle(url);
          }).catch(() => settle(''));
        }, 720);
        return;
      }
      if (performance.now() - started > 12000) {
        settle('');
        return;
      }
      timer = window.setTimeout(tick, 140);
    };

    timer = window.setTimeout(tick, 40);
    const hardStop = window.setTimeout(() => settle(''), 14000);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      window.clearTimeout(hardStop);
    };
  }, [captureRef, sceneReady, width, height]);
}
