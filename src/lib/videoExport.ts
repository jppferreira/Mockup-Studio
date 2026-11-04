import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from 'webm-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export type VideoFormatId = 'webm' | 'mp4' | 'gif';
export type StillFormatId = 'png' | 'webp';
export type ExportKind = StillFormatId | VideoFormatId;

export const VIDEO_FORMATS: {
  id: VideoFormatId;
  label: string;
  extension: string;
  mime: string;
  description: string;
}[] = [
  { id: 'webm', label: 'WebM', extension: 'webm', mime: 'video/webm', description: 'VP8/VP9 · wide browser support' },
  { id: 'mp4', label: 'MP4', extension: 'mp4', mime: 'video/mp4', description: 'H.264 · best for social & editing' },
  { id: 'gif', label: 'GIF', extension: 'gif', mime: 'image/gif', description: 'Animated loop · auto-scaled for size' },
];

export const STILL_FORMATS: {
  id: StillFormatId;
  label: string;
  extension: string;
  mime: string;
  description: string;
}[] = [
  { id: 'png', label: 'PNG', extension: 'png', mime: 'image/png', description: 'Lossless still image' },
  { id: 'webp', label: 'WebP', extension: 'webp', mime: 'image/webp', description: 'Smaller still · great quality' },
];

function even(n: number) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

/** Higher bpp than screen-capture defaults — mockups have smooth gradients that band badly at low rates. */
function targetBitrate(width: number, height: number, fps: number, format: 'mp4' | 'webm') {
  const pixels = width * height;
  const bitsPerPixel = format === 'webm' ? 0.2 : 0.16;
  const estimated = Math.round(pixels * Math.max(24, fps) * bitsPerPixel);
  return Math.min(40_000_000, Math.max(5_000_000, estimated));
}

function encoderQualityExtras(): Partial<VideoEncoderConfig> {
  const extras: Partial<VideoEncoderConfig> = {};
  // Prefer visual quality over realtime latency when the browser supports it.
  extras.latencyMode = 'quality';
  extras.bitrateMode = 'variable';
  return extras;
}

function waitEncoder(encoder: VideoEncoder) {
  return new Promise<void>((resolve, reject) => {
    if (encoder.state === 'closed') {
      reject(new Error('Video encoder closed unexpectedly'));
      return;
    }
    if (encoder.encodeQueueSize < 4) {
      resolve();
      return;
    }
    encoder.addEventListener('dequeue', () => resolve(), { once: true });
  });
}

function vp9CodecsForSize(width: number, height: number): string[] {
  const pixels = width * height;
  const levels = pixels > 3840 * 2160
    ? ['61', '50', '40', '30']
    : pixels > 1920 * 1080
      ? ['50', '40', '30']
      : pixels > 1280 * 720
        ? ['40', '30', '50']
        : ['30', '40', '10'];
  const codecs: string[] = [];
  for (const level of levels) {
    codecs.push(`vp09.00.${level}.08.00`, `vp09.00.${level}.08`);
  }
  return codecs;
}

type Accel = HardwareAcceleration | undefined;

type PickedCodec = {
  codec: string;
  muxCodec: 'avc' | 'vp9' | 'vp8';
  hardwareAcceleration?: HardwareAcceleration;
};

async function probeVideoEncoder(
  picked: PickedCodec,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  let gotChunk = false;
  let failed = false;
  const encoder = new VideoEncoder({
    output: () => { gotChunk = true; },
    error: () => { failed = true; },
  });
  try {
    encoder.configure({
      codec: picked.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      ...encoderQualityExtras(),
      ...(picked.muxCodec === 'avc' ? { avc: { format: 'avc' as const } } : {}),
      ...(picked.hardwareAcceleration ? { hardwareAcceleration: picked.hardwareAcceleration } : {}),
    });
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const ctx = probe.getContext('2d', { alpha: false });
    if (!ctx) return false;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    const frame = new VideoFrame(probe, {
      timestamp: 0,
      duration: Math.round(1_000_000 / Math.max(1, fps)),
    });
    try {
      encoder.encode(frame, { keyFrame: true });
    } finally {
      frame.close();
    }
    await encoder.flush();
    return gotChunk && !failed && encoder.state !== 'closed';
  } catch {
    return false;
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
}

async function listSupportedConfigs(
  container: 'mp4' | 'webm',
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<PickedCodec[]> {
  if (typeof VideoEncoder === 'undefined') return [];

  const accelModes: Accel[] = ['prefer-software', 'no-preference', 'prefer-hardware'];
  const found: PickedCodec[] = [];

  if (container === 'mp4') {
    const mp4Candidates = ['avc1.42001E', 'avc1.4D001F', 'avc1.64001F', 'avc1.640028', 'avc1.4D4028'];
    for (const codec of mp4Candidates) {
      for (const accel of accelModes) {
        const config: VideoEncoderConfig = {
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
          avc: { format: 'avc' },
          ...encoderQualityExtras(),
          ...(accel ? { hardwareAcceleration: accel } : {}),
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) found.push({ codec, muxCodec: 'avc', hardwareAcceleration: accel });
      }
    }
    return found;
  }

  // Prefer VP9 for cleaner gradients; fall back to VP8 if probe fails.
  for (const codec of vp9CodecsForSize(width, height)) {
    for (const accel of accelModes) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        ...encoderQualityExtras(),
        ...(accel ? { hardwareAcceleration: accel } : {}),
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) found.push({ codec, muxCodec: 'vp9', hardwareAcceleration: accel });
    }
  }

  for (const accel of accelModes) {
    const config: VideoEncoderConfig = {
      codec: 'vp8',
      width,
      height,
      bitrate,
      framerate: fps,
      ...encoderQualityExtras(),
      ...(accel ? { hardwareAcceleration: accel } : {}),
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) found.push({ codec: 'vp8', muxCodec: 'vp8', hardwareAcceleration: accel });
  }

  return found;
}

