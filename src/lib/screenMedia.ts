/** Screen content on a device — still image or video data URL. */

export type ScreenMediaKind = 'image' | 'video' | 'none';

const IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,/i;
const VIDEO_RE = /^data:video\/(mp4|webm|quicktime);base64,/i;

export function screenMediaKind(dataUrl: string | null | undefined): ScreenMediaKind {
  if (!dataUrl) return 'none';
  if (IMAGE_RE.test(dataUrl)) return 'image';
  if (VIDEO_RE.test(dataUrl)) return 'video';
  return 'none';
}

export function isValidScreenMediaDataUrl(value: unknown): value is string {
  return typeof value === 'string' && (IMAGE_RE.test(value) || VIDEO_RE.test(value));
}

export function isImageFile(file: File) {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    || /\.(png|jpe?g|webp)$/i.test(file.name);
}

export function isVideoFile(file: File) {
  return ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)
    || /\.(mp4|webm|mov)$/i.test(file.name);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

const CLIPBOARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

function isClipboardImageType(type: string) {
  return CLIPBOARD_IMAGE_TYPES.some((allowed) => type === allowed || type.startsWith(`${allowed};`));
}

async function rasterizeSvgToPngDataUrl(svgText: string): Promise<string> {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read SVG from clipboard'));
      img.src = objectUrl;
    });
    const width = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
    const height = Math.max(1, Math.round(image.naturalHeight || image.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not rasterize clipboard SVG');
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fileOrBlobToScreenDataUrl(blob: Blob, nameHint = 'clipboard.png'): Promise<{ dataUrl: string; name: string }> {
  if (blob.type.includes('svg')) {
    const svgText = await blob.text();
    return { dataUrl: await rasterizeSvgToPngDataUrl(svgText), name: nameHint.replace(/\.svg$/i, '.png') };
  }
  const file = blob instanceof File
    ? blob
    : new File([blob], nameHint, { type: blob.type || 'image/png' });
  if (!isImageFile(file) && !file.type.startsWith('image/')) {
    throw new Error('Clipboard does not contain an image');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Use an image under 20 MB.');
  }
  return { dataUrl: await readFileAsDataUrl(file), name: file.name || nameHint };
}

/** Read an image from a paste event — works with Figma “Copy as PNG” / Cmd+C. */
export async function readImageFromPasteEvent(event: ClipboardEvent): Promise<{ dataUrl: string; name: string } | null> {
  const items = event.clipboardData?.items;
  if (items) {
    for (const item of Array.from(items)) {
      if (!isClipboardImageType(item.type) && item.kind !== 'file') continue;
      if (item.kind === 'file' || item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        if (!isImageFile(file) && !file.type.startsWith('image/') && !file.type.includes('svg')) continue;
        return fileOrBlobToScreenDataUrl(file, file.name || 'figma-paste.png');
      }
    }
  }

  const files = event.clipboardData?.files;
  if (files) {
    for (const file of Array.from(files)) {
      if (!isImageFile(file) && !file.type.startsWith('image/') && !file.type.includes('svg')) continue;
      return fileOrBlobToScreenDataUrl(file, file.name || 'figma-paste.png');
    }
  }

  return null;
}

/** Async clipboard read. The Mac app reads the system pasteboard directly. */
export async function readImageFromClipboard(): Promise<{ dataUrl: string; name: string }> {
  const desktop = window.mockupDesktop?.readClipboardImage;
  if (desktop) {
    const result = await desktop();
    if (result.ok && result.dataUrl) {
      return { dataUrl: result.dataUrl, name: result.name || 'pasted.png' };
    }
  }
  if (!navigator.clipboard?.read) {
    throw new Error('Copy an image first, then paste it onto the device.');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => isClipboardImageType(candidate));
    if (!type) continue;
    const blob = await item.getType(type);
    const ext = type.includes('jpeg') || type.includes('jpg')
      ? 'jpg'
      : type.includes('webp')
        ? 'webp'
        : type.includes('svg')
          ? 'svg'
          : 'png';
    return fileOrBlobToScreenDataUrl(blob, `pasted.${ext}`);
  }
  throw new Error('No image on the clipboard. Copy an image, then paste it onto the device.');
}

export function coverDraw(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
) {
  if (!srcW || !srcH) return;
  const scale = Math.max(destW / srcW, destH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.drawImage(source, destX + (destW - dw) / 2, destY + (destH - dh) / 2, dw, dh);
}

/** Global seek hooks so video export can sync screen recordings to the timeline. */
type ScreenSeeker = (time: number) => Promise<void>;
const seekers = new Set<ScreenSeeker>();

export function registerScreenSeeker(seeker: ScreenSeeker) {
  seekers.add(seeker);
  return () => { seekers.delete(seeker); };
}

export async function seekAllScreenMedia(time: number) {
  if (!seekers.size) return;
  await Promise.all([...seekers].map((fn) => fn(time)));
}

export function waitForVideoSeek(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const target = duration > 0
    ? Math.min(Math.max(0, time), Math.max(0, duration - 0.001))
    : Math.max(0, time);

  if (Math.abs((video.currentTime || 0) - target) < 0.02 && video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('loadeddata', finish);
      resolve();
    };
    video.addEventListener('seeked', finish, { once: true });
    video.addEventListener('loadeddata', finish, { once: true });
    try {
      video.currentTime = target;
    } catch {
      finish();
      return;
    }
    window.setTimeout(finish, 280);
  });
}
