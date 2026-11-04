/** Progressive top/bottom blur — stacked bands that grow softer toward the edge. */

export type EdgeBlurLayer = {
  /** Band height as a fraction of frame height */
  frac: number;
  /** Blur multiplier relative to peak amount */
  weight: number;
};

export const EDGE_BLUR_LAYERS: EdgeBlurLayer[] = [
  { frac: 0.3, weight: 0.22 },
  { frac: 0.2, weight: 0.5 },
  { frac: 0.12, weight: 1 },
];

/** CSS mask stops for a progressive fade (opaque at edge → transparent inward). */
export function edgeBlurMask(edge: 'top' | 'bottom'): string {
  if (edge === 'top') {
    return 'linear-gradient(to bottom, #000 0%, #000 35%, transparent 100%)';
  }
  return 'linear-gradient(to top, #000 0%, #000 35%, transparent 100%)';
}

/**
 * Bake progressive top/bottom blur into a 2D canvas (in place).
 * Used for still / video export so the effect matches the live preview.
 */
export function applyProgressiveEdgeBlur(
  dest: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
): void {
  if (amount <= 0 || width < 2 || height < 2) return;

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d', { alpha: true });
  if (!sourceCtx) return;
  sourceCtx.drawImage(dest.canvas, 0, 0);

  for (const layer of EDGE_BLUR_LAYERS) {
    const blurPx = Math.max(0.5, amount * layer.weight);
    const band = Math.max(2, Math.ceil(height * layer.frac));
    const pad = Math.ceil(blurPx * 2) + 2;

    compositeBand(dest, source, width, height, band, pad, blurPx, 'top');
    compositeBand(dest, source, width, height, band, pad, blurPx, 'bottom');
  }
}

function compositeBand(
  dest: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  band: number,
  pad: number,
  blurPx: number,
  edge: 'top' | 'bottom',
) {
  const strip = document.createElement('canvas');
  strip.width = width;
  strip.height = band;
  const ctx = strip.getContext('2d', { alpha: true });
  if (!ctx) return;

  ctx.filter = `blur(${blurPx}px)`;
  if (edge === 'top') {
    ctx.drawImage(source, 0, 0, width, band + pad, 0, 0, width, band + pad);
  } else {
    ctx.drawImage(
      source,
      0, height - band - pad, width, band + pad,
      0, -pad, width, band + pad,
    );
  }
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'destination-in';
  const grad = ctx.createLinearGradient(0, 0, 0, band);
  if (edge === 'top') {
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, band);

  dest.drawImage(strip, 0, edge === 'top' ? 0 : height - band);
}