async function pickVideoConfig(
  container: 'mp4' | 'webm',
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<PickedCodec> {
  const candidates = await listSupportedConfigs(container, width, height, fps, bitrate);
  for (const candidate of candidates) {
    if (await probeVideoEncoder(candidate, width, height, fps, bitrate)) {
      return candidate;
    }
  }
  if (container === 'mp4') {
    throw new Error('H.264 encoding is not available on this computer. Try WebM instead.');
  }
  throw new Error('No working WebCodecs WebM encoder found.');
}

export interface EncodeVideoOptions {
  format: VideoFormatId;
  width: number;
  height: number;
  fps: number;
  duration: number;
  renderFrame: (time: number, ctx: CanvasRenderingContext2D, width: number, height: number) => Promise<void> | void;
  onProgress?: (ratio: number, label: string) => void;
}

function createEncoderBridge(muxerAdd: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void) {
  let rejectError: ((error: Error) => void) | null = null;
  const failure = new Promise<never>((_, reject) => {
    rejectError = reject;
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxerAdd(chunk, meta),
    error: (err) => {
      rejectError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });
  return { encoder, failure };
}

async function raceEncode<T>(work: Promise<T>, failure: Promise<never>): Promise<T> {
  return Promise.race([work, failure]);
}

export async function encodeAnimationVideo(options: EncodeVideoOptions): Promise<Blob> {
  const fps = Math.max(12, Math.min(60, Math.round(options.fps) || 30));
  const duration = Math.max(0.2, Math.min(30, options.duration));
  const totalFrames = Math.max(1, Math.round(duration * fps));

  if (options.format === 'gif') {
    return encodeGif({ options, fps, duration, totalFrames });
  }

  const width = even(options.width);
  const height = even(options.height);
  const bitrate = targetBitrate(width, height, fps, options.format === 'mp4' ? 'mp4' : 'webm');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false, colorSpace: 'srgb' });
  if (!ctx) throw new Error('Could not create export canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (options.format === 'mp4') {
    return encodeMp4({ options, width, height, fps, totalFrames, bitrate, canvas, ctx });
  }
  return encodeWebm({ options, width, height, fps, totalFrames, bitrate, canvas, ctx });
}

