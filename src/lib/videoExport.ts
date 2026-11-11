import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from 'webm-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { encodeSoundtrackAac, renderSoundtrackPcm, type SoundtrackClip } from './soundtrack';
import {
  STILL_FORMATS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_FORMATS,
  codecsForFormats,
  isStillExport,
  isVideoExport,
  resolveCodecForFormat,
  stillFormatById,
  videoFormatById,
  videoFormatsForAlpha,
  videoSupportsSoundtrack,
  type ExportKind,
  type StillFormatId,
  type VideoCodecId,
  type VideoFormatId,
} from './videoExportFormats';

export {
  STILL_FORMATS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_FORMATS,
  codecsForFormats,
  isStillExport,
  isVideoExport,
  resolveCodecForFormat,
  stillFormatById,
  videoFormatById,
  videoFormatsForAlpha,
  videoSupportsSoundtrack,
};
export type { ExportKind, StillFormatId, VideoCodecId, VideoFormatId };

const CODEC_TO_MEDIABUNNY: Record<Exclude<VideoCodecId, 'auto'>, VideoCodec> = {
  h264: 'avc',
  hevc: 'hevc',
  vp9: 'vp9',
  vp8: 'vp8',
  av1: 'av1',
  prores: 'prores',
};

const DEFAULT_CODECS: Record<'mp4' | 'mov' | 'webm', VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  mov: ['avc', 'hevc', 'prores', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
};

function even(n: number) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

/** Higher bpp than screen-capture defaults — mockups have smooth gradients that band badly at low rates. */
function targetBitrate(width: number, height: number, fps: number, format: 'mp4' | 'mov' | 'webm') {
  const pixels = width * height;
  const bitsPerPixel = format === 'webm' ? 0.2 : format === 'mov' ? 0.22 : 0.16;
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
  preferred: VideoCodecId = 'auto',
): Promise<PickedCodec[]> {
  if (typeof VideoEncoder === 'undefined') return [];

  const accelModes: Accel[] = ['prefer-software', 'no-preference', 'prefer-hardware'];
  const found: PickedCodec[] = [];
  const wantAvc = preferred === 'auto' || preferred === 'h264';
  const wantVp9 = preferred === 'auto' || preferred === 'vp9';
  const wantVp8 = preferred === 'auto' || preferred === 'vp8';

  if (container === 'mp4') {
    if (!wantAvc) return found;
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
  if (wantVp9) {
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
  }

  if (wantVp8) {
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
  }

  return found;
}

async function pickVideoConfig(
  container: 'mp4' | 'webm',
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  preferred: VideoCodecId = 'auto',
): Promise<PickedCodec> {
  const candidates = await listSupportedConfigs(container, width, height, fps, bitrate, preferred);
  for (const candidate of candidates) {
    if (await probeVideoEncoder(candidate, width, height, fps, bitrate)) {
      return candidate;
    }
  }
  if (preferred !== 'auto') {
    // Fall back to any working encoder for the container when the pick is unavailable.
    const fallback = await listSupportedConfigs(container, width, height, fps, bitrate, 'auto');
    for (const candidate of fallback) {
      if (await probeVideoEncoder(candidate, width, height, fps, bitrate)) {
        return candidate;
      }
    }
  }
  if (container === 'mp4') {
    throw new Error('H.264 encoding is not available on this computer. Try WebM or MOV instead.');
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
  /** Optional soundtrack muxed into MP4 / MOV (AAC) or WebM (Opus). Skipped for GIF. */
  soundtrack?: SoundtrackClip | null;
  /** Preserve transparent pixels (WebM VP9 alpha or GIF). MP4 / MOV cannot keep alpha. */
  transparent?: boolean;
  /** Preferred video codec. Falls back to auto when unavailable on this machine. */
  codec?: VideoCodecId;
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
  const transparent = Boolean(options.transparent);
  const preferredCodec = resolveCodecForFormat(options.format, options.codec ?? 'auto');

  if (transparent && (options.format === 'mp4' || options.format === 'mov')) {
    throw new Error(`${options.format.toUpperCase()} cannot keep a transparent background. Export WebM or GIF instead.`);
  }

  if (options.format === 'gif') {
    return encodeGif({ options, fps, duration, totalFrames, transparent });
  }

  const width = even(options.width);
  const height = even(options.height);
  const container = options.format;
  const bitrate = targetBitrate(width, height, fps, container);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {
    alpha: transparent,
    willReadFrequently: transparent,
    colorSpace: 'srgb',
  });
  if (!ctx) throw new Error('Could not create export canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (transparent) {
    return encodeTransparentWebm({
      options, width, height, fps, totalFrames, bitrate, canvas, ctx, preferredCodec,
    });
  }

  // MOV always goes through Mediabunny. Advanced codecs (HEVC / AV1 / ProRes) do too.
  const needsMediabunny = container === 'mov'
    || preferredCodec === 'hevc'
    || preferredCodec === 'av1'
    || preferredCodec === 'prores';

  if (needsMediabunny) {
    return encodeViaMediabunny({
      options, width, height, fps, totalFrames, bitrate, canvas, ctx, preferredCodec, container,
    });
  }

  try {
    return await encodeViaMediabunny({
      options, width, height, fps, totalFrames, bitrate, canvas, ctx, preferredCodec, container,
    });
  } catch (primaryError) {
    if (container === 'mp4') {
      try {
        return await encodeMp4({
          options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent: false, preferredCodec,
        });
      } catch (fallbackError) {
        const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`MP4 export failed: ${primary} · Fallback: ${fallback}`);
      }
    }
    try {
      return await encodeWebm({
        options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent: false, preferredCodec,
      });
    } catch (fallbackError) {
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`WebM export failed: ${primary} · Fallback: ${fallback}`);
    }
  }
}

