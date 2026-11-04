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
