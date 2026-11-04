import type { DeviceId } from './lib/devices';

export type BuiltinBackgroundId = 'midnight' | 'studio' | 'mint' | 'sunset' | 'transparent';
/** Built-in id, `'custom'`, or a saved custom preset id (`custom-…`). */
export type BackgroundPreset = BuiltinBackgroundId | 'custom' | (string & {});
export type DeviceColor = 'graphite' | 'titanium' | 'silver' | 'rose';
export type CameraView = 'front' | 'left' | 'right' | 'top';
/** Procedural / preset reflection environments for glass (Cinema 4D–style). */
export type ReflectionMapId =
  | 'match_background'
  | 'studio'
  | 'softbox'
  | 'city'
  | 'sunset_sky'
  | 'outdoor'
  | 'neon'
  | 'checker';
export type ReflectionMapSetting = ReflectionMapId | 'custom';
export type { DeviceId };

/** Radial gradient stops for studio backgrounds / ground colour. */
export interface GradientColors {
  center: string;
  mid: string;
  edge: string;
}

export interface ScenePreset {
  id: string;
  label: string;
  description: string;
  gradient: GradientColors | null;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DeviceInstance {
  id: string;
  deviceId: DeviceId;
  rotation: Vec3;
  scale: number;
  position: Vec3;
  /** Screen / camera glass reflection strength (0 = matte, 1 = strong) */
  glassReflection: number;
}

export type CompositionMode = 'single' | 'split';

/** Decorative 3D set pieces for scenic pre-compositions */
export type ScenePropKind =
  | 'clay_sphere'
  | 'clay_cube'
  | 'clay_cylinder'
  | 'clay_torus'
  | 'concrete_wall'
  | 'concrete_slab'
  | 'pedestal'
  | 'studio_backdrop';

export interface SceneProp {
  id: string;
  kind: ScenePropKind;
  position: Vec3;
  rotation: Vec3;
  /** Uniform or per-axis scale */
  scale: number | Vec3;
  /** Hex colour override for clay / accent pieces */
  color?: string;
}

export const SCENE_PROP_KINDS: ScenePropKind[] = [
  'clay_sphere', 'clay_cube', 'clay_cylinder', 'clay_torus',
  'concrete_wall', 'concrete_slab', 'pedestal', 'studio_backdrop',
];

export function createSceneProp(partial: Partial<SceneProp> & { kind: ScenePropKind }): SceneProp {
  return {
    id: partial.id ?? `prop-${Math.random().toString(36).slice(2, 10)}`,
    kind: partial.kind,
    position: partial.position ?? { x: 0, y: 0, z: 0 },
    rotation: partial.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial.scale ?? 1,
    color: partial.color,
  };
}

/** Spline-style animatable channels on a device instance */
export type AnimProperty =
  | 'rotation.x'
  | 'rotation.y'
  | 'rotation.z'
  | 'position.x'
  | 'position.y'
  | 'position.z'
  | 'scale';

/** Easing applied when interpolating from this keyframe to the next */
export type AnimEase = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'custom';

/** Cubic-bezier control points (CSS style): x1, y1, x2, y2. x in [0,1]. */
export type EaseBezier = [number, number, number, number];

/** Default custom curve ≈ ease-in-out */
export const DEFAULT_CUSTOM_BEZIER: EaseBezier = [0.42, 0, 0.58, 1];

export const PRESET_BEZIERS: Record<Exclude<AnimEase, 'custom'>, EaseBezier> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

export const ANIM_EASES: { id: AnimEase; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In-Out' },
  { id: 'custom', label: 'Custom' },
];

export interface AnimKeyframe {
  id: string;
  /** Time in seconds */
  time: number;
  value: number;
  /** Easing used from this key toward the next (defaults to easeInOut) */
  ease?: AnimEase;
  /** Cubic-bezier handles when ease is `custom` */
  easeBezier?: EaseBezier;
}

export interface AnimTrack {
  id: string;
  targetId: string;
  property: AnimProperty;
  keyframes: AnimKeyframe[];
}

export interface AnimationClip {
  duration: number;
  fps: number;
  loop: boolean;
  tracks: AnimTrack[];
}

export interface MockupProject {
  version: 1;
  name: string;
  screenshot: string | null;
  /** @deprecated mirrored from selected device — kept for older saves */
  deviceId: DeviceId;
  deviceColor: DeviceColor;
  background: BackgroundPreset;
  /** Active gradient colours when background is not transparent. */
  gradientColors: GradientColors;
  /** Environment / HDRI used for glass & material reflections (independent of background). */
  reflectionMap: ReflectionMapSetting;
  /** Data-URL image when reflectionMap is `custom`. */
  reflectionMapImage: string | null;
  rotation: Vec3;
  scale: number;
  /** Key / studio directional light strength */
  lightIntensity: number;
  /** Soft fill / ambient light strength */
  fillIntensity: number;
  /** Contact shadow blur — higher = softer edges */
  shadowSoftness: number;
  /** Contact shadow darkness */
  shadowOpacity: number;
  /** Soft progressive blur along the top & bottom of the frame */
  edgeBlurEnabled: boolean;
  /** Peak blur strength at the frame edges (px) */
  edgeBlurAmount: number;
  cameraView: CameraView;
  compositionMode: CompositionMode;
  devices: DeviceInstance[];
  selectedDeviceId: string;
  /** Optional scenic set pieces (clay shapes, walls, pedestals) */
  sceneProps: SceneProp[];
  animation: AnimationClip;
}

export function createDeviceInstance(partial?: Partial<DeviceInstance>): DeviceInstance {
  return {
    id: partial?.id ?? `device-${Math.random().toString(36).slice(2, 10)}`,
    deviceId: partial?.deviceId ?? 'iphone_15_pro_max',
    rotation: partial?.rotation ?? { x: -8, y: -23, z: 8 },
    scale: partial?.scale ?? 1,
    position: partial?.position ?? { x: 0, y: 0, z: 0 },
    glassReflection: partial?.glassReflection ?? 0.55,
  };
}

const primary = createDeviceInstance({ id: 'device-main' });

function kf(time: number, value: number): AnimKeyframe {
  return { id: `kf-${Math.random().toString(36).slice(2, 9)}`, time, value };
}

/** Default clip: a gentle product turntable on the main device */
export function createDefaultAnimation(targetId = 'device-main'): AnimationClip {
  return {
    duration: 4,
    fps: 30,
    loop: true,
    tracks: [
      {
        id: `track-${targetId}-rot-y`,
        targetId,
        property: 'rotation.y',
        keyframes: [kf(0, -28), kf(2, 28), kf(4, -28)],
      },
      {
        id: `track-${targetId}-rot-x`,
        targetId,
        property: 'rotation.x',
        keyframes: [kf(0, -8), kf(2, -12), kf(4, -8)],
      },
    ],
  };
}

export const BUILTIN_GRADIENTS: Record<Exclude<BuiltinBackgroundId, 'transparent'>, GradientColors> = {
  midnight: { center: '#363e49', mid: '#1d232b', edge: '#0d1016' },
  studio: { center: '#ffffff', mid: '#f7f7f5', edge: '#ecece8' },
  mint: { center: '#487e6c', mid: '#18463c', edge: '#071916' },
  sunset: { center: '#c07a9d', mid: '#5c456e', edge: '#191428' },
};

export const DEFAULT_GRADIENT: GradientColors = { ...BUILTIN_GRADIENTS.midnight };

export const DEFAULT_PROJECT: MockupProject = {
  version: 1,
  name: 'Untitled composition',
  screenshot: null,
  deviceId: primary.deviceId,
  deviceColor: 'graphite',
  background: 'midnight',
  gradientColors: { ...DEFAULT_GRADIENT },
  reflectionMap: 'match_background',
  reflectionMapImage: null,
  rotation: { ...primary.rotation },
  scale: primary.scale,
  lightIntensity: 2.5,
  fillIntensity: 0.7,
  shadowSoftness: 2.5,
  shadowOpacity: 0.32,
  edgeBlurEnabled: false,
  edgeBlurAmount: 24,
  cameraView: 'front',
  compositionMode: 'single',
  devices: [primary],
  selectedDeviceId: primary.id,
  sceneProps: [],
  animation: createDefaultAnimation(primary.id),
};

export const ANIM_PROPERTIES: { id: AnimProperty; label: string; unit: string }[] = [
  { id: 'rotation.x', label: 'Rotate X', unit: '°' },
  { id: 'rotation.y', label: 'Rotate Y', unit: '°' },
  { id: 'rotation.z', label: 'Rotate Z', unit: '°' },
  { id: 'position.x', label: 'Pos X', unit: '' },
  { id: 'position.y', label: 'Pos Y', unit: '' },
  { id: 'position.z', label: 'Pos Z', unit: '' },
  { id: 'scale', label: 'Scale', unit: '×' },
];

export const IOS_DEVICE_ID: DeviceId = 'iphone_15_pro_max';
export const ANDROID_DEVICE_ID: DeviceId = 'galaxy_s25_ultra';

export function buildSplitDevices(base: DeviceInstance): DeviceInstance[] {
  const sharedRotation = { ...base.rotation };
  const sharedScale = Math.min(base.scale, 0.92);
  return [
    createDeviceInstance({
      id: 'device-ios',
      deviceId: IOS_DEVICE_ID,
      rotation: sharedRotation,
      scale: sharedScale,
      position: { x: -1.35, y: 0, z: 0 },
      glassReflection: base.glassReflection,
    }),
    createDeviceInstance({
      id: 'device-android',
      deviceId: ANDROID_DEVICE_ID,
      rotation: { ...sharedRotation },
      scale: sharedScale,
      position: { x: 1.35, y: 0, z: 0 },
      glassReflection: base.glassReflection,
    }),
  ];
}

export function getSelectedDevice(project: MockupProject): DeviceInstance {
  return project.devices.find((d) => d.id === project.selectedDeviceId) ?? project.devices[0] ?? primary;
}

export function syncProjectFromSelected(project: MockupProject, selected: DeviceInstance): MockupProject {
  return {
    ...project,
    selectedDeviceId: selected.id,
    deviceId: selected.deviceId,
    rotation: { ...selected.rotation },
    scale: selected.scale,
  };
}

export const BACKGROUNDS: ScenePreset[] = [
  { id: 'midnight', label: 'Midnight', description: 'Dramatic dark studio', gradient: BUILTIN_GRADIENTS.midnight },
  { id: 'studio', label: 'Soft Studio', description: 'Clean white backdrop', gradient: BUILTIN_GRADIENTS.studio },
  { id: 'mint', label: 'Emerald', description: 'Rich green gradient', gradient: BUILTIN_GRADIENTS.mint },
  { id: 'sunset', label: 'Sunset', description: 'Warm purple glow', gradient: BUILTIN_GRADIENTS.sunset },
  { id: 'transparent', label: 'Transparent', description: 'No background', gradient: null },
];

export function isTransparentBackground(id: BackgroundPreset): boolean {
  return id === 'transparent';
}

export function gradientCss(colors: GradientColors): string {
  return `radial-gradient(circle at 35% 30%, ${colors.center}, ${colors.mid} 58%, ${colors.edge})`;
}

export function findBuiltinBackground(id: string): ScenePreset | undefined {
  return BACKGROUNDS.find((item) => item.id === id);
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (HEX_RE.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

export function normalizeGradientColors(input: Partial<GradientColors> | undefined, fallback: GradientColors = DEFAULT_GRADIENT): GradientColors {
  return {
    center: normalizeHex(input?.center, fallback.center),
    mid: normalizeHex(input?.mid, fallback.mid),
    edge: normalizeHex(input?.edge, fallback.edge),
  };
}

export function gradientForBackground(
  id: BackgroundPreset,
  custom: GradientColors | undefined,
  savedPresets: ScenePreset[] = [],
): GradientColors | null {
  if (id === 'transparent') return null;
  const builtin = findBuiltinBackground(id);
  if (builtin) return builtin.gradient ? { ...builtin.gradient } : null;
  const saved = savedPresets.find((item) => item.id === id);
  if (saved?.gradient) return { ...saved.gradient };
  return normalizeGradientColors(custom, DEFAULT_GRADIENT);
}

export const DEVICE_COLORS: { id: DeviceColor; label: string; hex: string }[] = [
  { id: 'graphite', label: 'Graphite', hex: '#383d42' },
  { id: 'titanium', label: 'Titanium', hex: '#9a9285' },
  { id: 'silver', label: 'Silver', hex: '#c6c9c9' },
  { id: 'rose', label: 'Rose', hex: '#be8f98' },
];

/** Aspect / framing presets. Pair with EXPORT_RESOLUTIONS for final pixel size. */
export const EXPORT_ASPECTS = [
  { id: 'portrait', label: 'Story / TikTok', hint: '9:16', ratio: 9 / 16 },
  { id: 'square', label: 'Square social', hint: '1:1', ratio: 1 },
  { id: 'landscape', label: 'Presentation / YouTube', hint: '16:9', ratio: 16 / 9 },
  { id: 'twitter', label: 'X / LinkedIn', hint: '1.91:1', ratio: 1.91 },
  { id: 'appstore', label: 'App Store', hint: 'iPhone', ratio: 1290 / 2796, fixed: { width: 1290, height: 2796 } },
  { id: 'custom', label: 'Custom', hint: 'Free', ratio: 9 / 16 },
] as const;
export type ExportAspectId = (typeof EXPORT_ASPECTS)[number]['id'];

/** Output resolution tiers (applied to the selected aspect). */
export const EXPORT_RESOLUTIONS = [
  { id: 'hd', label: 'HD', detail: '720', longEdge: 1280 },
  { id: 'fhd', label: 'Full HD', detail: '1080', longEdge: 1920 },
  { id: 'qhd', label: '2K', detail: '1440', longEdge: 2560 },
  { id: 'uhd', label: '4K', detail: '2160', longEdge: 3840 },
  { id: 'native', label: 'App native', detail: 'Fixed', longEdge: 0 },
  { id: 'custom', label: 'Custom px', detail: 'Manual', longEdge: 0 },
] as const;
export type ExportResolutionId = (typeof EXPORT_RESOLUTIONS)[number]['id'];

/** @deprecated kept for older references — use EXPORT_ASPECTS + EXPORT_RESOLUTIONS */
export const EXPORT_PRESETS = [
  { id: 'portrait', label: 'Story / TikTok', dimensions: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'square', label: 'Square social', dimensions: '1080 × 1080', width: 1080, height: 1080 },
  { id: 'landscape', label: 'Presentation', dimensions: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'appstore', label: 'App store portrait', dimensions: '1290 × 2796', width: 1290, height: 2796 },
  { id: 'custom', label: 'Custom size', dimensions: 'Custom', width: 1080, height: 1920 },
] as const;
export type ExportPresetId = (typeof EXPORT_PRESETS)[number]['id'];

export const EXPORT_SIZE_LIMITS = { min: 64, max: 4096 } as const;

function evenSize(n: number) {
  const v = Math.max(EXPORT_SIZE_LIMITS.min, Math.min(EXPORT_SIZE_LIMITS.max, Math.round(n)));
  return v % 2 === 0 ? v : v - 1;
}

/** Resolve final export width/height from aspect + resolution (+ optional custom px). */
export function resolveExportDimensions(
  aspectId: ExportAspectId,
  resolutionId: ExportResolutionId,
  custom?: { width: number; height: number },
): { width: number; height: number; label: string } {
  const aspect = EXPORT_ASPECTS.find((item) => item.id === aspectId) ?? EXPORT_ASPECTS[0];

  if (aspectId === 'custom' || resolutionId === 'custom') {
    const width = evenSize(custom?.width ?? 1080);
    const height = evenSize(custom?.height ?? 1920);
    return { width, height, label: `${width} × ${height}` };
  }

  if (aspectId === 'appstore' || resolutionId === 'native') {
    const fixed = 'fixed' in aspect && aspect.fixed
      ? aspect.fixed
      : { width: 1290, height: 2796 };
    return {
      width: fixed.width,
      height: fixed.height,
      label: `${fixed.width} × ${fixed.height}`,
    };
  }

  const resolution = EXPORT_RESOLUTIONS.find((item) => item.id === resolutionId) ?? EXPORT_RESOLUTIONS[1];
  const longEdge = resolution.longEdge || 1920;
  const ratio = aspect.ratio;

  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = longEdge;
    height = evenSize(longEdge / ratio);
  } else {
    height = longEdge;
    width = evenSize(longEdge * ratio);
  }
  width = evenSize(width);
  height = evenSize(height);
  return { width, height, label: `${width} × ${height}` };
}

export const MAX_DEVICES = 6;
