import { getDevice, type DeviceId } from './lib/devices';
import {
  normalizeReflectionStyle,
  reflectionStyleForAmount,
  type ReflectionStyle,
} from './lib/reflectionStyle';
import type { SceneOverlay } from './lib/overlays';
import {
  TONE_CLAY, TONE_GRAPHITE, TONE_ROSE, TONE_SILVER, TONE_TITANIUM,
} from './lib/referenceTones';

export type BuiltinBackgroundId = 'midnight' | 'studio' | 'mint' | 'sunset' | 'transparent';
/** Stack entry kind within one composition (not per-scene). */
export type LayerKind = 'device' | 'prop' | 'overlay';

/** Ordered stack for one composition. Index 0 = back, last = front. */
export interface CompositionLayer {
  id: string;
  kind: LayerKind;
  /** Points at devices[].id / sceneProps[].id / overlays[].id */
  refId: string;
  visible: boolean;
}

export const MAX_COMPOSITION_LAYERS = 48;

export function layerId(kind: LayerKind, refId: string) {
  return `layer-${kind}-${refId}`;
}

export function createCompositionLayer(
  kind: LayerKind,
  refId: string,
  partial?: Partial<Pick<CompositionLayer, 'visible' | 'id'>>,
): CompositionLayer {
  return {
    id: partial?.id ?? layerId(kind, refId),
    kind,
    refId,
    visible: partial?.visible !== false,
  };
}
/** Built-in id, `'custom'`, or a saved custom preset id (`custom-…`). */
export type BackgroundPreset = BuiltinBackgroundId | 'custom' | (string & {});
export type DeviceColor = 'graphite' | 'titanium' | 'silver' | 'rose' | 'clay';
export type CameraView = 'front' | 'left' | 'right' | 'top';
/** Perspective lens presets — changes scene FOV (not the phone’s rear cameras). */
export type CameraLens = 'ultrawide' | 'wide' | 'standard' | 'telephoto';
/**
 * Floor shadow enabled state. Legacy `contact` / `sharp` still load; the UI
 * treats anything other than `off` as on and stores `soft`.
 */
export type ShadowType = 'contact' | 'soft' | 'sharp' | 'off';
/** Floor-shadow sampling quality. Export temporarily forces Ultra. */
export type ShadowQuality = 'auto' | 'high' | 'ultra';
export type { SceneOverlay };

export const SHADOW_QUALITIES: { id: ShadowQuality; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Balanced for smooth interaction' },
  { id: 'high', label: 'High', hint: 'Cleaner penumbra while editing' },
  { id: 'ultra', label: 'Ultra', hint: 'Maximum samples — used automatically on export' },
];

/**
 * Vertical FOV of a 50 mm lens on 36×24 mm film: 2·atan(12/50) ≈ 27°.
 * That is the usual match for human perspective. Wider than this stretches
 * the phone; narrower starts to look like a telephoto.
 */
export const EYE_PERSPECTIVE_FOV = 27;
/** Distance that keeps the old 38° / 5.7 framing at the eye-matched FOV. */
export const EYE_CAMERA_DISTANCE = 8.175;
export const EYE_SPLIT_CAMERA_DISTANCE = 10.613;

export const CAMERA_LENSES: { id: CameraLens; label: string; hint: string; fov: number }[] = [
  { id: 'ultrawide', label: 'Ultrawide', hint: '~16 mm', fov: 62 },
  { id: 'wide', label: 'Wide', hint: '~24 mm', fov: 48 },
  { id: 'standard', label: 'Standard', hint: '~50 mm', fov: EYE_PERSPECTIVE_FOV },
  { id: 'telephoto', label: 'Telephoto', hint: '~85 mm', fov: 16 },
];

export function cameraLensFov(lens: CameraLens | undefined): number {
  return CAMERA_LENSES.find((item) => item.id === lens)?.fov ?? EYE_PERSPECTIVE_FOV;
}
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

/**
 * Studio cyclorama stops.
 * `center` is the lit wall, `mid` the cove, `edge` the floor.
 */
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

/** Max flip-able environment scenes inside one composition / tab */
export const MAX_COMPOSITION_SCENES = 8;

/**
 * Objects and studio setup that belong to one scene.
 * Inactive scenes keep their own copy, so edits do not leak across scenes.
 */
export interface SceneStage {
  devices: DeviceInstance[];
  selectedDeviceId: string;
  sceneProps: SceneProp[];
  overlays: SceneOverlay[];
  layers: CompositionLayer[];
  animation: AnimationClip;
  cameraView: CameraView;
  cameraLens: CameraLens;
  compositionMode: CompositionMode;
  linkSplitTransform: boolean;
  publishTarget: PublishTarget;
  reflectionMap: ReflectionMapSetting;
  reflectionMapImage: string | null;
  lightIntensity: number;
  lightPosition: Vec3;
  lightColor: string;
  fillIntensity: number;
  /** Extra luminaires layered on the studio rig */
  sceneLights: SceneLight[];
  /**
   * HDRI / environment map strength. `null` keeps the studio preset default.
   */
  environmentIntensity: number | null;
  /**
   * ACES tone-mapping exposure. `null` keeps the studio preset default.
   */
  toneMappingExposure: number | null;
  shadowSoftness: number;
  /** Floor / key shadow strength, 0–2. 1 is the soft default; above 1 darkens further. */
  shadowOpacity: number;
  /** Floor shadows on (`soft`) or off. Legacy contact/sharp still accepted. */
  shadowType: ShadowType;
  /** Extra contact darkening under the closest mesh points, 0–1. */
  shadowContact: number;
  /** Contact-shadow plate on/off. Absent on older saves — treated as on. */
  shadowContactEnabled: boolean;
  /** How far floor shadows reach, in world units. */
  shadowDistance: number;
  /** Floor shadow tint. */
  shadowColor: string;
  /** Screen-space ambient occlusion, 0–1. */
  ambientOcclusion: number;
  /** Interactive shadow map quality. */
  shadowQuality: ShadowQuality;
  showGroundBase: boolean;
  edgeBlurTop: boolean;
  edgeBlurBottom: boolean;
  edgeBlurAmount: number;
  /** Photographic blur. Off leaves the whole frame sharp. */
  depthOfField: boolean;
  /** Blur strength while depth of field is on, 0.05–1. */
  depthOfFieldAmount: number;
}

/**
 * A switchable 3D space inside one composition.
 * Background, devices, props, and camera live on the scene.
 * Soundtrack stays on the composition.
 */
export interface CompositionScene {
  id: string;
  name: string;
  background: BackgroundPreset;
  gradientColors: GradientColors;
  stage?: SceneStage;
}

export function createCompositionScene(partial?: Partial<CompositionScene>): CompositionScene {
  return {
    id: partial?.id ?? `scene-${Math.random().toString(36).slice(2, 10)}`,
    name: (partial?.name ?? 'Scene 1').trim().slice(0, 40) || 'Scene 1',
    background: partial?.background ?? 'studio',
    gradientColors: partial?.gradientColors
      ? { ...partial.gradientColors }
      : { ...BUILTIN_GRADIENTS.studio },
    stage: partial?.stage,
  };
}

