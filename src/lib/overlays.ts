import type { MockupProject } from '../types';

export type OverlayKind = 'text' | 'image';

export interface SceneOverlay {
  id: string;
  kind: OverlayKind;
  /** Normalized center position (0–1) in export frame space */
  x: number;
  y: number;
  /** Relative scale (1 = default) */
  scale: number;
  opacity: number;
  /** Timeline visibility window (seconds) */
  startTime: number;
  endTime: number;
  text?: string;
  color?: string;
  /** Relative font size vs frame short edge */
  fontSize?: number;
  imageData?: string | null;
}

export function createOverlay(partial?: Partial<SceneOverlay> & { kind?: OverlayKind }): SceneOverlay {
  const kind = partial?.kind ?? 'text';
  return {
    id: partial?.id ?? `overlay-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    x: partial?.x ?? 0.5,
    y: partial?.y ?? 0.18,
    scale: partial?.scale ?? 1,
    opacity: partial?.opacity ?? 1,
    startTime: partial?.startTime ?? 0,
    endTime: partial?.endTime ?? 30,
    text: partial?.text ?? (kind === 'text' ? 'Your headline' : undefined),
    color: partial?.color ?? '#ffffff',
    fontSize: partial?.fontSize ?? 0.055,
    imageData: partial?.imageData ?? null,
  };
}

export function overlayVisibleAt(overlay: SceneOverlay, time: number) {
  return time >= overlay.startTime && time <= overlay.endTime && overlay.opacity > 0;
}

const imageCache = new Map<string, HTMLImageElement | Promise<HTMLImageElement>>();

function loadOverlayImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(dataUrl);
  if (cached instanceof HTMLImageElement) return Promise.resolve(cached);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataUrl, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Overlay image failed to load'));
    img.src = dataUrl;
  });
  imageCache.set(dataUrl, promise);
  return promise;
}

/** Draw 2D overlays on top of a captured frame. Safe to call during still + video export. */
export async function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: SceneOverlay[] | undefined,
  width: number,
  height: number,
  time: number,
) {
  if (!overlays?.length) return;
  const shortEdge = Math.min(width, height);

  for (const overlay of overlays) {
    if (!overlayVisibleAt(overlay, time)) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, overlay.opacity));
    const cx = overlay.x * width;
    const cy = overlay.y * height;

    if (overlay.kind === 'text' && overlay.text?.trim()) {
      const size = Math.max(12, shortEdge * (overlay.fontSize ?? 0.055) * overlay.scale);
      ctx.font = `600 ${size}px "SF Pro Display", "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = overlay.color || '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = size * 0.35;
      ctx.shadowOffsetY = size * 0.06;
      const lines = overlay.text.split('\n').slice(0, 4);
      const lineHeight = size * 1.15;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, cx, startY + i * lineHeight, width * 0.9);
      });
    }

    if (overlay.kind === 'image' && overlay.imageData) {
      try {
        const img = await loadOverlayImage(overlay.imageData);
        const base = shortEdge * 0.28 * overlay.scale;
        const aspect = (img.width || 1) / (img.height || 1);
        const dw = aspect >= 1 ? base : base * aspect;
        const dh = aspect >= 1 ? base / aspect : base;
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      } catch {
        /* skip broken overlay image */
      }
    }

    ctx.restore();
  }
}

export function projectOverlays(project: MockupProject): SceneOverlay[] {
  return Array.isArray(project.overlays) ? project.overlays : [];
}
