import { getDevice, type DeviceId } from './lib/devices';
import type { SceneOverlay } from './lib/overlays';

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
export type { SceneOverlay };

export const CAMERA_LENSES: { id: CameraLens; label: string; hint: string; fov: number }[] = [
  { id: 'ultrawide', label: 'Ultrawide', hint: '~16 mm', fov: 62 },
  { id: 'wide', label: 'Wide', hint: '~24 mm', fov: 48 },
  { id: 'standard', label: 'Standard', hint: '~35 mm', fov: 38 },
  { id: 'telephoto', label: 'Telephoto', hint: '~85 mm', fov: 26 },
];

export function cameraLensFov(lens: CameraLens | undefined): number {
  return CAMERA_LENSES.find((item) => item.id === lens)?.fov ?? 38;
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
 * A switchable look inside one composition — background + gradient.
 * Devices, screenshot, animation, etc. stay shared on the project.
 */
export interface CompositionScene {
  id: string;
  name: string;
  background: BackgroundPreset;
  gradientColors: GradientColors;
}

export function createCompositionScene(partial?: Partial<CompositionScene>): CompositionScene {
  return {
    id: partial?.id ?? `scene-${Math.random().toString(36).slice(2, 10)}`,
    name: (partial?.name ?? 'Scene 1').trim().slice(0, 40) || 'Scene 1',
    background: partial?.background ?? 'midnight',
    gradientColors: partial?.gradientColors
      ? { ...partial.gradientColors }
      : { center: '#a7b0c2', mid: '#3c4558', edge: '#222836' },
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

export interface DeviceInstance {
  id: string;
  deviceId: DeviceId;
  rotation: Vec3;
  scale: number;
  position: Vec3;
  /** Screen / camera glass reflection strength (0 = matte, 1 = strong) */
  glassReflection: number;
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

export const SCENE_PROP_KINDS: ScenePropKind[] = [
  'clay_sphere', 'clay_cube', 'clay_cylinder', 'clay_torus',
  'clay_helix', 'clay_cone', 'clay_pyramid',
  'concrete_wall', 'concrete_slab', 'pedestal', 'studio_backdrop',
  'rock', 'stage',
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
  /** Contact shadow blur — higher = softer edges */
  shadowSoftness: number;
  /** Contact shadow darkness */
  shadowOpacity: number;
  /** Soft disc under the device; turn off for a floating product shot */
  showGroundBase: boolean;
  /** Soft progressive blur along the top of the frame */
  edgeBlurTop: boolean;
  /** Soft progressive blur along the bottom of the frame */
  edgeBlurBottom: boolean;
  /** Peak blur strength at the frame edges (px) */
  edgeBlurAmount: number;
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
   * Ordered stack within the active composition (back → front).
   * Devices, props, and overlays share one list; not per-scene.
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
    rotation: partial?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial?.scale ?? 1,
    position: partial?.position ?? { x: 0, y: 0, z: 0 },
    glassReflection: partial?.glassReflection ?? 0.55,
    screenshot: partial?.screenshot !== undefined ? partial.screenshot : null,
    deviceColor: partial?.deviceColor,
    clayMode: partial?.clayMode,
    lidOpen: partial?.lidOpen,
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
  midnight: { center: '#a7b0c2', mid: '#3c4558', edge: '#222836' },
  studio: { center: '#f6f4f0', mid: '#e4dfd6', edge: '#c9c3b8' },
  mint: { center: '#9ed9c6', mid: '#246456', edge: '#0e2c26' },
  sunset: { center: '#f3c6d4', mid: '#6d5078', edge: '#1c1626' },
};

/** Earlier built-in palettes. Untouched looks are lifted onto the current one on load. */
const LEGACY_BUILTIN_GRADIENTS: Record<Exclude<BuiltinBackgroundId, 'transparent'>, GradientColors[]> = {
  midnight: [
    { center: '#363e49', mid: '#1d232b', edge: '#0d1016' },
    { center: '#6d7786', mid: '#2c333d', edge: '#090b0e' },
    { center: '#a7b0c2', mid: '#3c4558', edge: '#141820' },
  ],
  studio: [
    { center: '#ffffff', mid: '#f7f7f5', edge: '#ecece8' },
    { center: '#ffffff', mid: '#e4e3de', edge: '#b7b6b0' },
    { center: '#ffffff', mid: '#d4d0c8', edge: '#8a877f' },
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

export const DEFAULT_GRADIENT: GradientColors = { ...BUILTIN_GRADIENTS.midnight };

const defaultScene = createCompositionScene({
  id: 'scene-main',
  name: 'Scene 1',
  background: 'midnight',
  gradientColors: { ...DEFAULT_GRADIENT },
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
  reflectionMap: 'match_background',
  reflectionMapImage: null,
  rotation: { ...primary.rotation },
  scale: primary.scale,
  lightIntensity: 4.2,
  lightPosition: { x: 4, y: 5, z: 7 },
  lightColor: '#ffffff',
  fillIntensity: 1.6,
  shadowSoftness: 2.5,
  shadowOpacity: 0.32,
  showGroundBase: true,
  edgeBlurTop: false,
  edgeBlurBottom: false,
  edgeBlurAmount: 24,
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
  { id: 'camera.x', label: 'Camera X', unit: '' },
  { id: 'camera.y', label: 'Camera Y', unit: '' },
  { id: 'camera.z', label: 'Camera Z', unit: '' },
];

export const CAMERA_ANIM_PROPERTIES: AnimProperty[] = ['camera.x', 'camera.y', 'camera.z'];

export const DEVICE_ANIM_PROPERTIES: AnimProperty[] = [
  'rotation.x', 'rotation.y', 'rotation.z',
  'position.x', 'position.y', 'position.z',
  'scale',
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

export function switchCompositionScene(project: MockupProject, sceneId: string): MockupProject {
  const scenes = ensureCompositionScenes(project);
  if (!scenes.some((scene) => scene.id === sceneId)) return syncProjectFromActiveScene(project);
  return syncProjectFromActiveScene({ ...project, scenes, activeSceneId: sceneId });
}

export function addCompositionScene(project: MockupProject, fromActive = true): MockupProject {
  const scenes = ensureCompositionScenes(project);
  if (scenes.length >= MAX_COMPOSITION_SCENES) return syncProjectFromActiveScene(project);
  const active = scenes.find((scene) => scene.id === project.activeSceneId) ?? scenes[0];
  const next = createCompositionScene(
    fromActive
      ? {
        name: nextSceneName(scenes),
        background: active.background,
        gradientColors: active.gradientColors,
      }
      : { name: nextSceneName(scenes) },
  );
  return syncProjectFromActiveScene({
    ...project,
    scenes: [...scenes, next],
    activeSceneId: next.id,
  });
}

export function duplicateCompositionScene(project: MockupProject, sceneId?: string): MockupProject {
  const scenes = ensureCompositionScenes(project);
  if (scenes.length >= MAX_COMPOSITION_SCENES) return syncProjectFromActiveScene(project);
  const source = scenes.find((scene) => scene.id === (sceneId || project.activeSceneId)) ?? scenes[0];
  const copy = createCompositionScene({
    name: `${source.name.replace(/\s+copy$/i, '')} copy`.slice(0, 40),
    background: source.background,
    gradientColors: source.gradientColors,
  });
  const index = scenes.findIndex((scene) => scene.id === source.id);
  const nextScenes = [...scenes.slice(0, index + 1), copy, ...scenes.slice(index + 1)];
  return syncProjectFromActiveScene({
    ...project,
    scenes: nextScenes.slice(0, MAX_COMPOSITION_SCENES),
    activeSceneId: copy.id,
  });
}

export function removeCompositionScene(project: MockupProject, sceneId: string): MockupProject {
  const scenes = ensureCompositionScenes(project);
  if (scenes.length <= 1) return syncProjectFromActiveScene(project);
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return syncProjectFromActiveScene(project);
  const nextScenes = scenes.filter((scene) => scene.id !== sceneId);
  const fallback = nextScenes[Math.max(0, index - 1)] ?? nextScenes[0];
  const activeSceneId = project.activeSceneId === sceneId ? fallback.id : project.activeSceneId;
  return syncProjectFromActiveScene({ ...project, scenes: nextScenes, activeSceneId });
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
  { id: 'midnight', label: 'Midnight', description: 'Soft blue-charcoal studio', gradient: BUILTIN_GRADIENTS.midnight },
  { id: 'studio', label: 'Soft Studio', description: 'Warm paper cyclorama', gradient: BUILTIN_GRADIENTS.studio },
  { id: 'mint', label: 'Emerald', description: 'Soft green studio', gradient: BUILTIN_GRADIENTS.mint },
  { id: 'sunset', label: 'Sunset', description: 'Soft dusk wash', gradient: BUILTIN_GRADIENTS.sunset },
  { id: 'transparent', label: 'Transparent', description: 'No background', gradient: null },
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
  { id: 'graphite', label: 'Graphite', hex: '#383d42' },
  { id: 'titanium', label: 'Titanium', hex: '#9a9285' },
  { id: 'silver', label: 'Silver', hex: '#c6c9c9' },
  { id: 'rose', label: 'Rose', hex: '#be8f98' },
  { id: 'clay', label: 'Clay', hex: '#d8d2c8' },
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