async function resolveEncodableCodec(
  container: 'mp4' | 'mov' | 'webm',
  preferred: VideoCodecId,
  width: number,
  height: number,
  bitrate: number,
  fps: number,
): Promise<VideoCodec> {
  const defaults = DEFAULT_CODECS[container];
  const want = preferred === 'auto' ? null : CODEC_TO_MEDIABUNNY[preferred];
  const order = want && defaults.includes(want)
    ? [want, ...defaults.filter((codec) => codec !== want)]
    : defaults;
  const picked = await getFirstEncodableVideoCodec(order, {
    width,
    height,
    bitrate,
    frameRate: fps,
  });
  if (!picked) {
    throw new Error(`No ${container.toUpperCase()} video codec available on this computer.`);
  }
  return picked;
}

function createOutputFormat(container: 'mp4' | 'mov' | 'webm') {
  if (container === 'mp4') return new Mp4OutputFormat({ fastStart: 'in-memory' });
  if (container === 'mov') return new MovOutputFormat({ fastStart: 'in-memory' });
  return new WebMOutputFormat();
}

function mimeForContainer(container: 'mp4' | 'mov' | 'webm') {
  if (container === 'mp4') return 'video/mp4';
  if (container === 'mov') return 'video/quicktime';
  return 'video/webm';
}

async function pcmToAudioBuffer(pcm: {
  sampleRate: number;
  numberOfChannels: 2;
  frames: Float32Array;
}): Promise<AudioBuffer> {
  const frames = Math.floor(pcm.frames.length / pcm.numberOfChannels);
  const buffer = new AudioBuffer({
    length: frames,
    numberOfChannels: pcm.numberOfChannels,
    sampleRate: pcm.sampleRate,
  });
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < frames; i += 1) {
    left[i] = pcm.frames[i * 2] ?? 0;
    right[i] = pcm.frames[i * 2 + 1] ?? 0;
  }
  return buffer;
}

