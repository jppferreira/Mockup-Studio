import { BUILTIN_GRADIENTS, type BackgroundPreset, type GradientColors, type ReflectionMapId } from '../types';

export type { ReflectionMapId };

export interface ReflectionMapDef {
  id: ReflectionMapId;
  label: string;
  description: string;
}

export const REFLECTION_MAPS: ReflectionMapDef[] = [
  { id: 'match_background', label: 'Match BG', description: 'Same colours as the scene background' },
  { id: 'studio', label: 'Studio', description: 'Soft white cyclorama' },
  { id: 'softbox', label: 'Softbox', description: 'Photo softbox highlights' },
  { id: 'city', label: 'City', description: 'Window lights and skyline' },
  { id: 'sunset_sky', label: 'Sunset', description: 'Warm horizon glow' },
  { id: 'outdoor', label: 'Outdoor', description: 'Blue sky and ground' },
  { id: 'neon', label: 'Neon', description: 'Colourful rim lights' },
  { id: 'checker', label: 'Chrome', description: 'High-contrast checker (C4D style)' },
];

type Lobe = [number, number, number, string];

function fillSky(ctx: CanvasRenderingContext2D, w: number, h: number, stops: string[]) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, stops[0]);
  sky.addColorStop(0.45, stops[1]);
  sky.addColorStop(1, stops[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
}

function paintLobes(ctx: CanvasRenderingContext2D, w: number, h: number, lobes: Lobe[]) {
  for (const [ux, uy, radius, color] of lobes) {
    const x = ux * w;
    const y = uy * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

type RGB = [number, number, number];

/** Default camera looks down −Z, which samples equirectangular u = 0.25. */
const STUDIO_FRONT_U = 0.25;

function hexToRgb(hex: string): RGB {
  const raw = hex.replace('#', '');
  const n = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return [
    Number.parseInt(n.slice(0, 2), 16) || 0,
    Number.parseInt(n.slice(2, 4), 16) || 0,
    Number.parseInt(n.slice(4, 6), 16) || 0,
  ];
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgbCss(c: RGB, alpha = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  if (alpha >= 1) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Soft equirectangular studio for reflections.
 * Broad falloff and large diffused lights, so glass reads as silk rather than a hard box.
 */
export function createStudioEquirect(
  colors: GradientColors,
  options?: { width?: number; lights?: boolean },
): HTMLCanvasElement {
  const w = options?.width ?? 2048;
  const h = Math.max(64, Math.round(w / 2));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render studio environment');

  const wall = hexToRgb(colors.center);
  const cove = hexToRgb(colors.mid);
  const floor = hexToRgb(colors.edge);
  const ceiling = mixRgb(cove, floor, 0.22);
  const zenith = mixRgb(ceiling, [0, 0, 0], 0.28);
  const nadir = mixRgb(floor, [0, 0, 0], 0.4);
  const lit = mixRgb(wall, [255, 255, 255], 0.28);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, rgbCss(zenith));
  sky.addColorStop(0.28, rgbCss(ceiling));
  sky.addColorStop(0.42, rgbCss(mixRgb(cove, wall, 0.55)));
  sky.addColorStop(0.5, rgbCss(wall));
  sky.addColorStop(0.62, rgbCss(mixRgb(wall, floor, 0.4)));
  sky.addColorStop(0.78, rgbCss(floor));
  sky.addColorStop(1, rgbCss(nadir));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const keyX = STUDIO_FRONT_U * w;
  const key = ctx.createRadialGradient(keyX, h * 0.46, 0, keyX, h * 0.46, w * 0.28);
  key.addColorStop(0, rgbCss(lit, 0.45));
  key.addColorStop(0.55, rgbCss(wall, 0.12));
  key.addColorStop(1, rgbCss(wall, 0));
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);

  if (options?.lights !== false) {
    const boxes: Array<[number, number, number, RGB, number]> = [
      [STUDIO_FRONT_U - 0.1, 0.22, 0.16, mixRgb(wall, [255, 252, 248], 0.72), 0.55],
      [STUDIO_FRONT_U + 0.12, 0.2, 0.15, mixRgb(wall, [232, 240, 255], 0.65), 0.42],
      [STUDIO_FRONT_U, 0.12, 0.1, [255, 255, 255], 0.28],
    ];
    for (const [u, yNorm, radius, color, alpha] of boxes) {
      const x = u * w;
      const y = yNorm * h;
      const r = radius * w;
      const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      glow.addColorStop(0, rgbCss(color, alpha));
      glow.addColorStop(0.5, rgbCss(color, alpha * 0.28));
      glow.addColorStop(1, rgbCss(color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
  }

  return canvas;
}

/** Procedural equirectangular reflection map (canvas). */
export function createReflectionEquirect(
  mapId: ReflectionMapId | 'custom',
  options?: {
    background?: BackgroundPreset;
    colors?: GradientColors | null;
    customImage?: HTMLImageElement | HTMLCanvasElement | null;
    /** Lower for UI chrome-ball thumbs (default 1024×512 for scene env). */
    width?: number;
  },
): HTMLCanvasElement {
  const w = options?.width ?? 1024;
  const h = Math.max(64, Math.round(w / 2));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create reflection map');

  if (mapId === 'custom' && options?.customImage) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    const img = options.customImage;
    const iw = 'naturalWidth' in img ? img.naturalWidth || img.width : img.width;
    const ih = 'naturalHeight' in img ? img.naturalHeight || img.height : img.height;
    const scale = Math.max(w / Math.max(1, iw), h / Math.max(1, ih));
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return canvas;
  }

  const id = mapId === 'custom' ? 'studio' : mapId;

  if (id === 'match_background') {
    const presetKey = options?.background && options.background in BUILTIN_GRADIENTS
      ? options.background as keyof typeof BUILTIN_GRADIENTS
      : 'midnight';
    const colors = options?.colors ?? BUILTIN_GRADIENTS[presetKey];
    return createStudioEquirect(colors, { width: w, lights: true });
  }

  if (id === 'studio') {
    return createStudioEquirect(BUILTIN_GRADIENTS.studio, { width: w, lights: true });
  }

  if (id === 'softbox') {
    fillSky(ctx, w, h, ['#2a2a2c', '#141416', '#080809']);
    // Rectangular softbox panels
    const boxes: Array<[number, number, number, number, string]> = [
      [0.08, 0.12, 0.28, 0.42, '#ffffff'],
      [0.64, 0.12, 0.28, 0.42, '#f2f4ff'],
      [0.36, 0.02, 0.28, 0.18, '#fff8f0'],
      [0.2, 0.7, 0.6, 0.12, '#d0d4dc'],
    ];
    for (const [ux, uy, uw, uh, color] of boxes) {
      ctx.fillStyle = color;
      ctx.fillRect(ux * w, uy * h, uw * w, uh * h);
    }
    return canvas;
  }

  if (id === 'city') {
    fillSky(ctx, w, h, ['#1a2740', '#0d1524', '#06080e']);
    // Window grid (deterministic so previews stay stable)
    const cellW = w / 12;
    const cellH = h / 10;
    for (let i = 0; i < 48; i += 1) {
      const x = (i % 12) * cellW + cellW * 0.15;
      const y = h * 0.35 + Math.floor(i / 12) * cellH;
      const lit = ((i * 17) % 10) > 3;
      ctx.fillStyle = lit ? `rgba(255,${200 + (i % 40)},150,0.85)` : 'rgba(40,50,70,0.5)';
      ctx.fillRect(x, y, cellW * 0.55, cellH * 0.65);
    }
    paintLobes(ctx, w, h, [
      [0.3, 0.15, w * 0.1, 'rgba(180,210,255,0.5)'],
      [0.75, 0.2, w * 0.09, 'rgba(255,200,120,0.35)'],
    ]);
    return canvas;
  }

  if (id === 'sunset_sky') {
    fillSky(ctx, w, h, ['#ffb36a', '#c45d7a', '#1a1030']);
    paintLobes(ctx, w, h, [
      [0.5, 0.42, 200, 'rgba(255,220,140,0.95)'],
      [0.2, 0.25, 120, 'rgba(255,160,100,0.5)'],
      [0.8, 0.3, 100, 'rgba(255,120,160,0.4)'],
    ]);
    return canvas;
  }

  if (id === 'outdoor') {
    fillSky(ctx, w, h, ['#9ec9ff', '#4a7ab8', '#2d5a3a']);
    // Ground band
    ctx.fillStyle = '#3d6b3a';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#2a4a28';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    paintLobes(ctx, w, h, [
      [0.55, 0.2, 160, 'rgba(255,255,255,0.9)'],
      [0.15, 0.35, 80, 'rgba(200,230,255,0.45)'],
    ]);
    return canvas;
  }

  if (id === 'neon') {
    fillSky(ctx, w, h, ['#12081c', '#0a0612', '#040308']);
    paintLobes(ctx, w, h, [
      [0.2, 0.3, 140, 'rgba(0,255,200,0.85)'],
      [0.75, 0.28, 150, 'rgba(255,40,160,0.8)'],
      [0.5, 0.55, 120, 'rgba(80,120,255,0.7)'],
      [0.4, 0.15, 90, 'rgba(255,220,80,0.55)'],
      [0.85, 0.6, 100, 'rgba(180,80,255,0.5)'],
    ]);
    return canvas;
  }

  // checker — classic chrome-ball diagnostic (Cinema 4D style)
  const cell = 64;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const odd = ((x / cell) + (y / cell)) % 2 === 0;
      ctx.fillStyle = odd ? '#f4f4f4' : '#1a1a1a';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  // Colour bands so tinted reflections are obvious
  ctx.globalAlpha = 0.55;
  const bands = ['#ff5a5a', '#5aff8a', '#5aa0ff', '#ffd15a'];
  bands.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect((i / bands.length) * w, 0, w / bands.length, h * 0.28);
  });
  ctx.globalAlpha = 1;
  paintLobes(ctx, w, h, [
    [0.5, 0.2, 100, 'rgba(255,255,255,0.85)'],
  ]);
  return canvas;
}

/**
 * Rasterize a chrome-ball preview (Cinema 4D style) from an equirect canvas.
 * Uses reflection of view vector (0,0,1) around the sphere normal.
 */
export function renderChromeSpherePreview(
  equirect: HTMLCanvasElement,
  size = 96,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  const src = equirect.getContext('2d');
  if (!ctx || !src) return out;

  const srcData = src.getImageData(0, 0, equirect.width, equirect.height);
  const sw = equirect.width;
  const sh = equirect.height;
  const img = ctx.createImageData(size, size);
  const r = size / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const nx = (px + 0.5 - r) / r;
      const ny = (py + 0.5 - r) / r;
      const nz2 = 1 - nx * nx - ny * ny;
      const di = (py * size + px) * 4;
      if (nz2 < 0) {
        img.data[di + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(nz2);
      // Reflect V=(0,0,1) around N
      const ndotv = nz;
      const rx = 2 * ndotv * nx;
      const ry = 2 * ndotv * ny;
      const rz = 2 * ndotv * nz - 1;
      const len = Math.hypot(rx, ry, rz) || 1;
      const rdx = rx / len;
      const rdy = ry / len;
      const rdz = rz / len;
      const u = 0.5 + Math.atan2(rdx, rdz) / (Math.PI * 2);
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, rdy))) / Math.PI;
      const sx = Math.min(sw - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * sw)));
      const sy = Math.min(sh - 1, Math.max(0, Math.floor(Math.min(1, Math.max(0, v)) * sh)));
      const si = (sy * sw + sx) * 4;
      // Soft rim shade
      const rim = 0.75 + 0.25 * nz;
      img.data[di] = srcData.data[si] * rim;
      img.data[di + 1] = srcData.data[si + 1] * rim;
      img.data[di + 2] = srcData.data[si + 2] * rim;
      img.data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function reflectionMapPreviewDataUrl(
  mapId: ReflectionMapId | 'custom',
  options?: {
    background?: BackgroundPreset;
    colors?: GradientColors | null;
    customImage?: HTMLImageElement | HTMLCanvasElement | null;
  },
  size = 64,
): string {
  const equirect = createReflectionEquirect(mapId, { ...options, width: 256 });
  return renderChromeSpherePreview(equirect, size).toDataURL('image/png');
}
