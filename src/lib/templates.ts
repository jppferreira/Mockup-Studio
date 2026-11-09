import { applyAnimationPreset, getAnimationPreset } from './animationPresets';
import { placeholderForDevice } from './demo';
import { syncProjectLayers } from './layers';
import {
  getRuntimePromotedTemplates,
  getRuntimeRemovedTemplateIds,
  loadShippedPackTemplates,
  loadShippedRemovedIds,
  mergeShippedTemplates,
} from './shippedTemplates';
import {
  ANDROID_DEVICE_ID, CAMERA_TARGET_ID, DEFAULT_PROJECT, IOS_DEVICE_ID,
  commitActiveScene, createCompositionScene, createDefaultAnimation, createDeviceInstance, createSceneLight,
  createSceneProp, syncProjectFromSelected,
  type AnimationClip, type BackgroundPreset, type CameraLens, type CameraView, type DeviceColor,
  type DeviceInstance, type GradientColors, type MaterialTweak, type MockupProject, type ReflectionMapId,
  type SceneLight, type SceneProp, type ShadowQuality, type ShadowType, type Vec3,
} from '../types';
import type { SceneOverlay } from './overlays';
import { normalizeReflectionStyle, type ReflectionStyle } from './reflectionStyle';
import { getDevice, type DeviceId } from './devices';

export type TemplateCategory = 'devices' | 'scenes' | 'saved';

/**
 * Soft white cyclorama — Apple product-studio falloff so depth of field
 * has wall / cove / floor stops to read against the sharp subject.
 */
export const TEMPLATE_BACKDROP: GradientColors = {
  center: '#ffffff',
  mid: '#f4f4f6',
  edge: '#e6e6ea',
};

/** Default shallow DoF for every shipped / applied composition. */
export const TEMPLATE_DEPTH_OF_FIELD_AMOUNT = 0.48;

/**
 * Subtle progressive soft floor — shared by every new project, composition,
 * and shipped template unless a saved composition stores its own values.
 */
export const TEMPLATE_SHADOW = {
  shadowOpacity: DEFAULT_PROJECT.shadowOpacity,
  shadowSoftness: DEFAULT_PROJECT.shadowSoftness,
  shadowType: DEFAULT_PROJECT.shadowType,
  shadowContact: DEFAULT_PROJECT.shadowContact,
  shadowContactEnabled: DEFAULT_PROJECT.shadowContactEnabled,
  shadowDistance: DEFAULT_PROJECT.shadowDistance,
  shadowColor: DEFAULT_PROJECT.shadowColor,
  ambientOcclusion: DEFAULT_PROJECT.ambientOcclusion,
  shadowQuality: DEFAULT_PROJECT.shadowQuality,
} as const;

export interface CompositionTemplate {
  id: string;
  label: string;
  description: string;
  /** Short badge shown on the card, e.g. "1 device" */
  badge: string;
  category: TemplateCategory;
  /** CSS thumbnail layout hint */
  preview: 'solo' | 'pair' | 'trio' | 'fan' | 'depth' | 'split' | 'stack'
    | 'clay' | 'concrete' | 'pedestal' | 'desk' | 'studio' | 'rocks' | 'stage';
  background: BackgroundPreset;
  gradient?: GradientColors;
  compositionMode: MockupProject['compositionMode'];
  devices: Array<{
    deviceId: DeviceId;
    rotation?: DeviceInstance['rotation'];
    position?: DeviceInstance['position'];
    scale?: number;
  }>;
  sceneProps?: Array<Omit<SceneProp, 'id'> & { id?: string }>;
  lightIntensity?: number;
  fillIntensity?: number;
  shadowOpacity?: number;
  shadowSoftness?: number;
  shadowType?: ShadowType;
  shadowContact?: number;
  shadowContactEnabled?: boolean;
  shadowDistance?: number;
  shadowColor?: string;
  ambientOcclusion?: number;
  shadowQuality?: ShadowQuality;
  /** Extra luminaires for realistic / Spline-like setups */
  sceneLights?: SceneLight[];
  /** HDRI strength override; omit to keep the studio preset */
  environmentIntensity?: number | null;
  /** ACES exposure override; omit to keep the studio preset */
  toneMappingExposure?: number | null;
  /** Soft ground disc under devices; omit/true keeps the default plate. */
  showGroundBase?: boolean;
  /** Motion preset applied from each device’s studio angle. `clear` leaves the shot still. */
  motion?: string;
  /** Saved compositions keep the split link instead of inferring it from rotation. */
  linkSplitTransform?: boolean;
  cameraView?: CameraView;
  cameraLens?: CameraLens;
  /** Free-orbit pose (offset from framed device). Omitted = default view framing. */
  cameraOrbit?: { offset: Vec3; lookOffset?: Vec3 };
  lightPosition?: Vec3;
  lightColor?: string;
  /** Glass environment. Omitted compositions keep the project default. */
  reflectionMap?: ReflectionMapId;
  edgeBlurTop?: boolean;
  edgeBlurBottom?: boolean;
  edgeBlurAmount?: number;
  depthOfField?: boolean;
  depthOfFieldAmount?: number;
  deviceExtras?: Array<{
    glassReflection?: number;
    reflectionStyle?: ReflectionStyle;
    lidOpen?: number;
    deviceColor?: DeviceColor;
    clayMode?: boolean;
    materialTweaks?: Record<string, MaterialTweak>;
    hiddenMeshes?: string[];
  }>;
  overlays?: SceneOverlay[];
  /** Tracks target `slot-0`… and `__camera__`. Present on user-saved compositions. */
  animation?: AnimationClip;
}