async function encodeViaMediabunny({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, preferredCodec, container,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  preferredCodec: VideoCodecId;
  container: 'mp4' | 'mov' | 'webm';
}) {
  const codec = await resolveEncodableCodec(container, preferredCodec, width, height, bitrate, fps);
  const target = new BufferTarget();
  const output = new Output({
    format: createOutputFormat(container),
    target,
  });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: fps });

  const audioPcm = options.soundtrack?.dataUrl ? await prepareMp4Audio(options) : null;
  let audioSource: AudioBufferSource | null = null;
  if (audioPcm) {
    const audioCodec: AudioCodec = container === 'webm' ? 'opus' : 'aac';
    const audioOk = await canEncodeAudio(audioCodec, {
      numberOfChannels: audioPcm.numberOfChannels,
      sampleRate: audioPcm.sampleRate,
      bitrate: 192_000,
    });
    if (audioOk) {
      audioSource = new AudioBufferSource({
        codec: audioCodec,
        bitrate: 192_000,
      });
      output.addAudioTrack(audioSource);
    } else {
      console.warn(`[export] Soundtrack skipped — ${audioCodec.toUpperCase()} unavailable`);
    }
  }

  await output.start();
  const frameDuration = 1 / fps;
  try {
    for (let i = 0; i < totalFrames; i += 1) {
      const time = Math.min(options.duration, i / fps);
      options.onProgress?.(i / totalFrames, `Encoding frame ${i + 1}/${totalFrames}`);
      clearExportFrame(ctx, width, height, false);
      await options.renderFrame(time, ctx, width, height);
      await source.add(i * frameDuration, frameDuration);
    }

    if (audioSource && audioPcm) {
      options.onProgress?.(0.96, 'Encoding soundtrack…');
      const buffer = await pcmToAudioBuffer(audioPcm);
      await audioSource.add(buffer);
    }

    options.onProgress?.(0.98, `Finishing ${container.toUpperCase()}`);
    await output.finalize();
    if (!target.buffer) throw new Error(`${container.toUpperCase()} muxer produced an empty file`);
    options.onProgress?.(1, `Finishing ${container.toUpperCase()}`);
    return new Blob([target.buffer], { type: mimeForContainer(container) });
  } catch (error) {
    try { await output.cancel(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${container.toUpperCase()} export failed: ${message}`);
  }
}

function clearExportFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transparent: boolean,
) {
  if (transparent) {
    ctx.clearRect(0, 0, width, height);
    return;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
}

async function prepareMp4Audio(options: EncodeVideoOptions) {
  if (!options.soundtrack?.dataUrl) return null;
  options.onProgress?.(0, 'Mixing soundtrack…');
  const pcm = await renderSoundtrackPcm(options.soundtrack, options.duration, 48_000);
  if (!pcm) return null;
  return pcm;
}

async function encodeMp4({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent, preferredCodec = 'auto',
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  transparent: boolean;
  preferredCodec?: VideoCodecId;
}) {
  const picked = await pickVideoConfig('mp4', width, height, fps, bitrate, preferredCodec);
  const audioPcm = await prepareMp4Audio(options);
  const target = new Mp4ArrayBufferTarget();
  const muxer = new Mp4Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audioPcm
      ? {
        audio: {
          codec: 'aac' as const,
          numberOfChannels: audioPcm.numberOfChannels,
          sampleRate: audioPcm.sampleRate,
        },
      }
      : {}),
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
        clearExportFrame(ctx, width, height, transparent);
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

      if (audioPcm) {
        options.onProgress?.(0.96, 'Encoding soundtrack…');
        const ok = await encodeSoundtrackAac(audioPcm, (chunk, meta) => {
          muxer.addAudioChunk(chunk, meta);
        });
        if (!ok) {
          console.warn('[export] Soundtrack could not be encoded (AAC unavailable); exporting silent MP4');
        }
      }

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

/** Dual VP8/VP9 colour + alpha streams muxed as WebM AlphaMode — plays in Chrome, Firefox, Edge. */
async function encodeTransparentWebm({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, preferredCodec = 'auto',
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  preferredCodec?: VideoCodecId;
}) {
  // Mediabunny dual-encodes colour + alpha into WebM BlockAdditions (Chrome VideoEncoder drops alpha:keep).
  // AV1 alpha support is spotty — prefer VP9/VP8 for transparent plates.
  const preferredOrder: VideoCodec[] = preferredCodec === 'vp8'
    ? ['vp8', 'vp9']
    : preferredCodec === 'av1'
      ? ['av1', 'vp9', 'vp8']
      : ['vp9', 'vp8', 'av1'];
  let pickedCodec = await getFirstEncodableVideoCodec(preferredOrder, {
    width,
    height,
    bitrate,
    frameRate: fps,
  });
  if (!pickedCodec) {
    throw new Error('Transparent WebM needs VP8/VP9 encoding on this computer. Try GIF instead.');
  }
  // Prefer VP9 when available — cleaner gradients for mockups.
  if (pickedCodec === 'vp8' && preferredCodec !== 'vp8'
    && await canEncodeVideo('vp9', { width, height, bitrate, frameRate: fps })) {
    pickedCodec = 'vp9';
  }
  const codec: VideoCodec = pickedCodec;

  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate,
    keyFrameInterval: 2,
    alpha: 'keep',
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const frameDuration = 1 / fps;
  try {
    for (let i = 0; i < totalFrames; i += 1) {
      const time = Math.min(options.duration, i / fps);
      options.onProgress?.(i / totalFrames, `Encoding transparent frame ${i + 1}/${totalFrames}`);
      clearExportFrame(ctx, width, height, true);
      await options.renderFrame(time, ctx, width, height);
      await source.add(i * frameDuration, frameDuration);
    }
    options.onProgress?.(0.98, 'Finishing transparent WebM');
    await output.finalize();
    if (!target.buffer) throw new Error('Transparent WebM muxer produced an empty file');
    options.onProgress?.(1, 'Finishing WebM');
    return new Blob([target.buffer], { type: 'video/webm' });
  } catch (error) {
    try { await output.cancel(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Transparent WebM export failed: ${message}`);
  }
}