type SceneProjectSlice = {
  scenes?: CompositionScene[];
  activeSceneId?: string;
  background: BackgroundPreset;
  gradientColors: GradientColors;
};

export function ensureCompositionScenes(project: SceneProjectSlice): CompositionScene[] {
  if (Array.isArray(project.scenes) && project.scenes.length > 0) {
    return project.scenes.slice(0, MAX_COMPOSITION_SCENES).map((scene, index) => createCompositionScene({
      ...scene,
      name: scene.name || `Scene ${index + 1}`,
    }));
  }
  return [
    createCompositionScene({
      id: 'scene-main',
      name: 'Scene 1',
      background: project.background,
      gradientColors: project.gradientColors,
    }),
  ];
}

function nextSceneName(scenes: CompositionScene[]) {
  const used = new Set(scenes.map((scene) => scene.name.trim().toLowerCase()));
  for (let i = 1; i < 100; i += 1) {
    const name = `Scene ${i}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Scene ${Date.now()}`;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Per-material overrides authored in DEV modeling mode (Spline-style). */
export type MaterialTweak = Record<string, number | boolean | string | null>;

export interface DeviceInstance {
  id: string;
  deviceId: DeviceId;
  rotation: Vec3;
  scale: number;
  position: Vec3;
  /** Screen / camera glass reflection strength (0 = matte, 1 = mirror) */
  glassReflection: number;
  /** Finish of glass and screen reflections. Drives roughness, clearcoat, and env intensity. */
  reflectionStyle: ReflectionStyle;
  /**
   * Per-environment screen media (still or video data URL).
   * In split mode each platform keeps its own shot — never shared unless copied.
   */
  screenshot?: string | null;
  /** Per-environment device finish; falls back to project.deviceColor when absent. */
  deviceColor?: DeviceColor;
  /** Per-environment clay finish; falls back to project.clayMode when absent. */
  clayMode?: boolean;
  /** Laptop lid openness: 0 = closed, 1 = open (default). */
  lidOpen?: number;
  /**
   * DEV modeling overrides keyed by material name (color, roughness, mapDataUrl, …).
   * Merged on top of the device library’s baked `tweaks`.
   */
  materialTweaks?: Record<string, MaterialTweak>;
  /**
   * Mesh / node names removed in DEV modeling mode (Apple logos, emboss marks, stray parts).
   * Applied on top of the device library’s baked `hideNodes`.
   */
  hiddenMeshes?: string[];
}

export type CompositionMode = 'single' | 'split';
/** Which platform environment is actively edited / exported. */
export type PublishTarget = 'ios' | 'android';

/** Decorative 3D set pieces for scenic pre-compositions */
export type ScenePropKind =
  | 'clay_sphere'
  | 'clay_cube'
  | 'clay_cylinder'
  | 'clay_torus'
  | 'clay_helix'
  | 'clay_cone'
  | 'clay_pyramid'
  | 'concrete_wall'
  | 'concrete_slab'
  | 'pedestal'
  | 'stone_plinth'
  | 'metal_disc'
  | 'studio_backdrop'
  | 'rock'
  | 'stage';

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

/** Extra luminaires (Spline-style) on top of the studio key / fill / rim rig. */
export type SceneLightKind = 'directional' | 'point' | 'spot' | 'area';

export interface SceneLight {
  id: string;
  kind: SceneLightKind;
  label: string;
  enabled: boolean;
  position: Vec3;
  /** Aim point for directional / spot / area */
  target: Vec3;
  color: string;
  intensity: number;
  /** Point / spot falloff */
  distance: number;
  decay: number;
  /** Spot cone (radians) */
  angle: number;
  penumbra: number;
  /** Area softbox size */
  width: number;
  height: number;
  castShadow: boolean;
}

export const SCENE_LIGHT_KINDS: SceneLightKind[] = [
  'directional', 'point', 'spot', 'area',
];

export const MAX_SCENE_LIGHTS = 8;

export function createSceneLight(
  partial: Partial<SceneLight> & { kind: SceneLightKind },
): SceneLight {
  const kind = partial.kind;
  const defaults: Record<SceneLightKind, Pick<SceneLight, 'label' | 'position' | 'intensity' | 'distance' | 'angle' | 'width' | 'height' | 'castShadow'>> = {
    directional: {
      label: 'Directional',
      position: { x: 3.2, y: 6, z: 4 },
      intensity: 0.85,
      distance: 0,
      angle: Math.PI / 6,
      width: 2,
      height: 2,
      castShadow: true,
    },
    point: {
      label: 'Point',
      position: { x: -2.4, y: 2.8, z: 2.2 },
      intensity: 1.1,
      distance: 12,
      angle: Math.PI / 6,
      width: 1,
      height: 1,
      castShadow: false,
    },
    spot: {
      label: 'Spot',
      position: { x: 2.8, y: 5.2, z: 3.4 },
      intensity: 1.4,
      distance: 16,
      angle: Math.PI / 7,
      width: 1,
      height: 1,
      castShadow: true,
    },
    area: {
      label: 'Area',
      position: { x: -3.2, y: 3.6, z: 4.5 },
      intensity: 1.2,
      distance: 0,
      angle: Math.PI / 6,
      width: 3.2,
      height: 2.4,
      castShadow: false,
    },
  };
  const base = defaults[kind];
  return {
    id: partial.id ?? `light-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    label: partial.label?.trim().slice(0, 32) || base.label,
    enabled: partial.enabled !== false,
    position: partial.position ? { ...partial.position } : { ...base.position },
    target: partial.target ? { ...partial.target } : { x: 0, y: 0, z: 0 },
    color: typeof partial.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(partial.color)
      ? partial.color
      : '#fff8f0',
    intensity: typeof partial.intensity === 'number' && Number.isFinite(partial.intensity)
      ? Math.min(20, Math.max(0, partial.intensity))
      : base.intensity,
    distance: typeof partial.distance === 'number' && Number.isFinite(partial.distance)
      ? Math.min(40, Math.max(0, partial.distance))
      : base.distance,
    decay: typeof partial.decay === 'number' && Number.isFinite(partial.decay)
      ? Math.min(4, Math.max(0, partial.decay))
      : 2,
    angle: typeof partial.angle === 'number' && Number.isFinite(partial.angle)
      ? Math.min(Math.PI / 2, Math.max(0.05, partial.angle))
      : base.angle,
    penumbra: typeof partial.penumbra === 'number' && Number.isFinite(partial.penumbra)
      ? Math.min(1, Math.max(0, partial.penumbra))
      : 0.45,
    width: typeof partial.width === 'number' && Number.isFinite(partial.width)
      ? Math.min(12, Math.max(0.2, partial.width))
      : base.width,
    height: typeof partial.height === 'number' && Number.isFinite(partial.height)
      ? Math.min(12, Math.max(0.2, partial.height))
      : base.height,
    castShadow: partial.castShadow ?? base.castShadow,
  };
}

export const SCENE_PROP_KINDS: ScenePropKind[] = [
  'clay_sphere', 'clay_cube', 'clay_cylinder', 'clay_torus',
  'clay_helix', 'clay_cone', 'clay_pyramid',
  'concrete_wall', 'concrete_slab', 'pedestal', 'stone_plinth', 'metal_disc',
  'studio_backdrop', 'rock', 'stage',
];

export function createSceneProp(partial: Partial<SceneProp> & { kind: ScenePropKind }): SceneProp {
  return {
    id: partial.id ?? `prop-${Math.random().toString(36).slice(2, 10)}`,
    kind: partial.kind,
    position: partial.position ?? { x: 0, y: 0, z: 0 },
    rotation: partial.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial.scale ?? 1,
    color: partial.color ?? (partial.kind === 'studio_backdrop' ? '#ffffff' : undefined),
  };
}

/** Reserved animation target for camera position tracks */
export const CAMERA_TARGET_ID = '__camera__';

/** Spline-style animatable channels on a device instance or the camera */
export type AnimProperty =
  | 'rotation.x'
  | 'rotation.y'
  | 'rotation.z'
  | 'position.x'
  | 'position.y'
  | 'position.z'
  | 'scale'
  | 'lidOpen'
  | 'camera.x'
  | 'camera.y'
  | 'camera.z';

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
  /**
   * Mirrored from the active publish-target device’s screenshot.
   * Prefer reading/writing via device.screenshot + publish helpers.
   */
  screenshot: string | null;
  /** @deprecated mirrored from selected device — kept for older saves */
  deviceId: DeviceId;
  /** Mirrored from the active env’s finish — `clay` forces a matte abstract look */
  deviceColor: DeviceColor;
  /** Mirrored from the active env — also set when deviceColor === 'clay' */
  clayMode: boolean;
  /**
   * Active platform environment for Assets / mirror / import / single-platform export.
   * The opposite panel stays visible in split mode with its own assets.
   */
  publishTarget: PublishTarget;
  /**
   * When true (default), rotation + scale stay linked across split partners.
   * Position is always free per device.
   */
  linkSplitTransform: boolean;
  /** 2D text / image overlays composited on export and preview */
  overlays: SceneOverlay[];
  /**
   * Switchable environment looks for this composition.
   * Always kept in sync with `background` / `gradientColors` for the active scene.
   */
  scenes: CompositionScene[];
  /** Which scene’s background is live in the canvas */
  activeSceneId: string;
  /** Mirrored from the active scene — kept for renderers and older code paths */
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
  /** Key directional light position in scene space */
  lightPosition: Vec3;
  /** Key directional light color (CSS hex) */
  lightColor: string;
  /** Soft fill / ambient light strength */
  fillIntensity: number;
  /** Extra luminaires (point / spot / area / directional) for realistic setups */
  sceneLights: SceneLight[];
  /**
   * HDRI strength override. `null` uses the background studio preset.
   */
  environmentIntensity: number | null;
  /**
   * ACES exposure override. `null` uses the background studio preset.
   */
  toneMappingExposure: number | null;
  /** Apparent key-light size — higher = softer penumbra */
  shadowSoftness: number;
  /** Floor / key shadow strength, 0–2. 1 is the soft default; above 1 darkens further. */
  shadowOpacity: number;
  /** Floor shadows on (`soft`) or off. Legacy contact/sharp still accepted. */
  shadowType: ShadowType;
  /** Extra contact darkening under the closest mesh points, 0–1. */
  shadowContact: number;
  /** Contact-shadow plate on/off. Absent on older saves — treated as on. */
  shadowContactEnabled: boolean;
  /** How far floor shadows reach, in world units. Raise for floating devices. */
  shadowDistance: number;
  /** Floor shadow tint (CSS hex). */
  shadowColor: string;
  /** Screen-space ambient occlusion, 0–1. */
  ambientOcclusion: number;
  /** Interactive shadow map quality. Export forces Ultra temporarily. */
  shadowQuality: ShadowQuality;
  /** Soft disc under the device; turn off for a floating product shot */
  showGroundBase: boolean;
  /** Soft progressive blur along the top of the frame */
  edgeBlurTop: boolean;
  /** Soft progressive blur along the bottom of the frame */
  edgeBlurBottom: boolean;
  /** Peak blur strength at the frame edges (px) */
  edgeBlurAmount: number;
  /** Photographic blur. Off leaves the whole frame sharp. */
  depthOfField: boolean;
  /** Blur strength while depth of field is on, 0.05–1. */
  depthOfFieldAmount: number;
  /**
   * @deprecated Prefer edgeBlurTop / edgeBlurBottom. Kept so older saves still load;
   * treated as “both edges” when the new flags are absent.
   */
  edgeBlurEnabled?: boolean;
  cameraView: CameraView;
  /** Perspective lens / FOV preset for the scene camera */
  cameraLens: CameraLens;
  compositionMode: CompositionMode;
  devices: DeviceInstance[];
  selectedDeviceId: string;
  /** Optional scenic set pieces (clay shapes, walls, pedestals) */
  sceneProps: SceneProp[];
  /**
   * Ordered stack for the active scene (back → front).
   * Copied into that scene’s stage when the scene changes.
   */
  layers?: CompositionLayer[];
  animation: AnimationClip;
  /** Optional soundtrack that plays with the animation timeline */
  soundtrackName: string | null;
  /** Data-URL audio when a soundtrack is attached (mp3/wav/ogg/m4a). */
  soundtrackData: string | null;
  /** Timeline start of the music clip (seconds). */
  soundtrackStart: number;
  /** Offset into the source audio (trim-in, seconds). */
  soundtrackOffset: number;
  /** Length of the music clip on the timeline (seconds). */
  soundtrackDuration: number;
  /** Seconds to ease music volume in from the start of the music clip */
  soundtrackFadeIn: number;
  /** Seconds to ease music volume out before the music clip ends */
  soundtrackFadeOut: number;
}

export function createDeviceInstance(partial?: Partial<DeviceInstance>): DeviceInstance {
  return {
    id: partial?.id ?? `device-${Math.random().toString(36).slice(2, 10)}`,
    deviceId: partial?.deviceId ?? 'iphone_15_pro_max',
    // Front-facing rest pose — studio camera looks straight at the screen.
    rotation: partial?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial?.scale ?? 1,
    // Centered above the studio floor; fitDeviceRoot seats the mesh for a soft shadow.
    position: partial?.position ?? { x: 0, y: 0, z: 0 },
    glassReflection: partial?.glassReflection ?? 0.55,
    reflectionStyle: normalizeReflectionStyle(partial?.reflectionStyle)
      ?? reflectionStyleForAmount(partial?.glassReflection ?? 0.55),
    screenshot: partial?.screenshot !== undefined ? partial.screenshot : null,
    deviceColor: partial?.deviceColor,
    clayMode: partial?.clayMode,
    lidOpen: partial?.lidOpen,
    materialTweaks: partial?.materialTweaks
      ? Object.fromEntries(
        Object.entries(partial.materialTweaks).map(([name, tweak]) => [name, { ...tweak }]),
      )
      : undefined,
    hiddenMeshes: Array.isArray(partial?.hiddenMeshes)
      ? [...new Set(partial.hiddenMeshes.filter((name): name is string => typeof name === 'string' && name.trim().length > 0))]
      : undefined,
  };
}

const primary = createDeviceInstance({ id: 'device-main' });

function kf(time: number, value: number): AnimKeyframe {
  return { id: `kf-${Math.random().toString(36).slice(2, 9)}`, time, value };
}

/** Default clip: a gentle product turntable that starts front-facing */
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
        keyframes: [kf(0, 0), kf(2, 28), kf(4, 0)],
      },
      {
        id: `track-${targetId}-rot-x`,
        targetId,
        property: 'rotation.x',
        keyframes: [kf(0, 0), kf(2, -6), kf(4, 0)],
      },
    ],
  };
}

export const BUILTIN_GRADIENTS: Record<Exclude<BuiltinBackgroundId, 'transparent'>, GradientColors> = {
  /** Dark Studio — wall / sky / floor as three distinct charcoal stops. */
  midnight: { center: '#6b707a', mid: '#3a3f48', edge: '#1a1c21' },
  /** Light Studio — soft white cyclorama with cove falloff. */
  studio: { center: '#ffffff', mid: '#f4f4f6', edge: '#e6e6ea' },
  mint: { center: '#9ed9c6', mid: '#246456', edge: '#0e2c26' },
  sunset: { center: '#f3c6d4', mid: '#6d5078', edge: '#1c1626' },
};

/** Earlier built-in palettes. Untouched looks are lifted onto the current one on load. */
const LEGACY_BUILTIN_GRADIENTS: Record<Exclude<BuiltinBackgroundId, 'transparent'>, GradientColors[]> = {
  midnight: [
    { center: '#4a4e58', mid: '#2e3138', edge: '#26282d' },
    { center: '#363e49', mid: '#1d232b', edge: '#0d1016' },
    { center: '#6d7786', mid: '#2c333d', edge: '#090b0e' },
    { center: '#a7b0c2', mid: '#3c4558', edge: '#141820' },
    { center: '#a7b0c2', mid: '#3c4558', edge: '#222836' },
  ],
  studio: [
    { center: '#efefef', mid: '#e4e4e4', edge: '#d6d6d6' },
    { center: '#ffffff', mid: '#ffffff', edge: '#ffffff' },
    { center: '#ffffff', mid: '#f7f7f5', edge: '#ecece8' },
    { center: '#ffffff', mid: '#e4e3de', edge: '#b7b6b0' },
    { center: '#ffffff', mid: '#d4d0c8', edge: '#8a877f' },
    { center: '#f6f4f0', mid: '#e4dfd6', edge: '#c9c3b8' },
    { center: '#f5f3ef', mid: '#e6e3dc', edge: '#cfc9bf' },
  ],
  mint: [
    { center: '#487e6c', mid: '#18463c', edge: '#071916' },
    { center: '#6fbfa4', mid: '#1a4d42', edge: '#061412' },
  ],
  sunset: [
    { center: '#c07a9d', mid: '#5c456e', edge: '#191428' },
    { center: '#e7a8c0', mid: '#5a4068', edge: '#120e1c' },
  ],
};

export const DEFAULT_GRADIENT: GradientColors = { ...BUILTIN_GRADIENTS.studio };

const defaultScene = createCompositionScene({
  id: 'scene-main',
  name: 'Scene 1',
  background: 'studio',
  gradientColors: { ...BUILTIN_GRADIENTS.studio },
});

export const DEFAULT_PROJECT: MockupProject = {
  version: 1,
  name: 'Untitled composition',
  screenshot: null,
  deviceId: primary.deviceId,
  deviceColor: 'graphite',
  clayMode: false,
  publishTarget: 'ios',
  linkSplitTransform: true,
  overlays: [],
  scenes: [defaultScene],
  activeSceneId: defaultScene.id,
  background: defaultScene.background,
  gradientColors: { ...defaultScene.gradientColors },
  reflectionMap: 'softbox',
  reflectionMapImage: null,
  rotation: { ...primary.rotation },
  scale: primary.scale,
  // Spline-like: soft ambient wrap first, gentle key for shape.
  lightIntensity: 0.9,
  lightPosition: { x: 3.8, y: 5.8, z: 5.6 },
  lightColor: '#fff8f0',
  fillIntensity: 1.05,
  sceneLights: [],
  environmentIntensity: null,
  toneMappingExposure: null,
  // Photographic product floor: soft penumbra, visible contact, subtle AO.
  // Softness ~50% of the 0.2–14 range; opacity 1 = 100% on the panel.
  // Quality Auto for edit — export boosts maps to Ultra.
  shadowSoftness: 7.2,
  shadowOpacity: 1,
  shadowType: 'soft',
  shadowContact: 0.55,
  shadowContactEnabled: true,
  shadowDistance: 3.6,
  shadowColor: '#1a1c22',
  ambientOcclusion: 0.28,
  shadowQuality: 'auto',
  showGroundBase: true,
  edgeBlurTop: false,
  edgeBlurBottom: false,
  edgeBlurAmount: 24,
  depthOfField: false,
  depthOfFieldAmount: 0.48,
  cameraView: 'front',
  cameraLens: 'standard',
  compositionMode: 'single',
  devices: [primary],
  selectedDeviceId: primary.id,
  sceneProps: [],
  layers: [createCompositionLayer('device', primary.id)],
  animation: createDefaultAnimation(primary.id),
  soundtrackName: null,
  soundtrackData: null,
  soundtrackStart: 0,
  soundtrackOffset: 0,
  soundtrackDuration: 4,
  soundtrackFadeIn: 0.8,
  soundtrackFadeOut: 1.2,
};

export const ANIM_PROPERTIES: { id: AnimProperty; label: string; unit: string }[] = [
  { id: 'rotation.x', label: 'Rotate X', unit: '°' },
  { id: 'rotation.y', label: 'Rotate Y', unit: '°' },
  { id: 'rotation.z', label: 'Rotate Z', unit: '°' },
  { id: 'position.x', label: 'Pos X', unit: '' },
  { id: 'position.y', label: 'Pos Y', unit: '' },
  { id: 'position.z', label: 'Pos Z', unit: '' },
  { id: 'scale', label: 'Scale', unit: '×' },
  { id: 'lidOpen', label: 'Fold / Lid', unit: '' },
  { id: 'camera.x', label: 'Camera X', unit: '' },
  { id: 'camera.y', label: 'Camera Y', unit: '' },
  { id: 'camera.z', label: 'Camera Z', unit: '' },
];

export const CAMERA_ANIM_PROPERTIES: AnimProperty[] = ['camera.x', 'camera.y', 'camera.z'];

export const DEVICE_ANIM_PROPERTIES: AnimProperty[] = [
  'rotation.x', 'rotation.y', 'rotation.z',
  'position.x', 'position.y', 'position.z',
  'scale',
  'lidOpen',
];

export const IOS_DEVICE_ID: DeviceId = 'iphone_15_pro_max';
export const ANDROID_DEVICE_ID: DeviceId = 'galaxy_s26_ultra';

export function buildSplitDevices(base: DeviceInstance): DeviceInstance[] {
  const sharedRotation = { ...base.rotation };
  const sharedScale = Math.min(base.scale, 0.92);
  const basePlatform = getDevice(base.deviceId).platform;
  const baseShot = base.screenshot ?? null;
  const baseColor = base.deviceColor ?? 'graphite';
  const baseClay = base.clayMode ?? false;
  return [
    createDeviceInstance({
      id: 'device-ios',
      deviceId: IOS_DEVICE_ID,
      rotation: sharedRotation,
      scale: sharedScale,
      position: { x: 0, y: 0, z: 0 },
      glassReflection: base.glassReflection,
      reflectionStyle: base.reflectionStyle,
      screenshot: basePlatform === 'ios' ? baseShot : null,
      deviceColor: basePlatform === 'ios' ? baseColor : 'graphite',
      clayMode: basePlatform === 'ios' ? baseClay : false,
    }),
    createDeviceInstance({
      id: 'device-android',
      deviceId: ANDROID_DEVICE_ID,
      rotation: { ...sharedRotation },
      scale: sharedScale,
      position: { x: 0, y: 0, z: 0 },
      glassReflection: base.glassReflection,
      reflectionStyle: base.reflectionStyle,
      screenshot: basePlatform === 'android' ? baseShot : null,
      deviceColor: basePlatform === 'android' ? baseColor : 'graphite',
      clayMode: basePlatform === 'android' ? baseClay : false,
    }),
  ];
}

export function getSelectedDevice(project: MockupProject): DeviceInstance {
  return project.devices.find((d) => d.id === project.selectedDeviceId) ?? project.devices[0] ?? primary;
}

export function syncProjectFromSelected(project: MockupProject, selected: DeviceInstance): MockupProject {
  const screenshot = selected.screenshot !== undefined ? selected.screenshot : project.screenshot;
  const deviceColor = selected.deviceColor ?? project.deviceColor;
  const clayMode = selected.clayMode ?? project.clayMode ?? deviceColor === 'clay';
  return {
    ...project,
    selectedDeviceId: selected.id,
    deviceId: selected.deviceId,
    rotation: { ...selected.rotation },
    scale: selected.scale,
    screenshot: screenshot ?? null,
    deviceColor,
    clayMode,
  };
}

export function getActiveCompositionScene(project: MockupProject): CompositionScene {
  const scenes = ensureCompositionScenes(project);
  return scenes.find((scene) => scene.id === project.activeSceneId) ?? scenes[0];
}

/** Mirror active scene look onto top-level background fields used by the canvas. */
export function syncProjectFromActiveScene(project: MockupProject): MockupProject {
  const scenes = ensureCompositionScenes(project);
  const active = scenes.find((scene) => scene.id === project.activeSceneId) ?? scenes[0];
  return {
    ...project,
    scenes,
    activeSceneId: active.id,
    background: active.background,
    gradientColors: { ...active.gradientColors },
  };
}

/** Patch the active scene and keep top-level background fields in sync. */
export function patchActiveCompositionScene(
  project: MockupProject,
  patch: Partial<Pick<CompositionScene, 'name' | 'background' | 'gradientColors'>>,
): MockupProject {
  const scenes = ensureCompositionScenes(project);
  const activeId = scenes.some((scene) => scene.id === project.activeSceneId)
    ? project.activeSceneId
    : scenes[0].id;
  const nextScenes = scenes.map((scene) => {
    if (scene.id !== activeId) return scene;
    return createCompositionScene({
      ...scene,
      ...patch,
      gradientColors: patch.gradientColors ? { ...patch.gradientColors } : scene.gradientColors,
    });
  });
  const active = nextScenes.find((scene) => scene.id === activeId) ?? nextScenes[0];
  return {
    ...project,
    scenes: nextScenes,
    activeSceneId: active.id,
    background: active.background,
    gradientColors: { ...active.gradientColors },
  };
}

function freshId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneDevice(device: DeviceInstance, id = device.id): DeviceInstance {
  return createDeviceInstance({
    ...device,
    id,
    rotation: { ...device.rotation },
    position: { ...device.position },
  });
}

function cloneProp(prop: SceneProp, id = prop.id): SceneProp {
  return createSceneProp({
    ...prop,
    id,
    position: { ...prop.position },
    rotation: { ...prop.rotation },
    scale: typeof prop.scale === 'number' ? prop.scale : { ...prop.scale },
  });
}

function cloneOverlay(
  overlay: SceneOverlay,
  id = overlay.id,
  deviceIds?: Map<string, string>,
): SceneOverlay {
  const anchor = overlay.anchor
    ? {
      deviceId: deviceIds?.get(overlay.anchor.deviceId) ?? overlay.anchor.deviceId,
      points: overlay.anchor.points.map((point) => ({ ...point })),
    }
    : undefined;
  return { ...overlay, id, anchor };
}

function cloneAnimation(clip: AnimationClip, mapTarget?: (targetId: string) => string | null): AnimationClip {
  return {
    duration: clip.duration,
    fps: clip.fps,
    loop: clip.loop,
    tracks: clip.tracks.flatMap((track) => {
      const targetId = mapTarget ? mapTarget(track.targetId) : track.targetId;
      if (!targetId) return [];
      return [{
        ...track,
        id: mapTarget ? freshId(`track-${targetId}-${track.property}`) : track.id,
        targetId,
        keyframes: track.keyframes.map((frame) => ({
          ...frame,
          id: mapTarget ? freshId('kf') : frame.id,
          easeBezier: frame.easeBezier
            ? [frame.easeBezier[0], frame.easeBezier[1], frame.easeBezier[2], frame.easeBezier[3]] as EaseBezier
            : undefined,
        })),
      }];
    }),
  };
}

function cloneSceneLight(light: SceneLight): SceneLight {
  return {
    ...light,
    position: { ...light.position },
    target: { ...light.target },
  };
}

function cloneSceneStage(stage: SceneStage): SceneStage {
  return {
    ...stage,
    devices: stage.devices.map((device) => cloneDevice(device)),
    sceneProps: stage.sceneProps.map((prop) => cloneProp(prop)),
    overlays: stage.overlays.map((overlay) => cloneOverlay(overlay)),
    layers: stage.layers.map((layer) => ({ ...layer })),
    animation: cloneAnimation(stage.animation),
    lightPosition: { ...stage.lightPosition },
    sceneLights: (stage.sceneLights ?? []).map((light) => cloneSceneLight(light)),
    environmentIntensity: stage.environmentIntensity ?? null,
    toneMappingExposure: stage.toneMappingExposure ?? null,
  };
}

/** Independent copies with new ids, so the duplicate can move on its own. */
function duplicateSceneStage(stage: SceneStage): SceneStage {
  const deviceIds = new Map(stage.devices.map((device) => [device.id, freshId('device')]));
  const propIds = new Map(stage.sceneProps.map((prop) => [prop.id, freshId('prop')]));
  const overlayIds = new Map(stage.overlays.map((overlay) => [overlay.id, freshId('overlay')]));
  const devices = stage.devices.map((device) => cloneDevice(device, deviceIds.get(device.id)!));
  const sceneProps = stage.sceneProps.map((prop) => cloneProp(prop, propIds.get(prop.id)!));
  const overlays = stage.overlays.map((overlay) => cloneOverlay(overlay, overlayIds.get(overlay.id)!, deviceIds));
  const layers = stage.layers.flatMap((layer) => {
    const refId = layer.kind === 'device'
      ? deviceIds.get(layer.refId)
      : layer.kind === 'prop'
        ? propIds.get(layer.refId)
        : overlayIds.get(layer.refId);
    if (!refId) return [];
    return [createCompositionLayer(layer.kind, refId, { visible: layer.visible })];
  });
  return {
    ...stage,
    devices,
    selectedDeviceId: deviceIds.get(stage.selectedDeviceId) ?? devices[0]?.id ?? freshId('device'),
    sceneProps,
    overlays,
    layers,
    animation: cloneAnimation(stage.animation, (targetId) => (
      targetId === CAMERA_TARGET_ID ? CAMERA_TARGET_ID : deviceIds.get(targetId) ?? null
    )),
    lightPosition: { ...stage.lightPosition },
    sceneLights: (stage.sceneLights ?? []).map((light) => cloneSceneLight(light)),
    environmentIntensity: stage.environmentIntensity ?? null,
    toneMappingExposure: stage.toneMappingExposure ?? null,
  };
}

function blankSceneStage(): SceneStage {
  const device = createDeviceInstance({ id: freshId('device') });
  return {
    devices: [device],
    selectedDeviceId: device.id,
    sceneProps: [],
    overlays: [],
    layers: [createCompositionLayer('device', device.id)],
    animation: createDefaultAnimation(device.id),
    cameraView: 'front',
    cameraLens: 'standard',
    compositionMode: 'single',
    linkSplitTransform: true,
    publishTarget: 'ios',
    reflectionMap: DEFAULT_PROJECT.reflectionMap,
    reflectionMapImage: null,
    lightIntensity: DEFAULT_PROJECT.lightIntensity,
    lightPosition: { ...DEFAULT_PROJECT.lightPosition },
    lightColor: DEFAULT_PROJECT.lightColor,
    fillIntensity: DEFAULT_PROJECT.fillIntensity,
    sceneLights: [],
    environmentIntensity: null,
    toneMappingExposure: null,
    shadowSoftness: DEFAULT_PROJECT.shadowSoftness,
    shadowOpacity: DEFAULT_PROJECT.shadowOpacity,
    shadowType: DEFAULT_PROJECT.shadowType,
    shadowContact: DEFAULT_PROJECT.shadowContact,
    shadowContactEnabled: DEFAULT_PROJECT.shadowContactEnabled,
    shadowDistance: DEFAULT_PROJECT.shadowDistance,
    shadowColor: DEFAULT_PROJECT.shadowColor,
    ambientOcclusion: DEFAULT_PROJECT.ambientOcclusion,
    shadowQuality: DEFAULT_PROJECT.shadowQuality,
    // A blank scene starts with an empty stage; the Stage tool adds a floor piece.
    showGroundBase: false,
    edgeBlurTop: false,
    edgeBlurBottom: false,
    edgeBlurAmount: DEFAULT_PROJECT.edgeBlurAmount,
    depthOfField: false,
    depthOfFieldAmount: DEFAULT_PROJECT.depthOfFieldAmount,
  };
}

/** Read the live canvas into a scene snapshot. */
export function captureSceneStage(project: MockupProject): SceneStage {
  const devices = (project.devices.length ? project.devices : DEFAULT_PROJECT.devices)
    .map((device) => cloneDevice(device));
  const selected = devices.find((device) => device.id === project.selectedDeviceId) ?? devices[0];
  const sceneProps = (project.sceneProps ?? []).map((prop) => cloneProp(prop));
  const overlays = (project.overlays ?? []).map((overlay) => cloneOverlay(overlay));
  const layers = (project.layers?.length
    ? project.layers
    : [
      ...sceneProps.map((prop) => createCompositionLayer('prop', prop.id)),
      ...devices.map((device) => createCompositionLayer('device', device.id)),
      ...overlays.map((overlay) => createCompositionLayer('overlay', overlay.id)),
    ]).map((layer) => ({ ...layer }));
  return {
    devices,
    selectedDeviceId: selected.id,
    sceneProps,
    overlays,
    layers,
    animation: cloneAnimation(project.animation ?? createDefaultAnimation(selected.id)),
    cameraView: project.cameraView,
    cameraLens: project.cameraLens,
    compositionMode: project.compositionMode,
    linkSplitTransform: project.linkSplitTransform,
    publishTarget: project.publishTarget,
    reflectionMap: project.reflectionMap,
    reflectionMapImage: project.reflectionMapImage,
    lightIntensity: project.lightIntensity,
    lightPosition: { ...project.lightPosition },
    lightColor: project.lightColor,
    fillIntensity: project.fillIntensity,
    sceneLights: (project.sceneLights ?? []).map((light) => cloneSceneLight(light)),
    environmentIntensity: project.environmentIntensity ?? null,
    toneMappingExposure: project.toneMappingExposure ?? null,
    shadowSoftness: project.shadowSoftness,
    shadowOpacity: project.shadowOpacity,
    shadowType: project.shadowType ?? DEFAULT_PROJECT.shadowType,
    shadowContact: project.shadowContact ?? DEFAULT_PROJECT.shadowContact,
    shadowContactEnabled: project.shadowContactEnabled !== false,
    shadowDistance: project.shadowDistance ?? DEFAULT_PROJECT.shadowDistance,
    shadowColor: project.shadowColor ?? DEFAULT_PROJECT.shadowColor,
    ambientOcclusion: project.ambientOcclusion ?? DEFAULT_PROJECT.ambientOcclusion,
    shadowQuality: project.shadowQuality ?? DEFAULT_PROJECT.shadowQuality,
    showGroundBase: project.showGroundBase,
    edgeBlurTop: project.edgeBlurTop,
    edgeBlurBottom: project.edgeBlurBottom,
    edgeBlurAmount: project.edgeBlurAmount,
    depthOfField: project.depthOfField,
    depthOfFieldAmount: project.depthOfFieldAmount,
  };
}

/** Store the live canvas on the active scene. Older scenes without a snapshot get a copy too. */
export function commitActiveScene(project: MockupProject): MockupProject {
  const scenes = ensureCompositionScenes(project);
  const activeId = scenes.some((scene) => scene.id === project.activeSceneId)
    ? project.activeSceneId
    : scenes[0].id;
  const stage = captureSceneStage({ ...project, scenes, activeSceneId: activeId });
  const nextScenes = scenes.map((scene) => {
    if (scene.id === activeId) {
      return createCompositionScene({
        ...scene,
        background: project.background,
        gradientColors: project.gradientColors,
        stage,
      });
    }
    if (!scene.stage) {
      return createCompositionScene({ ...scene, stage: captureSceneStage(project) });
    }
    return scene;
  });
  return {
    ...project,
    scenes: nextScenes,
    activeSceneId: activeId,
  };
}

/** Load one scene's devices, camera, and lights onto the live canvas. */
export function applySceneStage(project: MockupProject, scene: CompositionScene): MockupProject {
  const stage = scene.stage ? cloneSceneStage(scene.stage) : captureSceneStage(project);
  const devices = stage.devices.map((device) => cloneDevice(device));
  const selected = devices.find((device) => device.id === stage.selectedDeviceId) ?? devices[0];
  if (!selected) return syncProjectFromActiveScene(project);
  return syncProjectFromActiveScene(syncProjectFromSelected({
    ...project,
    activeSceneId: scene.id,
    background: scene.background,
    gradientColors: { ...scene.gradientColors },
    devices,
    selectedDeviceId: selected.id,
    sceneProps: stage.sceneProps.map((prop) => cloneProp(prop)),
    overlays: stage.overlays.map((overlay) => cloneOverlay(overlay)),
    layers: stage.layers.map((layer) => ({ ...layer })),
    animation: cloneAnimation(stage.animation),
    cameraView: stage.cameraView,
    cameraLens: stage.cameraLens,
    compositionMode: stage.compositionMode,
    linkSplitTransform: stage.linkSplitTransform,
    publishTarget: stage.publishTarget,
    reflectionMap: stage.reflectionMap,
    reflectionMapImage: stage.reflectionMapImage,
    lightIntensity: stage.lightIntensity,
    lightPosition: { ...stage.lightPosition },
    lightColor: stage.lightColor,
    fillIntensity: stage.fillIntensity,
    sceneLights: (stage.sceneLights ?? []).map((light) => cloneSceneLight(light)),
    environmentIntensity: stage.environmentIntensity ?? null,
    toneMappingExposure: stage.toneMappingExposure ?? null,
    shadowSoftness: stage.shadowSoftness,
    shadowOpacity: stage.shadowOpacity,
    shadowType: stage.shadowType ?? DEFAULT_PROJECT.shadowType,
    shadowContact: stage.shadowContact ?? DEFAULT_PROJECT.shadowContact,
    shadowContactEnabled: stage.shadowContactEnabled !== false,
    shadowDistance: stage.shadowDistance ?? DEFAULT_PROJECT.shadowDistance,
    shadowColor: stage.shadowColor ?? DEFAULT_PROJECT.shadowColor,
    ambientOcclusion: stage.ambientOcclusion ?? DEFAULT_PROJECT.ambientOcclusion,
    shadowQuality: stage.shadowQuality ?? DEFAULT_PROJECT.shadowQuality,
    showGroundBase: stage.showGroundBase,
    edgeBlurTop: stage.edgeBlurTop,
    edgeBlurBottom: stage.edgeBlurBottom,
    edgeBlurAmount: stage.edgeBlurAmount,
    depthOfField: stage.depthOfField,
    depthOfFieldAmount: stage.depthOfFieldAmount,
  }, selected));
}

export function switchCompositionScene(project: MockupProject, sceneId: string): MockupProject {
  const committed = commitActiveScene(project);
  const scene = committed.scenes.find((item) => item.id === sceneId);
  if (!scene) return committed;
  return applySceneStage(committed, scene);
}

export type NewSceneMode = 'duplicate' | 'blank';

export function addCompositionScene(project: MockupProject, mode: NewSceneMode | boolean = 'duplicate'): MockupProject {
  const kind: NewSceneMode = mode === false || mode === 'blank' ? 'blank' : 'duplicate';
  const committed = commitActiveScene(project);
  const scenes = committed.scenes;
  if (scenes.length >= MAX_COMPOSITION_SCENES) return committed;
  const active = scenes.find((scene) => scene.id === committed.activeSceneId) ?? scenes[0];
  const sourceStage = active.stage ?? captureSceneStage(committed);
  const next = createCompositionScene({
    name: kind === 'blank'
      ? nextSceneName(scenes)
      : `${active.name.replace(/\s+copy$/i, '')} copy`.slice(0, 40),
    background: kind === 'blank' ? 'studio' : active.background,
    gradientColors: kind === 'blank' ? { ...BUILTIN_GRADIENTS.studio } : { ...active.gradientColors },
    stage: kind === 'blank' ? blankSceneStage() : duplicateSceneStage(sourceStage),
  });
  const index = Math.max(0, scenes.findIndex((scene) => scene.id === active.id));
  const nextScenes = [...scenes.slice(0, index + 1), next, ...scenes.slice(index + 1)];
  return applySceneStage({
    ...committed,
    scenes: nextScenes,
    activeSceneId: next.id,
  }, next);
}

export function duplicateCompositionScene(project: MockupProject, sceneId?: string): MockupProject {
  if (sceneId && sceneId !== project.activeSceneId) {
    const switched = switchCompositionScene(project, sceneId);
    if (switched.activeSceneId !== sceneId) return commitActiveScene(project);
    return addCompositionScene(switched, 'duplicate');
  }
  return addCompositionScene(project, 'duplicate');
}

export function removeCompositionScene(project: MockupProject, sceneId: string): MockupProject {
  const committed = commitActiveScene(project);
  const scenes = committed.scenes;
  if (scenes.length <= 1) return committed;
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return committed;
  const nextScenes = scenes.filter((scene) => scene.id !== sceneId);
  const fallback = nextScenes[Math.max(0, index - 1)] ?? nextScenes[0];
  const activeSceneId = committed.activeSceneId === sceneId ? fallback.id : committed.activeSceneId;
  const nextProject = { ...committed, scenes: nextScenes, activeSceneId };
  if (activeSceneId === committed.activeSceneId) return nextProject;
  const nextActive = nextScenes.find((scene) => scene.id === activeSceneId) ?? fallback;
  return applySceneStage(nextProject, nextActive);
}

export function renameCompositionScene(project: MockupProject, sceneId: string, name: string): MockupProject {
  const scenes = ensureCompositionScenes(project);
  const nextName = name.trim().slice(0, 40) || 'Scene';
  const nextScenes = scenes.map((scene) => (
    scene.id === sceneId ? { ...scene, name: nextName } : scene
  ));
  return { ...project, scenes: nextScenes };
}

export const BACKGROUNDS: ScenePreset[] = [
  { id: 'midnight', label: 'Dark Studio', description: 'Charcoal seamless, cinematic lighting', gradient: BUILTIN_GRADIENTS.midnight },
  { id: 'studio', label: 'Light Studio', description: 'Soft white Apple-style product sweep', gradient: BUILTIN_GRADIENTS.studio },
  { id: 'mint', label: 'Emerald', description: 'Soft green studio', gradient: BUILTIN_GRADIENTS.mint },
  { id: 'sunset', label: 'Sunset', description: 'Soft dusk wash', gradient: BUILTIN_GRADIENTS.sunset },
  { id: 'transparent', label: 'Transparent Studio', description: 'Clear BG for PNG/WebP export', gradient: null },
];

export function isTransparentBackground(id: BackgroundPreset): boolean {
  return id === 'transparent';
}

export function gradientCss(colors: GradientColors): string {
  return `radial-gradient(ellipse 88% 72% at 50% 34%, ${colors.center}, transparent 70%), linear-gradient(180deg, ${colors.mid} 0%, ${colors.center} 30%, ${colors.mid} 62%, ${colors.edge} 100%)`;
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

function gradientsEqual(a: GradientColors, b: GradientColors) {
  return a.center === b.center && a.mid === b.mid && a.edge === b.edge;
}

/** Keep custom colours, but lift untouched built-in looks onto the studio cyclorama. */
export function resolveSceneGradient(
  backgroundId: string,
  input: Partial<GradientColors> | undefined,
  fallback: GradientColors,
): GradientColors {
  const normalized = normalizeGradientColors(input, fallback);
  const key = backgroundId as keyof typeof BUILTIN_GRADIENTS;
  const legacy = LEGACY_BUILTIN_GRADIENTS[key];
  const current = BUILTIN_GRADIENTS[key];
  if (legacy && current && legacy.some((entry) => gradientsEqual(normalized, entry))) return { ...current };
  return normalized;
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
  { id: 'graphite', label: 'Graphite', hex: TONE_GRAPHITE },
  { id: 'titanium', label: 'Titanium', hex: TONE_TITANIUM },
  { id: 'silver', label: 'Silver', hex: TONE_SILVER },
  { id: 'rose', label: 'Rose', hex: TONE_ROSE },
  { id: 'clay', label: 'Clay', hex: TONE_CLAY },
];

export const EXPORT_FPS_OPTIONS = [24, 30, 60] as const;


export type ExportAspectGroup = 'social' | 'store' | 'other';

/** Platform / framing presets. Pair with EXPORT_RESOLUTIONS for final pixel size. */
export const EXPORT_ASPECTS = [
  { id: 'tiktok', label: 'TikTok / Shorts', shortLabel: 'TikTok', hint: '9:16', ratio: 9 / 16, group: 'social' as const },
  { id: 'reels', label: 'IG Reels / Story', shortLabel: 'Reels', hint: '9:16', ratio: 9 / 16, group: 'social' as const },
  { id: 'ig_feed', label: 'Instagram Feed', shortLabel: 'IG Feed', hint: '4:5', ratio: 4 / 5, group: 'social' as const },
  { id: 'square', label: 'Square', shortLabel: 'Square', hint: '1:1', ratio: 1, group: 'social' as const },
  { id: 'youtube', label: 'YouTube', shortLabel: 'YouTube', hint: '16:9', ratio: 16 / 9, group: 'social' as const },
  { id: 'twitter', label: 'X / LinkedIn', shortLabel: 'X', hint: '1.91:1', ratio: 1.91, group: 'social' as const },
  {
    id: 'appstore',
    label: 'Apple App Store',
    shortLabel: 'App Store',
    hint: 'iPhone 6.7″',
    ratio: 1290 / 2796,
    fixed: { width: 1290, height: 2796 },
    group: 'store' as const,
  },
  {
    id: 'playstore',
    label: 'Google Play',
    shortLabel: 'Play',
    hint: 'Phone',
    ratio: 1080 / 1920,
    fixed: { width: 1080, height: 1920 },
    group: 'store' as const,
  },
  {
    id: 'play_feature',
    label: 'Play Feature',
    shortLabel: 'Feature',
    hint: '1024×500',
    ratio: 1024 / 500,
    fixed: { width: 1024, height: 500 },
    group: 'store' as const,
  },
  { id: 'custom', label: 'Custom', shortLabel: 'Custom', hint: 'Free', ratio: 9 / 16, group: 'other' as const },
] as const;
export type ExportAspectId = (typeof EXPORT_ASPECTS)[number]['id'];

export const EXPORT_ASPECT_GROUPS: { id: ExportAspectGroup; label: string }[] = [
  { id: 'social', label: 'Social & video' },
  { id: 'store', label: 'App stores' },
  { id: 'other', label: 'Custom' },
];

/** True when the aspect locks to a store / console pixel size. */
export function exportAspectHasFixed(aspectId: ExportAspectId): boolean {
  const aspect = EXPORT_ASPECTS.find((item) => item.id === aspectId);
  return Boolean(aspect && 'fixed' in aspect && aspect.fixed);
}

export function exportAspectFixedSize(aspectId: ExportAspectId): { width: number; height: number } | null {
  const aspect = EXPORT_ASPECTS.find((item) => item.id === aspectId);
  if (!aspect || !('fixed' in aspect) || !aspect.fixed) return null;
  return aspect.fixed;
}

/** Output resolution tiers (applied to the selected aspect). */
export const EXPORT_RESOLUTIONS = [
  { id: 'hd', label: 'HD', detail: '720', longEdge: 1280 },
  { id: 'fhd', label: 'Full HD', detail: '1080', longEdge: 1920 },
  { id: 'qhd', label: '2K', detail: '1440', longEdge: 2560 },
  { id: 'uhd', label: '4K', detail: '2160', longEdge: 3840 },
  { id: 'native', label: 'Platform size', detail: 'Fixed', longEdge: 0 },
  { id: 'custom', label: 'Custom px', detail: 'Manual', longEdge: 0 },
] as const;
export type ExportResolutionId = (typeof EXPORT_RESOLUTIONS)[number]['id'];

/** @deprecated kept for older references — use EXPORT_ASPECTS + EXPORT_RESOLUTIONS */
export const EXPORT_PRESETS = [
  { id: 'tiktok', label: 'TikTok / Shorts', dimensions: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'square', label: 'Square', dimensions: '1080 × 1080', width: 1080, height: 1080 },
  { id: 'youtube', label: 'YouTube', dimensions: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'appstore', label: 'Apple App Store', dimensions: '1290 × 2796', width: 1290, height: 2796 },
  { id: 'playstore', label: 'Google Play', dimensions: '1080 × 1920', width: 1080, height: 1920 },
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
  const fixed = exportAspectFixedSize(aspect.id);

  if (aspectId === 'custom' || resolutionId === 'custom') {
    const width = evenSize(custom?.width ?? fixed?.width ?? 1080);
    const height = evenSize(custom?.height ?? fixed?.height ?? 1920);
    return { width, height, label: `${width} × ${height}` };
  }

  if (fixed && (resolutionId === 'native' || exportAspectHasFixed(aspectId))) {
    return {
      width: fixed.width,
      height: fixed.height,
      label: `${fixed.width} × ${fixed.height}`,
    };
  }

  if (resolutionId === 'native') {
    const fallback = fixed ?? { width: 1290, height: 2796 };
    return {
      width: fallback.width,
      height: fallback.height,
      label: `${fallback.width} × ${fallback.height}`,
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