export const COMPOSITION_TEMPLATES: CompositionTemplate[] = [
  {
    id: 'solo-hero',
    label: 'Solo Hero',
    description: 'Three-quarter hero with a turntable',
    badge: 'Turntable',
    category: 'devices',
    preview: 'solo',
    background: 'studio',
    compositionMode: 'single',
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: -8, y: 22, z: 0 },
      position: { x: 0, y: 0.06, z: 0 },
      scale: 1,
    }],
  },
  {
    id: 'product-rotate',
    label: 'Product Rotate',
    description: 'One device, one scene, soft turntable spin',
    badge: 'Turntable',
    category: 'devices',
    preview: 'solo',
    background: 'studio',
    compositionMode: 'single',
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: -8, y: 22, z: 0 },
      position: { x: 0, y: 0.06, z: 0 },
      scale: 1,
    }],
  },
  {
    id: 'ios-android',
    label: 'iOS + Android',
    description: 'Mirrored three-quarter pair, turntable on each',
    badge: 'Turntable',
    category: 'devices',
    preview: 'split',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'split',
    motion: 'turntable',
    devices: [
      {
        deviceId: IOS_DEVICE_ID,
        rotation: { x: -10, y: -24, z: 0 },
        position: { x: 0, y: 0.04, z: 0 },
        scale: 0.9,
      },
      {
        deviceId: ANDROID_DEVICE_ID,
        rotation: { x: -10, y: 24, z: 0 },
        position: { x: 0, y: 0.04, z: 0 },
        scale: 0.9,
      },
    ],
  },
  {
    id: 'duo-stack',
    label: 'Duo Stack',
    description: 'Overlapping three-quarters with an orbit',
    badge: 'Orbit',
    category: 'devices',
    preview: 'stack',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    motion: 'orbit',
    devices: [
      {
        deviceId: 'iphone_16_pro_max',
        rotation: { x: -6, y: -28, z: -4 },
        position: { x: -0.55, y: 0.05, z: -0.2 },
        scale: 0.92,
      },
      {
        deviceId: 'iphone_17_pro',
        rotation: { x: -14, y: 22, z: 3 },
        position: { x: 0.7, y: -0.02, z: 0.15 },
        scale: 0.88,
      },
    ],
  },
  {
    id: 'triple-fan',
    label: 'Triple Fan',
    description: 'Fanned three-quarters with a card sweep',
    badge: 'Fan',
    category: 'devices',
    preview: 'fan',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    motion: 'fan',
    devices: [
      {
        deviceId: 'iphone_15_pro_max',
        rotation: { x: -4, y: 16, z: -14 },
        position: { x: -1.55, y: 0.05, z: -0.15 },
        scale: 0.78,
      },
      {
        deviceId: 'iphone_16_pro_max',
        rotation: { x: -8, y: 4, z: 0 },
        position: { x: 0, y: 0.1, z: 0.2 },
        scale: 0.86,
      },
      {
        deviceId: 'galaxy_s26_ultra',
        rotation: { x: -4, y: -18, z: 14 },
        position: { x: 1.55, y: 0.05, z: -0.15 },
        scale: 0.78,
      },
    ],
  },
  {
    id: 'portrait-parade',
    label: 'Portrait Parade',
    description: 'Toed-in lineup with a shared turntable',
    badge: 'Turntable',
    category: 'devices',
    preview: 'trio',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    motion: 'turntable',
    devices: [
      {
        deviceId: 'pixel_9_pro',
        rotation: { x: -6, y: 18, z: 0 },
        position: { x: -1.7, y: 0, z: 0 },
        scale: 0.72,
      },
      {
        deviceId: 'iphone_17_pro_max',
        rotation: { x: -10, y: 0, z: 0 },
        position: { x: 0, y: 0.05, z: 0.1 },
        scale: 0.8,
      },
      {
        deviceId: 'galaxy_s26_ultra',
        rotation: { x: -6, y: -18, z: 0 },
        position: { x: 1.7, y: 0, z: 0 },
        scale: 0.72,
      },
    ],
  },
  {
    id: 'depth-stage',
    label: 'Depth Stage',
    description: 'Hero up front, wings in orbit',
    badge: 'Orbit',
    category: 'devices',
    preview: 'depth',
    background: 'studio',
    compositionMode: 'single',
    motion: 'orbit',
    devices: [
      {
        deviceId: 'iphone_15_pro_max',
        rotation: { x: -4, y: 28, z: -6 },
        position: { x: -1.4, y: 0.15, z: -0.85 },
        scale: 0.7,
      },
      {
        deviceId: 'iphone_17_pro',
        rotation: { x: -12, y: -16, z: 2 },
        position: { x: 0.15, y: 0.04, z: 0.35 },
        scale: 0.95,
      },
      {
        deviceId: 'pixel_10_pro',
        rotation: { x: -2, y: -26, z: 8 },
        position: { x: 1.55, y: 0.1, z: -0.55 },
        scale: 0.68,
      },
    ],
  },
  {
    id: 'android-focus',
    label: 'Android Focus',
    description: 'Galaxy hero reveal with a companion behind',
    badge: 'Present',
    category: 'devices',
    preview: 'pair',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    motion: 'present',
    devices: [
      {
        deviceId: 'galaxy_s26_ultra',
        rotation: { x: -10, y: 22, z: 0 },
        position: { x: -0.35, y: 0.04, z: 0.2 },
        scale: 1,
      },
      {
        deviceId: 'pixel_9_pro_xl',
        rotation: { x: -4, y: -30, z: 6 },
        position: { x: 1.45, y: 0.05, z: -0.35 },
        scale: 0.78,
      },
    ],
  },
  {
    id: 'blank',
    label: 'Blank Canvas',
    description: 'Front angle, no motion — build your own',
    badge: 'Still',
    category: 'devices',
    preview: 'solo',
    background: 'studio',
    compositionMode: 'single',
    motion: 'clear',
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: 0, y: 0, z: 0 },
      position: { x: 0, y: 0, z: 0 },
      scale: 1,
    }],
  },

  // —— Scenic pre-compositions ——
  // Original studio geometry (stone plinth, metal disc). Free to ship; no paid packs.
  {
    id: 'obsidian-plinth',
    label: 'Obsidian Plinth',
    description: 'Hero on honed stone, softbox glass',
    badge: 'Turntable',
    category: 'scenes',
    preview: 'pedestal',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 1.15,
    fillIntensity: 0.38,
    showGroundBase: false,
    lightPosition: { x: -3.4, y: 6.2, z: 4.4 },
    lightColor: '#f6f1e8',
    reflectionMap: 'softbox',
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_17_pro_max',
      rotation: { x: -8, y: 24, z: 0 },
      position: { x: 0, y: 0.32, z: 0.04 },
      scale: 0.84,
    }],
    deviceExtras: [{ glassReflection: 0.78, deviceColor: 'titanium' }],
    sceneProps: [
      { id: 'plinth', kind: 'stone_plinth', position: { x: 0, y: -1.28, z: 0 }, rotation: { x: 0, y: 16, z: 0 }, scale: 1, color: '#6e6a62' },
      { id: 'ring', kind: 'metal_disc', position: { x: 1.42, y: -1.22, z: 0.15 }, rotation: { x: 78, y: 24, z: 8 }, scale: 0.38, color: '#c5ccd4' },
    ],
  },
  {
    id: 'ivory-laptop',
    label: 'Ivory Laptop',
    description: 'Open MacBook on a white cyclorama',
    badge: 'Float',
    category: 'scenes',
    preview: 'studio',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.86,
    fillIntensity: 1.05,
    showGroundBase: false,
    lightPosition: { x: 2.4, y: 5.6, z: 5.2 },
    lightColor: '#fff8f0',
    reflectionMap: 'studio',
    motion: 'float',
    devices: [{
      deviceId: 'macbook_air_13_2023',
      rotation: { x: -8, y: 32, z: 0 },
      position: { x: 0.05, y: -0.05, z: 0.15 },
      scale: 0.9,
    }],
    deviceExtras: [{ lidOpen: 0.72, deviceColor: 'silver', glassReflection: 0.42 }],
    sceneProps: [
      { id: 'cyclorama', kind: 'studio_backdrop', position: { x: 0, y: -1.55, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, color: '#ffffff' },
    ],
  },
  {
    id: 'chrome-floor',
    label: 'Chrome Floor',
    description: 'Phone on a brushed disc, city reflections',
    badge: 'Turntable',
    category: 'scenes',
    preview: 'stage',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 1.01,
    fillIntensity: 0.45,
    showGroundBase: false,
    lightPosition: { x: 4.2, y: 5.4, z: 3.2 },
    lightColor: '#fff4e4',
    reflectionMap: 'city',
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -6, y: 18, z: 0 },
      position: { x: 0, y: 0.12, z: 0.05 },
      scale: 0.9,
    }],
    deviceExtras: [{ glassReflection: 0.9, deviceColor: 'silver' }],
    sceneProps: [
      { id: 'disc', kind: 'metal_disc', position: { x: 0, y: -1.5, z: 0.05 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.15, y: 1, z: 1.15 }, color: '#d5d8de' },
    ],
  },
  {
    id: 'watch-still',
    label: 'Watch Still',
    description: 'Watch on pale honed stone',
    badge: 'Still',
    category: 'scenes',
    preview: 'pedestal',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.97,
    fillIntensity: 0.7,
    showGroundBase: false,
    lightPosition: { x: -2.2, y: 5.8, z: 4.8 },
    lightColor: '#fff6ea',
    reflectionMap: 'softbox',
    motion: 'clear',
    devices: [{
      deviceId: 'apple_watch_ultra_2',
      rotation: { x: -18, y: 28, z: 6 },
      position: { x: 0, y: 0.35, z: 0.08 },
      scale: 1.05,
    }],
    deviceExtras: [{ deviceColor: 'titanium', glassReflection: 0.55 }],
    sceneProps: [
      { id: 'plinth', kind: 'stone_plinth', position: { x: 0, y: -1.22, z: 0 }, rotation: { x: 0, y: -12, z: 0 }, scale: 0.72, color: '#e4ddd2' },
    ],
  },
  {
    id: 'headphone-drift',
    label: 'Headphone Drift',
    description: 'Floating headphones on a dark stage',
    badge: 'Orbit',
    category: 'scenes',
    preview: 'solo',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.94,
    fillIntensity: 0.35,
    showGroundBase: false,
    cameraLens: 'standard',
    lightPosition: { x: 3.6, y: 4.2, z: 5 },
    lightColor: '#e7eef8',
    reflectionMap: 'city',
    edgeBlurTop: true,
    edgeBlurBottom: true,
    edgeBlurAmount: 16,
    motion: 'orbit',
    devices: [{
      deviceId: 'jbl_tour_one_m3',
      rotation: { x: -12, y: 36, z: -8 },
      position: { x: 0.1, y: 0.15, z: 0 },
      scale: 1.05,
    }],
    deviceExtras: [{ deviceColor: 'graphite', glassReflection: 0.35 }],
  },
  {
    id: 'vision-bay',
    label: 'Vision Bay',
    description: 'Spatial headset on a dark stage',
    badge: 'Present',
    category: 'scenes',
    preview: 'stage',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 1.04,
    fillIntensity: 0.4,
    showGroundBase: false,
    lightPosition: { x: -2.8, y: 5.5, z: 4.6 },
    lightColor: '#f3f0ea',
    reflectionMap: 'studio',
    motion: 'present',
    devices: [{
      deviceId: 'apple_vision_pro',
      rotation: { x: -6, y: 22, z: 0 },
      position: { x: 0, y: 0.22, z: 0.02 },
      scale: 0.92,
    }],
    deviceExtras: [{ deviceColor: 'silver', glassReflection: 0.66 }],
    sceneProps: [
      { id: 'stage', kind: 'stage', position: { x: 0, y: -1.55, z: 0.02 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.92, color: '#1c1e22' },
    ],
  },
  {
    id: 'launch-pair',
    label: 'Launch Pair',
    description: 'Two phones on pale stone, shared orbit',
    badge: 'Orbit',
    category: 'scenes',
    preview: 'desk',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.9,
    fillIntensity: 0.85,
    showGroundBase: false,
    cameraLens: 'standard',
    lightPosition: { x: -1.5, y: 6.4, z: 5.5 },
    lightColor: '#fff8f1',
    reflectionMap: 'softbox',
    motion: 'orbit',
    devices: [
      {
        deviceId: 'iphone_17_pro',
        rotation: { x: -8, y: -18, z: -2 },
        position: { x: -0.72, y: 0.08, z: 0.12 },
        scale: 0.78,
      },
      {
        deviceId: 'iphone_16_pro_max',
        rotation: { x: -10, y: 20, z: 2 },
        position: { x: 0.72, y: 0.04, z: 0.02 },
        scale: 0.78,
      },
    ],
    deviceExtras: [
      { deviceColor: 'titanium', glassReflection: 0.6 },
      { deviceColor: 'silver', glassReflection: 0.6 },
    ],
    sceneProps: [
      { id: 'plinth', kind: 'stone_plinth', position: { x: 0, y: -1.48, z: 0.05 }, rotation: { x: 0, y: 8, z: 0 }, scale: { x: 1.55, y: 0.42, z: 1.05 }, color: '#efe8de' },
    ],
  },
  {
    id: 'clay-desk',
    label: 'Clay Desk',
    description: 'Leaning phone among clay, gentle float',
    badge: 'Float',
    category: 'scenes',
    preview: 'clay',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.79,
    fillIntensity: 0.95,
    motion: 'float',
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -14, y: 18, z: 3 },
      position: { x: 0.15, y: -0.12, z: 0.35 },
      scale: 0.92,
    }],
    sceneProps: [
      { id: 'slab', kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0.2 }, rotation: { x: 0, y: 8, z: 0 }, scale: { x: 0.85, y: 1, z: 0.7 }, color: undefined },
      { id: 'sphere-a', kind: 'clay_sphere', position: { x: -1.15, y: -1.05, z: 0.55 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.85, color: '#e8d5c4' },
      { id: 'cube-a', kind: 'clay_cube', position: { x: 1.25, y: -1.15, z: 0.15 }, rotation: { x: 8, y: 28, z: 6 }, scale: 0.55, color: '#c9b8a8' },
      { id: 'torus-a', kind: 'clay_torus', position: { x: -0.55, y: -1.2, z: -0.35 }, rotation: { x: 18, y: -12, z: 0 }, scale: 0.7, color: '#d4c2b0' },
      { id: 'cyl-a', kind: 'clay_cylinder', position: { x: 0.95, y: -1.05, z: -0.55 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.55, color: '#b89f8c' },
    ],
  },
  {
    id: 'concrete-lean',
    label: 'Concrete Wall',
    description: 'Reclined against the wall, slow tilt',
    badge: 'Tilt',
    category: 'scenes',
    preview: 'concrete',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.94,
    fillIntensity: 0.65,
    motion: 'tilt',
    devices: [{
      deviceId: 'iphone_17_pro',
      rotation: { x: -20, y: 14, z: 0 },
      position: { x: -0.15, y: -0.16, z: 0.55 },
      scale: 0.95,
    }],
    sceneProps: [
      { id: 'wall', kind: 'concrete_wall', position: { x: 0.1, y: -1.55, z: -0.85 }, rotation: { x: 0, y: -12, z: 0 }, scale: 1 },
      { id: 'slab', kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0.4 }, rotation: { x: 0, y: -8, z: 0 }, scale: { x: 0.9, y: 1, z: 0.75 } },
      { id: 'sphere', kind: 'clay_sphere', position: { x: 1.35, y: -1.15, z: 0.7 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.55, color: '#d2c4b5' },
    ],
  },
  {
    id: 'pedestal-stage',
    label: 'Pedestal Stage',
    description: 'Hero angle on a plinth, turntable',
    badge: 'Turntable',
    category: 'scenes',
    preview: 'pedestal',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 1.01,
    fillIntensity: 0.55,
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: -8, y: 24, z: 0 },
      position: { x: 0, y: 0.58, z: 0.1 },
      scale: 0.88,
    }],
    sceneProps: [
      { id: 'slab', kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.95 },
      { id: 'pedestal', kind: 'pedestal', position: { x: 0, y: -1.45, z: 0 }, rotation: { x: 0, y: 12, z: 0 }, scale: 1 },
      { id: 'torus', kind: 'clay_torus', position: { x: -1.35, y: -1.15, z: 0.45 }, rotation: { x: 65, y: 20, z: 0 }, scale: 0.75, color: '#c4b5a5' },
      { id: 'cube', kind: 'clay_cube', position: { x: 1.4, y: -1.2, z: -0.2 }, rotation: { x: 12, y: -25, z: 8 }, scale: 0.45, color: '#a89482' },
    ],
  },
  {
    id: 'soft-geometry',
    label: 'Soft Geometry',
    description: 'Two three-quarters framed by clay, orbit',
    badge: 'Orbit',
    category: 'scenes',
    preview: 'desk',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.86,
    fillIntensity: 0.8,
    motion: 'orbit',
    devices: [
      {
        deviceId: 'iphone_17_pro_max',
        rotation: { x: -8, y: 20, z: -3 },
        position: { x: -0.55, y: -0.08, z: 0.4 },
        scale: 0.82,
      },
      {
        deviceId: 'galaxy_s26_ultra',
        rotation: { x: -12, y: -26, z: 4 },
        position: { x: 0.85, y: -0.04, z: 0.15 },
        scale: 0.78,
      },
    ],
    sceneProps: [
      { id: 'slab', kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0.15 }, rotation: { x: 0, y: 5, z: 0 }, scale: { x: 0.95, y: 1, z: 0.8 } },
      { id: 'sphere-lg', kind: 'clay_sphere', position: { x: -1.55, y: -0.75, z: -0.4 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1.15, color: '#d9cfc0' },
      { id: 'cyl', kind: 'clay_cylinder', position: { x: 1.55, y: -0.95, z: -0.55 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.85, color: '#b8a898' },
      { id: 'torus', kind: 'clay_torus', position: { x: 0.15, y: -1.25, z: -0.7 }, rotation: { x: 10, y: 0, z: 0 }, scale: 0.9, color: '#cfc3b4' },
    ],
  },
  {
    id: 'brutalist-nook',
    label: 'Brutalist Nook',
    description: 'Tucked three-quarter with a float',
    badge: 'Float',
    category: 'scenes',
    preview: 'concrete',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.9,
    fillIntensity: 0.7,
    motion: 'float',
    devices: [{
      deviceId: 'pixel_9_pro',
      rotation: { x: -14, y: -16, z: 3 },
      position: { x: 0.35, y: -0.2, z: 0.45 },
      scale: 0.9,
    }],
    sceneProps: [
      { id: 'wall-back', kind: 'concrete_wall', position: { x: -0.4, y: -1.55, z: -1.0 }, rotation: { x: 0, y: 18, z: 0 }, scale: { x: 0.85, y: 1, z: 1 } },
      { id: 'wall-side', kind: 'concrete_wall', position: { x: -1.55, y: -1.55, z: 0.1 }, rotation: { x: 0, y: 95, z: 0 }, scale: { x: 0.7, y: 1, z: 1 } },
      { id: 'slab', kind: 'concrete_slab', position: { x: 0.1, y: -1.58, z: 0.35 }, rotation: { x: 0, y: 12, z: 0 }, scale: { x: 0.8, y: 1, z: 0.7 } },
      { id: 'cube-a', kind: 'clay_cube', position: { x: 1.2, y: -1.25, z: 0.55 }, rotation: { x: 0, y: 20, z: 0 }, scale: 0.4, color: '#c8b9a8' },
      { id: 'cube-b', kind: 'clay_cube', position: { x: 1.05, y: -0.95, z: 0.35 }, rotation: { x: 5, y: -15, z: 0 }, scale: 0.28, color: '#a9927e' },
    ],
  },
  {
    id: 'clay-pair',
    label: 'Clay Pair',
    description: 'Split three-quarters on clay, floating',
    badge: 'Float',
    category: 'scenes',
    preview: 'clay',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'split',
    lightIntensity: 0.83,
    fillIntensity: 0.85,
    motion: 'float',
    devices: [
      {
        deviceId: IOS_DEVICE_ID,
        rotation: { x: -10, y: -18, z: 0 },
        position: { x: 0, y: 0.02, z: 0.25 },
        scale: 0.85,
      },
      {
        deviceId: ANDROID_DEVICE_ID,
        rotation: { x: -10, y: 18, z: 0 },
        position: { x: 0, y: 0.02, z: 0.25 },
        scale: 0.85,
      },
    ],
    sceneProps: [
      { id: 'slab', kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0.2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.1, y: 1, z: 0.75 } },
      { id: 'sphere-l', kind: 'clay_sphere', position: { x: -1.15, y: -1.15, z: -0.2 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.55, color: '#e0cfc0' },
      { id: 'sphere-r', kind: 'clay_sphere', position: { x: 1.15, y: -1.2, z: 0.1 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.45, color: '#c4b0a0' },
      { id: 'torus', kind: 'clay_torus', position: { x: 0, y: -1.3, z: -0.55 }, rotation: { x: 20, y: 0, z: 0 }, scale: 0.7, color: '#d0bdb0' },
    ],
  },
  {
    id: 'white-studio',
    label: 'White Studio',
    description: 'Floating hero on a white cyclorama',
    badge: 'Float',
    category: 'scenes',
    preview: 'studio',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.94,
    fillIntensity: 1.2,
    motion: 'float',
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -6, y: 14, z: -5 },
      // Lifted slightly so the soft contact shadow reads as floating
      position: { x: 0, y: 0.28, z: 0.45 },
      scale: 0.95,
    }],
    sceneProps: [
      {
        id: 'cyclorama',
        kind: 'studio_backdrop',
        position: { x: 0, y: -1.55, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
        color: '#ffffff',
      },
    ],
  },
  {
    id: 'rock-lean',
    label: 'Rock Lean',
    description: 'Reclined on stones with a slow tilt',
    badge: 'Tilt',
    category: 'scenes',
    preview: 'rocks',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 0.9,
    fillIntensity: 0.62,
    motion: 'tilt',
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -18, y: 12, z: 0 },
      position: { x: 0.02, y: 0.08, z: -0.08 },
      scale: 0.86,
    }],
    sceneProps: [
      { id: 'rock-back', kind: 'rock', position: { x: 0.02, y: -1.55, z: -0.42 }, rotation: { x: -8, y: 24, z: 6 }, scale: 1.28, color: '#7d776e' },
      { id: 'rock-left', kind: 'rock', position: { x: -0.62, y: -1.55, z: -0.05 }, rotation: { x: 10, y: -18, z: -8 }, scale: 0.92, color: '#9a9184' },
      { id: 'rock-right', kind: 'rock', position: { x: 0.68, y: -1.55, z: 0.02 }, rotation: { x: -6, y: 40, z: 12 }, scale: 0.84, color: '#6a645c' },
      { id: 'rock-seat', kind: 'rock', position: { x: 0.08, y: -1.55, z: 0.28 }, rotation: { x: 14, y: -8, z: -4 }, scale: 0.7, color: '#8b8378' },
      { id: 'rock-front', kind: 'rock', position: { x: -0.28, y: -1.55, z: 0.48 }, rotation: { x: 4, y: 60, z: 10 }, scale: 0.42, color: '#a3988a' },
      { id: 'rock-chip', kind: 'rock', position: { x: 0.48, y: -1.55, z: 0.4 }, rotation: { x: -12, y: 15, z: -16 }, scale: 0.34, color: '#5c574f' },
    ],
  },
  {
    id: 'open-stage',
    label: 'Open Stage',
    description: 'Hero angle on an empty stage, turntable',
    badge: 'Turntable',
    category: 'scenes',
    preview: 'stage',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    lightIntensity: 1.01,
    fillIntensity: 0.7,
    motion: 'turntable',
    devices: [{
      deviceId: 'iphone_17_pro',
      rotation: { x: -8, y: 22, z: 0 },
      position: { x: 0, y: 0.1, z: 0.02 },
      scale: 0.9,
    }],
    sceneProps: [
      { id: 'stage', kind: 'stage', position: { x: 0, y: -1.55, z: 0.02 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, color: '#2c2926' },
    ],
  },
];