async function encodeWebmWithCodecs({
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, picked, transparent,
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
  transparent: boolean;
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
        clearExportFrame(ctx, width, height, transparent);
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
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent,
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  transparent: boolean;
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
      clearExportFrame(ctx, width, height, transparent);
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
  options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent, preferredCodec = 'auto',
}: {
  options: EncodeVideoOptions;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  transparent: boolean;
  preferredCodec?: VideoCodecId;
}) {
  try {
    const picked = await pickVideoConfig('webm', width, height, fps, bitrate, preferredCodec);
    return await encodeWebmWithCodecs({
      options, width, height, fps, totalFrames, bitrate, canvas, ctx, picked, transparent,
    });
  } catch (primaryError) {
    try {
      options.onProgress?.(0, 'Retrying WebM with MediaRecorder…');
      return await encodeWebmWithMediaRecorder({
        options, width, height, fps, totalFrames, bitrate, canvas, ctx, transparent,
      });
    } catch (fallbackError) {
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`WebM export failed: ${primary} · Fallback: ${fallback}`);
    }
  }
}

function gifTransparentIndex(palette: number[][]): number {
  let best = 0;
  let bestAlpha = 255;
  for (let i = 0; i < palette.length; i += 1) {
    const alpha = palette[i]?.[3] ?? 255;
    if (alpha < bestAlpha) {
      bestAlpha = alpha;
      best = i;
      if (alpha === 0) break;
    }
  }
  return bestAlpha < 128 ? best : -1;
}

async function encodeGif({
  options, fps, duration, transparent,
}: {
  options: EncodeVideoOptions;
  fps: number;
  duration: number;
  totalFrames: number;
  transparent: boolean;
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: transparent });
  if (!ctx) throw new Error('Could not create GIF canvas');

  const gif = GIFEncoder();
  const format = transparent ? 'rgba4444' : 'rgb565';
  for (let i = 0; i < gifFrames; i += 1) {
    const time = Math.min(duration, i / gifFps);
    options.onProgress?.(i / gifFrames, `GIF frame ${i + 1}/${gifFrames}`);
    clearExportFrame(ctx, width, height, transparent);
    await options.renderFrame(time, ctx, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const palette = quantize(imageData.data, transparent ? 255 : 256, { format });
    const index = applyPalette(imageData.data, palette, format);
    const transparentIndex = transparent ? gifTransparentIndex(palette) : -1;
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      repeat: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      dispose: transparentIndex >= 0 ? 2 : undefined,
    });
  }
  gif.finish();
  options.onProgress?.(1, 'Finishing GIF');
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

