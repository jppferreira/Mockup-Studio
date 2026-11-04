import { getDevice, screenSizeLabel, type DeviceId, type DeviceModel, type ScreenSize } from './devices';

const placeholderCache = new Map<string, string>();

export type PlaceholderVariant = 'guide' | 'black';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function aspectRatioLabel(size: ScreenSize): string {
  const d = gcd(size.width, size.height);
  return `${size.width / d}:${size.height / d}`;
}

function paintGuidePlaceholder(
  ctx: CanvasRenderingContext2D,
  size: ScreenSize,
  opts?: { label?: string },
) {
  const w = size.width;
  const h = size.height;
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#172d28');
  bg.addColorStop(0.57, '#09201c');
  bg.addColorStop(1, '#07130f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.72, h * 0.32, 0, w * 0.72, h * 0.32, w * 0.9);
  glow.addColorStop(0, 'rgba(133,238,194,.26)');
  glow.addColorStop(1, 'rgba(133,238,194,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const pad = Math.round(w * 0.08);
  const titleSize = Math.max(36, Math.round(w * 0.055));
  const dimSize = Math.max(48, Math.round(w * 0.092));
  const bodySize = Math.max(26, Math.round(w * 0.038));

  ctx.fillStyle = '#a6c7b8';
  ctx.font = `600 ${Math.round(bodySize * 0.85)}px system-ui, sans-serif`;
  ctx.fillText('SCREENSHOT SIZE', pad, pad + bodySize);

  if (opts?.label) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
    ctx.fillText(opts.label, pad, pad + bodySize + titleSize + 18);
  }

  const dimY = opts?.label
    ? pad + bodySize + titleSize + 18 + dimSize + 28
    : pad + bodySize + dimSize + 36;

  ctx.fillStyle = '#d8fbe3';
  ctx.font = `800 ${dimSize}px system-ui, sans-serif`;
  ctx.fillText(screenSizeLabel(size), pad, dimY);

  ctx.fillStyle = '#b5d1c2';
  ctx.font = `500 ${bodySize}px system-ui, sans-serif`;
  const lines = [
    'Export or crop your UI to this size,',
    'then drop it here to replace.',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, dimY + bodySize + 28 + i * (bodySize + 12));
  });

  ctx.strokeStyle = 'rgba(200, 240, 210, 0.22)';
  ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
  const inset = Math.round(w * 0.045);
  const radius = Math.round(w * 0.08);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
  } else {
    ctx.rect(inset, inset, w - inset * 2, h - inset * 2);
  }
  ctx.stroke();
}

/** Black plate with centered pixel size + aspect — used for split-mode panes. */
function paintBlackPlaceholder(ctx: CanvasRenderingContext2D, size: ScreenSize) {
  const w = size.width;
  const h = size.height;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  const dimLabel = `${size.width}x${size.height}`;
  const ratioLabel = aspectRatioLabel(size);
  const dimSize = Math.max(42, Math.min(120, Math.round(Math.min(w, h) * 0.088)));
  const ratioSize = Math.max(28, Math.round(dimSize * 0.48));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#f2f4f6';
  ctx.font = `700 ${dimSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(dimLabel, w / 2, h / 2 - ratioSize * 0.35);

  ctx.fillStyle = '#8b929a';
  ctx.font = `600 ${ratioSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(ratioLabel, w / 2, h / 2 + dimSize * 0.55);

  // Thin inset frame so the plate reads as a screen, not empty void.
  const inset = Math.max(8, Math.round(Math.min(w, h) * 0.035));
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.003));
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
}

/** Generates a device-sized placeholder that shows the recommended upload resolution. */
export function createPlaceholderScreenshot(
  size: ScreenSize,
  opts?: { label?: string; deviceId?: string; variant?: PlaceholderVariant },
): string {
  const variant: PlaceholderVariant = opts?.variant ?? 'guide';
  const cacheKey = `${variant}-${opts?.deviceId ?? 'generic'}-${size.width}x${size.height}-${opts?.label ?? ''}`;
  const cached = placeholderCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create sample screenshot');

  if (variant === 'black') {
    paintBlackPlaceholder(ctx, size);
  } else {
    paintGuidePlaceholder(ctx, size, opts);
  }

  const url = canvas.toDataURL('image/png');
  placeholderCache.set(cacheKey, url);
  return url;
}

export function placeholderForDevice(
  device: DeviceModel | DeviceId | string | undefined,
  opts?: { variant?: PlaceholderVariant },
): string {
  const model = typeof device === 'object' && device && 'screenSize' in device
    ? device
    : getDevice(device as DeviceId | string | undefined);
  return createPlaceholderScreenshot(model.screenSize, {
    label: model.label,
    deviceId: model.id,
    variant: opts?.variant,
  });
}

/** Split-mode size plate — black with dimensions for each pane. */
export function placeholderForSplitDevice(
  device: DeviceModel | DeviceId | string | undefined,
): string {
  return placeholderForDevice(device, { variant: 'black' });
}

export function isPlaceholderScreenshot(url: string | null | undefined): boolean {
  if (!url) return true;
  for (const value of placeholderCache.values()) {
    if (value === url) return true;
  }
  return false;
}

/** @deprecated Prefer placeholderForDevice — kept for older call sites */
export function createDemoScreenshot(deviceId?: DeviceId | string): string {
  return placeholderForDevice(deviceId);
}
