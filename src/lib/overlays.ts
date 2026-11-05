import type { MockupProject } from '../types';

export type OverlayKind = 'text' | 'image' | 'comment' | 'shape' | 'path';
export type FlatShape = 'rect' | 'ellipse' | 'triangle';

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
  /** 0 keeps type flat. Above 0 extrudes it into the 3D scene. */
  extrusion?: number;
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
    text: partial?.text ?? (kind === 'comment' ? 'Comment' : kind === 'shape' ? 'rect' : kind === 'text' ? 'Your headline' : undefined),
    color: partial?.color ?? '#ffffff',
    fontSize: partial?.fontSize ?? 0.055,
    extrusion: partial?.extrusion ?? 0,
    imageData: partial?.imageData ?? null,
  };
}

export function flatShapeOf(overlay: SceneOverlay): FlatShape {
  if (overlay.text === 'ellipse' || overlay.text === 'triangle') return overlay.text;
  return 'rect';
}

export function pathOffsets(text: string | undefined): { x: number; y: number }[] {
  if (!text) return [];
  return text.split(' ').flatMap((pair) => {
    const [xs, ys] = pair.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ x, y }];
  });
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

    if ((overlay.kind === 'text' || overlay.kind === 'comment') && overlay.text?.trim() && !(overlay.kind === 'text' && (overlay.extrusion ?? 0) > 0.001)) {
      const size = Math.max(12, shortEdge * (overlay.fontSize ?? 0.055) * overlay.scale);
      ctx.font = `600 ${size}px "SF Pro Display", "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = overlay.text.split('\n').slice(0, 4);
      const lineHeight = size * 1.15;
      if (overlay.kind === 'comment') {
        const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), size * 2);
        const boxW = Math.min(width * 0.7, widest + size * 1.4);
        const boxH = lines.length * lineHeight + size * 0.7;
        const radius = Math.min(14, size * 0.45);
        ctx.fillStyle = '#f4e7c3';
        ctx.beginPath();
        ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, radius);
        ctx.fill();
        ctx.fillStyle = overlay.color || '#2a2418';
        ctx.shadowColor = 'transparent';
      } else {
        ctx.fillStyle = overlay.color || '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = size * 0.35;
        ctx.shadowOffsetY = size * 0.06;
      }
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, cx, startY + i * lineHeight, width * 0.9);
      });
    }

    if (overlay.kind === 'shape') {
      const size = shortEdge * 0.18 * overlay.scale;
      const shape = flatShapeOf(overlay);
      ctx.fillStyle = overlay.color || '#d7dde4';
      ctx.beginPath();
      if (shape === 'ellipse') {
        ctx.ellipse(cx, cy, size / 2, size / 2, 0, 0, Math.PI * 2);
      } else if (shape === 'triangle') {
        ctx.moveTo(cx, cy - size / 2);
        ctx.lineTo(cx + size / 2, cy + size / 2);
        ctx.lineTo(cx - size / 2, cy + size / 2);
        ctx.closePath();
      } else {
        ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.12);
      }
      ctx.fill();
    }

    if (overlay.kind === 'path') {
      const offsets = pathOffsets(overlay.text);
      if (offsets.length > 1) {
        ctx.beginPath();
        offsets.forEach((point, index) => {
          const x = cx + point.x * width;
          const y = cy + point.y * height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = overlay.color || '#d7dde4';
        ctx.lineWidth = Math.max(2, shortEdge * 0.004 * overlay.scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
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
