/** Soundtrack timing helpers shared by timeline preview and video export. */

export function soundtrackVolumeAt(
  localTime: number,
  clipDuration: number,
  fadeIn: number,
  fadeOut: number,
) {
  let volume = 1;
  if (fadeIn > 0) volume = Math.min(volume, Math.min(1, Math.max(0, localTime / fadeIn)));
  if (fadeOut > 0) {
    const start = Math.max(0, clipDuration - fadeOut);
    if (localTime >= start) volume = Math.min(volume, Math.max(0, (clipDuration - localTime) / fadeOut));
  }
  return Math.max(0, Math.min(1, volume));
}

export interface SoundtrackClip {
  dataUrl: string;
  start: number;
  offset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Mix soundtrack into interleaved stereo Float32 PCM for the full export duration. */
export async function renderSoundtrackPcm(
  clip: SoundtrackClip,
  exportDuration: number,
  sampleRate = 48_000,
): Promise<{ sampleRate: number; numberOfChannels: 2; frames: Float32Array } | null> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;

  const audioCtx = new Ctx();
  try {
    const buffer = await audioCtx.decodeAudioData(dataUrlToArrayBuffer(clip.dataUrl).slice(0));
    const channels = 2;
    const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate));
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    const srcRate = buffer.sampleRate || sampleRate;
    const srcLeft = buffer.getChannelData(0);
    const srcRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : srcLeft;

    for (let i = 0; i < totalFrames; i += 1) {
      const t = i / sampleRate;
      const local = t - clip.start;
      if (local < 0 || local > clip.duration) continue;
      const gain = soundtrackVolumeAt(local, clip.duration, clip.fadeIn, clip.fadeOut);
      if (gain <= 0) continue;
      const srcTime = clip.offset + local;
      const srcIndex = srcTime * srcRate;
      const i0 = Math.floor(srcIndex);
      const i1 = Math.min(srcLeft.length - 1, i0 + 1);
      if (i0 < 0 || i0 >= srcLeft.length) continue;
      const frac = srcIndex - i0;
      const l = srcLeft[i0] * (1 - frac) + srcLeft[i1] * frac;
      const r = srcRight[i0] * (1 - frac) + srcRight[i1] * frac;
      left[i] = l * gain;
      right[i] = r * gain;
    }

    const interleaved = new Float32Array(totalFrames * channels);
    for (let i = 0; i < totalFrames; i += 1) {
      interleaved[i * 2] = left[i];
      interleaved[i * 2 + 1] = right[i];
    }
    return { sampleRate, numberOfChannels: 2, frames: interleaved };
  } catch {
    return null;
  } finally {
    void audioCtx.close().catch(() => { /* ignore */ });
  }
}

export async function encodeSoundtrackAac(
  pcm: { sampleRate: number; numberOfChannels: 2; frames: Float32Array },
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;

  const bitrate = 192_000;
  const codecCandidates = ['mp4a.40.2', 'mp4a.40.02'];
  let configured: string | null = null;

  for (const codec of codecCandidates) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec,
        numberOfChannels: pcm.numberOfChannels,
        sampleRate: pcm.sampleRate,
        bitrate,
      });
      if (support.supported) {
        configured = codec;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!configured) return false;

  let failed = false;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => onChunk(chunk, meta),
    error: () => { failed = true; },
  });

  try {
    encoder.configure({
      codec: configured,
      numberOfChannels: pcm.numberOfChannels,
      sampleRate: pcm.sampleRate,
      bitrate,
    });

    const frameSize = 1024;
    const totalSamples = Math.floor(pcm.frames.length / pcm.numberOfChannels);
    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const count = Math.min(frameSize, totalSamples - offset);
      const planar = new Float32Array(count * pcm.numberOfChannels);
      // AudioData with 'f32' expects planar channels concatenated, or interleaved depending on format.
      // Use planar: L then R.
      for (let i = 0; i < count; i += 1) {
        planar[i] = pcm.frames[(offset + i) * 2];
        planar[count + i] = pcm.frames[(offset + i) * 2 + 1];
      }
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: pcm.sampleRate,
        numberOfFrames: count,
        numberOfChannels: pcm.numberOfChannels,
        timestamp: Math.round((offset / pcm.sampleRate) * 1_000_000),
        data: planar,
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
      }
    }
    await encoder.flush();
    return !failed;
  } catch {
    return false;
  } finally {
    try { encoder.close(); } catch { /* ignore */ }
  }
}