/**
 * Fill missing studio defaults without wiping authored look.
 * Saved / shipped compositions keep their colours, lighting, and backdrop.
 */
export function withAppleStudioLook(template: CompositionTemplate): CompositionTemplate {
  return {
    ...template,
    background: template.background || 'studio',
    gradient: template.gradient ? { ...template.gradient } : { ...TEMPLATE_BACKDROP },
    depthOfField: template.depthOfField === true,
    depthOfFieldAmount: template.depthOfFieldAmount ?? TEMPLATE_DEPTH_OF_FIELD_AMOUNT,
    sceneProps: template.sceneProps?.map((prop) => (
      prop.kind === 'studio_backdrop'
        ? { ...prop, color: prop.color || '#ffffff' }
        : prop
    )),
  };
}

/** Code defaults plus DEV-promoted pack (`src/data/shippedTemplates.json`) and live session promotions. */
export function listShippedCompositionTemplates(): CompositionTemplate[] {
  const defaults = COMPOSITION_TEMPLATES.map(withAppleStudioLook);
  const fromDisk = mergeShippedTemplates(defaults, loadShippedPackTemplates());
  const merged = mergeShippedTemplates(fromDisk, getRuntimePromotedTemplates())
    .map(withAppleStudioLook);
  const removed = new Set([...loadShippedRemovedIds(), ...getRuntimeRemovedTemplateIds()]);
  if (!removed.size) return merged;
  return merged.filter((item) => !removed.has(item.id));
}

