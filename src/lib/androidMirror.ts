/** Renderer helpers for Android USB mirroring (ADB screencap prototype). */

export type AndroidDeviceInfo = {
  serial: string;
  state: string;
  manufacturer: string;
  brand?: string;
  model: string;
  product?: string;
  release?: string;
  sdk?: string;
  label: string;
  preferred: boolean;
  brandRank: number;
};

export type AndroidMirrorStatus = {
  ok: boolean;
  adb: string | null;
  devices: AndroidDeviceInfo[];
  mirroringSerial: string | null;
  error?: string;
};

export type AndroidLiveFrame = {
  serial: string;
  mime: string;
  base64: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

/** Pixel & Samsung first — other brands still listed, but lower priority. */
export function sortAndroidDevicesPreferred(devices: AndroidDeviceInfo[]) {
  return [...devices].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'device' ? -1 : 1;
    if (a.brandRank !== b.brandRank) return a.brandRank - b.brandRank;
    return a.label.localeCompare(b.label);
  });
}

export function isAndroidMirrorAvailable() {
  return Boolean(window.mockupDesktop?.androidStatus);
}

export async function getAndroidMirrorStatus(): Promise<AndroidMirrorStatus> {
  if (!window.mockupDesktop?.androidStatus) {
    return {
      ok: false,
      adb: null,
      devices: [],
      mirroringSerial: null,
      error: 'Android mirror requires the Mac desktop app.',
    };
  }
  return window.mockupDesktop.androidStatus();
}

/**
 * Paints ADB JPEG frames onto a canvas and exposes a MediaStream for the
 * existing 3D liveStream path (same as iPhone Mirror).
 */
export class AndroidMirrorPlayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream;
  private image = new Image();
  private objectUrl: string | null = null;
  private lastSerial: string | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720;
    this.canvas.height = 1560;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create Android mirror canvas');
    this.ctx = ctx;
    this.ctx.fillStyle = '#0a0c10';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.stream = this.canvas.captureStream(12);
  }

  getMediaStream() {
    return this.stream;
  }

  get serial() {
    return this.lastSerial;
  }

  async pushFrame(frame: AndroidLiveFrame) {
    this.lastSerial = frame.serial;
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    const binary = atob(frame.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: frame.mime || 'image/jpeg' });
    this.objectUrl = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
      this.image.onload = () => resolve();
      this.image.onerror = () => reject(new Error('Could not decode Android mirror frame'));
      this.image.src = this.objectUrl!;
    });

    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    this.stream.getTracks().forEach((track) => track.stop());
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.lastSerial = null;
  }
}