async function encodeMp4({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}) {
  const picked = await pickVideoConfig('mp4', width, height, fps, bitrate);
  const target = new Mp4ArrayBufferTarget();
  const muxer = new Mp4Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const { encoder, failure } = createEncoderBridge((chunk, meta) => muxer.addVideoChunk(chunk, meta));
  encoder.configure({
    codec: picked.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    avc: { format: 'avc' },
    ...encoderQualityExtras(),
    ...(picked.hardwareAcceleration ? { hardwareAcceleration: picked.hardwareAcceleration } : {}),
  });

  const keyEvery = Math.max(1, Math.round(fps * 2));
  try {
    await raceEncode((async () => {
      for (let i = 0; i < totalFrames; i += 1) {
        const time = Math.min(options.duration, i / fps);
        options.onProgress?.(i / totalFrames, `Encoding frame ${i + 1}/${totalFrames}`);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        await options.renderFrame(time, ctx, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1_000_000) / fps),
          duration: Math.round(1_000_000 / fps),
        });
        try {
          encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
        } finally {
          frame.close();
        }
        await waitEncoder(encoder);
      }
      await encoder.flush();
      muxer.finalize();
      options.onProgress?.(1, 'Finishing MP4');
    })(), failure);
    return new Blob([new Uint8Array(target.buffer)], { type: 'video/mp4' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MP4 export failed: ${message}`);
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
}

async function encodeWebmWithCodecs({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, picked,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  picked: PickedCodec;
}) {
  const target = new WebmArrayBufferTarget();
  const muxer = new WebmMuxer({
    target,
    video: {
      codec: picked.muxCodec === 'vp8' ? 'V_VP8' : 'V_VP9',
      width,
      height,
      frameRate: fps,
    },
    firstTimestampBehavior: 'offset',
  });

  const { encoder, failure } = createEncoderBridge((chunk, meta) => muxer.addVideoChunk(chunk, meta));
  encoder.configure({
    codec: picked.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    ...encoderQualityExtras(),
    ...(picked.hardwareAcceleration ? { hardwareAcceleration: picked.hardwareAcceleration } : {}),
  });

  const keyEvery = Math.max(1, Math.round(fps * 2));
  try {
    await raceEncode((async () => {
      for (let i = 0; i < totalFrames; i += 1) {
        const time = Math.min(options.duration, i / fps);
        options.onProgress?.(i / totalFrames, `Encoding frame ${i + 1}/${totalFrames}`);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        await options.renderFrame(time, ctx, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1_000_000) / fps),
          duration: Math.round(1_000_000 / fps),
        });
        try {
          encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
        } finally {
          frame.close();
        }
        await waitEncoder(encoder);
      }
      await encoder.flush();
      muxer.finalize();
      options.onProgress?.(1, 'Finishing WebM');
    })(), failure);
    return new Blob([new Uint8Array(target.buffer)], { type: 'video/webm' });
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
}

/** Fallback when WebCodecs VP8/VP9 is unavailable or broken. */
async function encodeWebmWithMediaRecorder({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}) {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('WebM export is not available in this browser. Try MP4 or GIF.');
  }

  const mime = [
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) {
    throw new Error('WebM recording is not supported in this browser. Try MP4 or GIF.');
  }

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const chunks: Blob[] = [];

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.max(bitrate, 8_000_000),
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('WebM MediaRecorder failed'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  recorder.start(250);
  const frameDelay = Math.max(16, Math.round(1000 / fps));

  try {
    for (let i = 0; i < totalFrames; i += 1) {
      const time = Math.min(options.duration, i / fps);
      options.onProgress?.(i / totalFrames, `Recording frame ${i + 1}/${totalFrames}`);
      await options.renderFrame(time, ctx, width, height);
      track.requestFrame?.();
      await new Promise<void>((resolve) => window.setTimeout(resolve, frameDelay));
    }
    options.onProgress?.(0.98, 'Finishing WebM');
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    return await stopped;
  } catch (error) {
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    throw error;
  }
}

async function encodeWebm({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}) {
  try {
    const picked = await pickVideoConfig('webm', width, height, fps, bitrate);
    return await encodeWebmWithCodecs({
      options, width, height, fps, totalFrames, bitrate, canvas, ctx, picked,
    });
  } catch (primaryError) {
    try {
      options.onProgress?.(0, 'Retrying WebM with MediaRecorder…');
      return await encodeWebmWithMediaRecorder({
        options, width, height, fps, totalFrames, bitrate, canvas, ctx,
      });
    } catch (fallbackError) {
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`WebM export failed: ${primary} · Fallback: ${fallback}`);
    }
  }
}

async function encodeGif({
  options, fps, duration,
}: {
  options: EncodeVideoOptions;
  fps: number;
  duration: number;
  totalFrames: number;
}) {
  const maxEdge = 720;
  const scale = Math.min(1, maxEdge / Math.max(options.width, options.height));
  const width = Math.max(2, Math.round(options.width * scale));
  const height = Math.max(2, Math.round(options.height * scale));
  const gifFps = Math.min(fps, 20);
  const gifFrames = Math.max(1, Math.round(duration * gifFps));
  const delay = Math.max(20, Math.round(1000 / gifFps));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw new Error('Could not create GIF canvas');

  const gif = GIFEncoder();
  for (let i = 0; i < gifFrames; i += 1) {
    const time = Math.min(duration, i / gifFps);
    options.onProgress?.(i / gifFrames, `GIF frame ${i + 1}/${gifFrames}`);
    await options.renderFrame(time, ctx, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
  }
  gif.finish();
  options.onProgress?.(1, 'Finishing GIF');
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

export function videoFormatById(id: VideoFormatId) {
  return VIDEO_FORMATS.find((item) => item.id === id)!;
}

export function stillFormatById(id: StillFormatId) {
  return STILL_FORMATS.find((item) => item.id === id)!;
}

export function isStillExport(kind: ExportKind): kind is StillFormatId {
  return kind === 'png' || kind === 'webp';
}

export function isVideoExport(kind: ExportKind): kind is VideoFormatId {
  return kind === 'webm' || kind === 'mp4' || kind === 'gif';
}