export function getCompositionTemplate(id: string) {
  return listShippedCompositionTemplates().find((item) => item.id === id);
}

/**
 * Builtin / shipped layouts that Dev can overwrite into `shippedTemplates.json`.
 * User-saved `comp-*` templates are personal library only.
 * Any other id can be pushed from Dev so main Devices/Scenes templates stay overridable.
 */
export function isDevEditableTemplateId(id: string | null | undefined): boolean {
  if (!id || id.startsWith('comp-')) return false;
  return true;
}

export function templatesByCategory(category: TemplateCategory) {
  if (category === 'saved') return [];
  return listShippedCompositionTemplates().filter((item) => item.category === category);
}

function remapStoredAnimation(clip: AnimationClip, devices: DeviceInstance[]): AnimationClip {
  const idBySlot = new Map(devices.map((device, index) => [`slot-${index}`, device.id]));
  return {
    duration: clip.duration,
    fps: clip.fps,
    loop: clip.loop,
    tracks: clip.tracks.flatMap((track) => {
      const targetId = track.targetId === CAMERA_TARGET_ID
        ? CAMERA_TARGET_ID
        : idBySlot.get(track.targetId);
      if (!targetId) return [];
      return [{
        ...track,
        id: `track-${targetId}-${track.property}-${Math.random().toString(36).slice(2, 6)}`,
        targetId,
        keyframes: track.keyframes.map((frame) => ({
          ...frame,
          id: `kf-${Math.random().toString(36).slice(2, 9)}`,
        })),
      }];
    }),
  };
}

