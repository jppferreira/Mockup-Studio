/** Light video/still export metadata — safe for the dashboard chunk. */

export type VideoFormatId = 'webm' | 'mp4' | 'mov' | 'gif';
export type StillFormatId = 'png' | 'webp';
export type ExportKind = StillFormatId | VideoFormatId;
/** User-facing codec preference. `auto` picks the best available for the container. */
export type VideoCodecId = 'auto' | 'h264' | 'hevc' | 'vp9' | 'vp8' | 'av1' | 'prores';

export const VIDEO_FORMATS: {
  id: VideoFormatId;
  label: string;
  extension: string;
  mime: string;
  description: string;
  /** True when this format can keep a transparent plate. */
  supportsAlpha: boolean;
}[] = [
  { id: 'webm', label: 'WebM', extension: 'webm', mime: 'video/webm', description: 'VP9 / AV1 · keeps transparency (Chrome, Firefox, Edge)', supportsAlpha: true },
  { id: 'mp4', label: 'MP4', extension: 'mp4', mime: 'video/mp4', description: 'H.264 / HEVC / AV1 · solid backgrounds only', supportsAlpha: false },
  { id: 'mov', label: 'MOV', extension: 'mov', mime: 'video/quicktime', description: 'QuickTime · H.264 / HEVC / ProRes', supportsAlpha: false },
  { id: 'gif', label: 'GIF', extension: 'gif', mime: 'image/gif', description: 'Animated loop · keeps transparency everywhere', supportsAlpha: true },
];

export const VIDEO_CODEC_OPTIONS: {
  id: VideoCodecId;
  label: string;
  description: string;
  /** Containers that can carry this codec. */
  formats: Exclude<VideoFormatId, 'gif'>[];
}[] = [
  { id: 'auto', label: 'Auto', description: 'Best available for the file type', formats: ['mp4', 'mov', 'webm'] },
  { id: 'h264', label: 'H.264', description: 'Widest playback', formats: ['mp4', 'mov'] },
  { id: 'hevc', label: 'HEVC', description: 'Smaller files · modern devices', formats: ['mp4', 'mov'] },
  { id: 'prores', label: 'ProRes', description: 'Edit-ready quality', formats: ['mov'] },
  { id: 'vp9', label: 'VP9', description: 'WebM default · transparency', formats: ['webm'] },
  { id: 'vp8', label: 'VP8', description: 'WebM · wider support', formats: ['webm'] },
  { id: 'av1', label: 'AV1', description: 'Modern efficiency', formats: ['mp4', 'mov', 'webm'] },
];

/** Formats that preserve a transparent studio background. */
export function videoFormatsForAlpha(transparent: boolean) {
  return transparent ? VIDEO_FORMATS.filter((item) => item.supportsAlpha) : VIDEO_FORMATS;
}

/** Codecs that can be offered for the currently selected video formats. */
export function codecsForFormats(formats: VideoFormatId[]) {
  const containers = formats.filter((id): id is Exclude<VideoFormatId, 'gif'> => id !== 'gif');
  if (containers.length === 0) return [] as typeof VIDEO_CODEC_OPTIONS;
  return VIDEO_CODEC_OPTIONS.filter((codec) => (
    codec.id === 'auto' || containers.some((format) => codec.formats.includes(format))
  ));
}

export function resolveCodecForFormat(format: VideoFormatId, preferred: VideoCodecId): VideoCodecId {
  if (format === 'gif' || preferred === 'auto') return 'auto';
  const allowed = VIDEO_CODEC_OPTIONS.some((item) => (
    item.id === preferred && item.formats.includes(format as Exclude<VideoFormatId, 'gif'>)
  ));
  return allowed ? preferred : 'auto';
}

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
  return kind === 'webm' || kind === 'mp4' || kind === 'mov' || kind === 'gif';
}

export function videoSupportsSoundtrack(kind: VideoFormatId) {
  return kind === 'mp4' || kind === 'mov' || kind === 'webm';
}
