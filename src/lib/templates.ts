import { applyAnimationPreset, getAnimationPreset } from './animationPresets';
import { placeholderForDevice } from './demo';
import {
  ANDROID_DEVICE_ID, BUILTIN_GRADIENTS, CAMERA_TARGET_ID, DEFAULT_GRADIENT, DEFAULT_PROJECT, IOS_DEVICE_ID,
  createCompositionScene, createDefaultAnimation, createDeviceInstance, createSceneProp,
  type AnimationClip, type BackgroundPreset, type CameraLens, type CameraView, type DeviceColor,
  type DeviceInstance, type GradientColors, type MockupProject, type SceneProp, type Vec3,
} from '../types';
import type { SceneOverlay } from './overlays';
import { getDevice, type DeviceId } from './devices';

export type TemplateCategory = 'devices' | 'scenes' | 'saved';

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
  /** Motion preset applied from each device’s studio angle. `clear` leaves the shot still. */
  motion?: string;
  /** Saved compositions keep the split link instead of inferring it from rotation. */
  linkSplitTransform?: boolean;
  cameraView?: CameraView;
  cameraLens?: CameraLens;
  lightPosition?: Vec3;
  lightColor?: string;
  edgeBlurTop?: boolean;
  edgeBlurBottom?: boolean;
  edgeBlurAmount?: number;
  deviceExtras?: Array<{
    glassReflection?: number;
    lidOpen?: number;
    deviceColor?: DeviceColor;
    clayMode?: boolean;
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
    background: 'midnight',
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
    gradient: { ...BUILTIN_GRADIENTS.studio },
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
    background: 'mint',
    gradient: { ...BUILTIN_GRADIENTS.mint },
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
    background: 'sunset',
    gradient: { ...BUILTIN_GRADIENTS.sunset },
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
    gradient: { ...BUILTIN_GRADIENTS.studio },
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
    background: 'midnight',
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
    background: 'mint',
    gradient: { ...BUILTIN_GRADIENTS.mint },
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
    background: 'midnight',
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
  {
    id: 'clay-desk',
    label: 'Clay Desk',
    description: 'Leaning phone among clay, gentle float',
    badge: 'Float',
    category: 'scenes',
    preview: 'clay',
    background: 'studio',
    gradient: { center: '#f3ebe2', mid: '#d8cfc4', edge: '#b5aaa0' },
    compositionMode: 'single',
    lightIntensity: 2.2,
    fillIntensity: 0.95,
    shadowOpacity: 0.38,
    shadowSoftness: 3.2,
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
    gradient: { center: '#ebe7e0', mid: '#cfc9c0', edge: '#9e9890' },
    compositionMode: 'single',
    lightIntensity: 2.6,
    fillIntensity: 0.65,
    shadowOpacity: 0.42,
    shadowSoftness: 2.4,
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
    background: 'midnight',
    gradient: { center: '#3a424c', mid: '#1e242c', edge: '#0c1016' },
    compositionMode: 'single',
    lightIntensity: 2.8,
    fillIntensity: 0.55,
    shadowOpacity: 0.45,
    shadowSoftness: 2.8,
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
    background: 'mint',
    gradient: { center: '#5a8a78', mid: '#1f4a40', edge: '#0a1c18' },
    compositionMode: 'single',
    lightIntensity: 2.4,
    fillIntensity: 0.8,
    shadowOpacity: 0.36,
    shadowSoftness: 3.0,
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
    gradient: { center: '#e4dfd6', mid: '#bbb4aa', edge: '#8a847a' },
    compositionMode: 'single',
    lightIntensity: 2.5,
    fillIntensity: 0.7,
    shadowOpacity: 0.4,
    shadowSoftness: 2.2,
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
    background: 'sunset',
    gradient: { center: '#c894a8', mid: '#5a4868', edge: '#181228' },
    compositionMode: 'split',
    lightIntensity: 2.3,
    fillIntensity: 0.85,
    shadowOpacity: 0.35,
    shadowSoftness: 3.0,
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
    gradient: { center: '#ffffff', mid: '#fafafa', edge: '#f2f2f0' },
    compositionMode: 'single',
    lightIntensity: 2.6,
    fillIntensity: 1.2,
    shadowOpacity: 0.38,
    shadowSoftness: 4.2,
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
    gradient: { center: '#efe8dc', mid: '#c4b8a6', edge: '#6a6258' },
    compositionMode: 'single',
    lightIntensity: 2.5,
    fillIntensity: 0.62,
    shadowOpacity: 0.46,
    shadowSoftness: 2.6,
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
    gradient: { center: '#f7f4ef', mid: '#ddd6cc', edge: '#9a9288' },
    compositionMode: 'single',
    lightIntensity: 2.8,
    fillIntensity: 0.7,
    shadowOpacity: 0.42,
    shadowSoftness: 3.4,
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

export function getCompositionTemplate(id: string) {
  return COMPOSITION_TEMPLATES.find((item) => item.id === id);
}

export function templatesByCategory(category: TemplateCategory) {
  if (category === 'saved') return [];
  return COMPOSITION_TEMPLATES.filter((item) => item.category === category);
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
      lidOpen: extra?.lidOpen,
      deviceColor: extra?.deviceColor,
      clayMode: extra?.clayMode,
    });
  });
  const primary = devices[0];
  const builtinKey = template.background as keyof typeof BUILTIN_GRADIENTS;
  const gradient = template.gradient
    ? { ...template.gradient }
    : BUILTIN_GRADIENTS[builtinKey]
      ? { ...BUILTIN_GRADIENTS[builtinKey] }
      : { ...DEFAULT_GRADIENT };

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
  }));

  const scene = createCompositionScene({
    id: 'scene-main',
    name: 'Scene 1',
    background: template.background,
    gradientColors: gradient,
  });

  const primaryShot = primary.screenshot ?? placeholderForDevice(primary.deviceId);

  return {
    ...DEFAULT_PROJECT,
    name: options?.name ?? template.label,
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
    shadowOpacity: template.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity,
    shadowSoftness: template.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness,
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
    ...(template.edgeBlurTop != null ? { edgeBlurTop: template.edgeBlurTop } : {}),
    ...(template.edgeBlurBottom != null ? { edgeBlurBottom: template.edgeBlurBottom } : {}),
    ...(template.edgeBlurAmount != null ? { edgeBlurAmount: template.edgeBlurAmount } : {}),
    ...(template.overlays ? {
      overlays: template.overlays.map((overlay) => ({
        ...overlay,
        id: `overlay-${Math.random().toString(36).slice(2, 10)}`,
        imageData: null,
      })),
    } : {}),
  };
}

/** Bake the template’s motion around each device’s studio angle. Frame 0 matches that angle. */
function animationForTemplate(devices: DeviceInstance[], motion?: string) {
  const primary = devices[0];
  const base = createDefaultAnimation(primary?.id ?? 'device-main');
  const preset = motion ? getAnimationPreset(motion) : getAnimationPreset('turntable');
  if (!preset || !primary) return { ...base, tracks: [] };
  return applyAnimationPreset({ ...base, tracks: [] }, devices, preset);
}