/** Build a full project from a composition template. */
export function projectFromTemplate(
  template: CompositionTemplate,
  options?: { name?: string; screenshot?: string | null },
): MockupProject {
  const sharedShot = options?.screenshot === undefined
    ? null
    : options.screenshot;
  const devices = template.devices.map((entry, index) => {
    const shot = sharedShot !== null
      ? sharedShot
      : (template.compositionMode === 'split'
        ? placeholderForDevice(entry.deviceId)
        : (index === 0 ? placeholderForDevice(entry.deviceId) : null));
    const extra = template.deviceExtras?.[index];
    return createDeviceInstance({
      id: index === 0
        ? (template.compositionMode === 'split' ? 'device-ios' : 'device-main')
        : (template.compositionMode === 'split' && index === 1 ? 'device-android' : `device-${index + 1}`),
      deviceId: entry.deviceId,
      rotation: entry.rotation ? { ...entry.rotation } : undefined,
      position: entry.position ? { ...entry.position } : undefined,
      scale: entry.scale,
      screenshot: shot ?? placeholderForDevice(entry.deviceId),
      glassReflection: extra?.glassReflection,
      reflectionStyle: extra?.reflectionStyle,
      lidOpen: extra?.lidOpen,
      deviceColor: extra?.deviceColor,
      clayMode: extra?.clayMode,
      materialTweaks: extra?.materialTweaks
        ? Object.fromEntries(
          Object.entries(extra.materialTweaks).map(([name, tweak]) => [name, { ...tweak }]),
        )
        : undefined,
      hiddenMeshes: extra?.hiddenMeshes?.length ? [...extra.hiddenMeshes] : undefined,
    });
  });
  const primary = devices[0];
  const gradient = template.gradient
    ? { ...template.gradient }
    : { ...TEMPLATE_BACKDROP };
  const background = template.background || 'studio';

  const sceneProps = (template.sceneProps ?? []).map((entry, index) => createSceneProp({
    ...entry,
    id: entry.id ?? `prop-${index + 1}`,
    position: entry.position ? { ...entry.position } : undefined,
    rotation: entry.rotation ? { ...entry.rotation } : undefined,
    scale: typeof entry.scale === 'number'
      ? entry.scale
      : entry.scale
        ? { ...entry.scale }
        : undefined,
    color: entry.kind === 'studio_backdrop'
      ? (entry.color || '#ffffff')
      : entry.color,
  }));

  const scene = createCompositionScene({
    id: 'scene-main',
    name: 'Scene 1',
    background,
    gradientColors: gradient,
  });

  const primaryShot = primary.screenshot ?? placeholderForDevice(primary.deviceId);

  return commitActiveScene({
    ...DEFAULT_PROJECT,
    name: options?.name ?? template.label,
    deviceColor: template.deviceExtras?.[0]?.deviceColor ?? DEFAULT_PROJECT.deviceColor,
    clayMode: template.deviceExtras?.[0]?.clayMode ?? template.deviceExtras?.[0]?.deviceColor === 'clay',
    screenshot: primaryShot,
    deviceId: primary.deviceId,
    publishTarget: getDevice(primary.deviceId).platform,
    linkSplitTransform: typeof template.linkSplitTransform === 'boolean'
      ? template.linkSplitTransform
      : !(
        template.compositionMode === 'split'
        && devices.some((device) => (
          device.rotation.x !== devices[0].rotation.x
          || device.rotation.y !== devices[0].rotation.y
          || device.rotation.z !== devices[0].rotation.z
        ))
      ),
    scenes: [scene],
    activeSceneId: scene.id,
    background: scene.background,
    gradientColors: { ...scene.gradientColors },
    rotation: { ...primary.rotation },
    scale: primary.scale,
    lightIntensity: template.lightIntensity ?? DEFAULT_PROJECT.lightIntensity,
    fillIntensity: template.fillIntensity ?? DEFAULT_PROJECT.fillIntensity,
    shadowOpacity: template.shadowOpacity ?? TEMPLATE_SHADOW.shadowOpacity,
    shadowSoftness: template.shadowSoftness ?? TEMPLATE_SHADOW.shadowSoftness,
    shadowType: template.shadowType ?? TEMPLATE_SHADOW.shadowType,
    shadowContact: template.shadowContact ?? TEMPLATE_SHADOW.shadowContact,
    shadowContactEnabled: template.shadowContactEnabled ?? TEMPLATE_SHADOW.shadowContactEnabled,
    shadowDistance: template.shadowDistance ?? TEMPLATE_SHADOW.shadowDistance,
    shadowColor: template.shadowColor ?? TEMPLATE_SHADOW.shadowColor,
    ambientOcclusion: template.ambientOcclusion ?? TEMPLATE_SHADOW.ambientOcclusion,
    shadowQuality: template.shadowQuality ?? TEMPLATE_SHADOW.shadowQuality,
    showGroundBase: template.showGroundBase !== false,
    sceneLights: (template.sceneLights ?? []).map((light) => createSceneLight(light)),
    environmentIntensity: template.environmentIntensity ?? null,
    toneMappingExposure: template.toneMappingExposure ?? null,
    compositionMode: template.compositionMode,
    devices,
    selectedDeviceId: primary.id,
    sceneProps,
    animation: template.animation
      ? remapStoredAnimation(template.animation, devices)
      : animationForTemplate(devices, template.motion),
    ...(template.cameraView ? { cameraView: template.cameraView } : {}),
    ...(template.cameraLens ? { cameraLens: template.cameraLens } : {}),
    ...(template.lightPosition ? { lightPosition: { ...template.lightPosition } } : {}),
    ...(template.lightColor ? { lightColor: template.lightColor } : {}),
    ...(template.reflectionMap ? { reflectionMap: template.reflectionMap } : {}),
    ...(template.edgeBlurTop != null ? { edgeBlurTop: template.edgeBlurTop } : {}),
    ...(template.edgeBlurBottom != null ? { edgeBlurBottom: template.edgeBlurBottom } : {}),
    ...(template.edgeBlurAmount != null ? { edgeBlurAmount: template.edgeBlurAmount } : {}),
    // DoF only when the composition explicitly enables it.
    depthOfField: template.depthOfField === true,
    depthOfFieldAmount: template.depthOfFieldAmount ?? TEMPLATE_DEPTH_OF_FIELD_AMOUNT,
    ...(template.overlays ? {
      overlays: template.overlays.map((overlay) => ({
        ...overlay,
        id: `overlay-${Math.random().toString(36).slice(2, 10)}`,
        imageData: null,
      })),
    } : {}),
  });
}

/**
 * Restage the current shot with a composition’s set, light, and pose.
 * By default device models, screens, and finishes stay on the phones already
 * in the scene. Pass `replaceDevices` in Dev to override those models from
 * the template (screens / material tweaks on matching slots are kept).
 */
export function applyCompositionKeepingDevices(
  project: MockupProject,
  template: CompositionTemplate,
  options?: { replaceDevices?: boolean },
): MockupProject {
  const slots = template.devices;
  const replaceDevices = options?.replaceDevices === true;
  const count = replaceDevices ? Math.max(project.devices.length, slots.length) : project.devices.length;
  const fan = slots.length <= 1 && count > 1;
  const devices = Array.from({ length: count }, (_, index) => {
    const previous = project.devices[index] ?? project.devices[project.devices.length - 1];
    const slot = slots[Math.min(index, Math.max(0, slots.length - 1))];
    if (!slot) return previous;
    const spread = fan ? (index - (count - 1) / 2) * 0.85 : 0;
    const extra = template.deviceExtras?.[Math.min(index, Math.max(0, (template.deviceExtras?.length ?? 1) - 1))];
    const base = previous ?? createDeviceInstance({
      id: index === 0 ? 'device-main' : `device-${index + 1}`,
      deviceId: slot.deviceId,
      screenshot: null,
    });
    return {
      ...base,
      id: previous?.id ?? base.id,
      deviceId: replaceDevices ? slot.deviceId : base.deviceId,
      rotation: slot.rotation ? { ...slot.rotation } : base.rotation,
      scale: slot.scale ?? base.scale,
      position: slot.position
        ? { x: slot.position.x + spread, y: slot.position.y, z: slot.position.z }
        : base.position,
      ...(replaceDevices && extra ? {
        glassReflection: extra.glassReflection ?? base.glassReflection,
        reflectionStyle: extra.reflectionStyle ?? base.reflectionStyle,
        lidOpen: extra.lidOpen ?? base.lidOpen,
        deviceColor: extra.deviceColor ?? base.deviceColor,
        clayMode: extra.clayMode ?? base.clayMode,
        materialTweaks: extra.materialTweaks
          ? Object.fromEntries(
            Object.entries(extra.materialTweaks).map(([name, tweak]) => [name, { ...tweak }]),
          )
          : base.materialTweaks,
        hiddenMeshes: extra.hiddenMeshes?.length ? [...extra.hiddenMeshes] : base.hiddenMeshes,
      } : {}),
    };
  });
  const selected = devices.find((device) => device.id === project.selectedDeviceId) ?? devices[0];
  if (!selected) return project;
  const gradient = template.gradient
    ? { ...template.gradient }
    : { ...TEMPLATE_BACKDROP };
  const sceneProps = (template.sceneProps ?? []).map((entry, index) => createSceneProp({
    ...entry,
    id: entry.id ?? `prop-${index + 1}`,
    position: entry.position ? { ...entry.position } : undefined,
    rotation: entry.rotation ? { ...entry.rotation } : undefined,
    scale: typeof entry.scale === 'number'
      ? entry.scale
      : entry.scale
        ? { ...entry.scale }
        : undefined,
    color: entry.kind === 'studio_backdrop'
      ? (entry.color || '#ffffff')
      : entry.color,
  }));
  const motion = template.motion ? getAnimationPreset(template.motion) : undefined;
  const animation = motion
    ? applyAnimationPreset(project.animation, devices, motion)
    : project.animation;

  return syncProjectLayers(syncProjectFromSelected({
    ...project,
    background: template.background || project.background || 'studio',
    gradientColors: gradient,
    devices,
    sceneProps,
    animation,
    lightIntensity: template.lightIntensity ?? project.lightIntensity,
    fillIntensity: template.fillIntensity ?? project.fillIntensity,
    // Prefer the composition’s stored shadows; fall back to the soft studio floor.
    shadowOpacity: template.shadowOpacity ?? TEMPLATE_SHADOW.shadowOpacity,
    shadowSoftness: template.shadowSoftness ?? TEMPLATE_SHADOW.shadowSoftness,
    shadowType: template.shadowType ?? TEMPLATE_SHADOW.shadowType,
    shadowContact: template.shadowContact ?? TEMPLATE_SHADOW.shadowContact,
    shadowContactEnabled: template.shadowContactEnabled ?? TEMPLATE_SHADOW.shadowContactEnabled,
    shadowDistance: template.shadowDistance ?? TEMPLATE_SHADOW.shadowDistance,
    shadowColor: template.shadowColor ?? TEMPLATE_SHADOW.shadowColor,
    ambientOcclusion: template.ambientOcclusion ?? TEMPLATE_SHADOW.ambientOcclusion,
    shadowQuality: template.shadowQuality ?? TEMPLATE_SHADOW.shadowQuality,
    showGroundBase: template.showGroundBase ?? project.showGroundBase,
    lightPosition: template.lightPosition ? { ...template.lightPosition } : project.lightPosition,
    lightColor: template.lightColor ?? project.lightColor,
    // Authored lighting wins when present (including empty). Older templates
    // without the field keep the project's current extras.
    sceneLights: Array.isArray(template.sceneLights)
      ? template.sceneLights.map((light) => createSceneLight(light))
      : (project.sceneLights ?? []),
    environmentIntensity: template.environmentIntensity !== undefined
      ? template.environmentIntensity
      : (project.environmentIntensity ?? null),
    toneMappingExposure: template.toneMappingExposure !== undefined
      ? template.toneMappingExposure
      : (project.toneMappingExposure ?? null),
    cameraView: template.cameraView ?? project.cameraView,
    cameraLens: template.cameraLens ?? project.cameraLens,
    reflectionMap: template.reflectionMap ?? project.reflectionMap,
    reflectionMapImage: template.reflectionMap ? null : project.reflectionMapImage,
    edgeBlurTop: template.edgeBlurTop ?? project.edgeBlurTop,
    edgeBlurBottom: template.edgeBlurBottom ?? project.edgeBlurBottom,
    edgeBlurAmount: template.edgeBlurAmount ?? project.edgeBlurAmount,
    depthOfField: template.depthOfField === true,
    depthOfFieldAmount: template.depthOfFieldAmount ?? TEMPLATE_DEPTH_OF_FIELD_AMOUNT,
  }, selected));
}

/** Bake the template’s motion around each device’s studio angle. Frame 0 matches that angle. */
function animationForTemplate(devices: DeviceInstance[], motion?: string) {
  const primary = devices[0];
  const base = createDefaultAnimation(primary?.id ?? 'device-main');
  const preset = motion ? getAnimationPreset(motion) : getAnimationPreset('turntable');
  if (!preset || !primary) return { ...base, tracks: [] };
  return applyAnimationPreset({ ...base, tracks: [] }, devices, preset);
}
