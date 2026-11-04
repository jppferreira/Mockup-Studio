import { placeholderForDevice } from './demo';
import {
  ANDROID_DEVICE_ID, BUILTIN_GRADIENTS, DEFAULT_GRADIENT, DEFAULT_PROJECT, IOS_DEVICE_ID,
  createCompositionScene, createDefaultAnimation, createDeviceInstance, createSceneProp,
  type BackgroundPreset, type DeviceInstance, type GradientColors, type MockupProject,
  type SceneProp,
} from '../types';
import { getDevice, type DeviceId } from './devices';

export type TemplateCategory = 'devices' | 'scenes';

export interface CompositionTemplate {
  id: string;
  label: string;
  description: string;
  /** Short badge shown on the card, e.g. "1 device" */
  badge: string;
  category: TemplateCategory;
  /** CSS thumbnail layout hint */
  preview: 'solo' | 'pair' | 'trio' | 'fan' | 'depth' | 'split' | 'stack'
    | 'clay' | 'concrete' | 'pedestal' | 'desk' | 'studio';
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
}

export const COMPOSITION_TEMPLATES: CompositionTemplate[] = [
  {
    id: 'solo-hero',
    label: 'Solo Hero',
    description: 'One phone, classic product angle',
    badge: '1 device',
    category: 'devices',
    preview: 'solo',
    background: 'midnight',
    compositionMode: 'single',
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: -8, y: -23, z: 8 },
      position: { x: 0, y: 0, z: 0 },
      scale: 1,
    }],
  },
  {
    id: 'ios-android',
    label: 'iOS + Android',
    description: 'Dual canvases — iOS and Android side by side',
    badge: '2 devices',
    category: 'devices',
    preview: 'split',
    background: 'studio',
    gradient: { ...BUILTIN_GRADIENTS.studio },
    compositionMode: 'split',
    devices: [
      {
        deviceId: IOS_DEVICE_ID,
        rotation: { x: -6, y: -18, z: 4 },
        position: { x: 0, y: 0, z: 0 },
        scale: 0.9,
      },
      {
        deviceId: ANDROID_DEVICE_ID,
        rotation: { x: -6, y: -18, z: 4 },
        position: { x: 0, y: 0, z: 0 },
        scale: 0.9,
      },
    ],
  },
  {
    id: 'duo-stack',
    label: 'Duo Stack',
    description: 'Overlapping phones at offset angles',
    badge: '2 devices',
    category: 'devices',
    preview: 'stack',
    background: 'mint',
    gradient: { ...BUILTIN_GRADIENTS.mint },
    compositionMode: 'single',
    devices: [
      {
        deviceId: 'iphone_16_pro_max',
        rotation: { x: -12, y: -32, z: 10 },
        position: { x: -0.55, y: 0.05, z: -0.2 },
        scale: 0.92,
      },
      {
        deviceId: 'iphone_17_pro',
        rotation: { x: -4, y: 18, z: -6 },
        position: { x: 0.7, y: -0.05, z: 0.15 },
        scale: 0.88,
      },
    ],
  },
  {
    id: 'triple-fan',
    label: 'Triple Fan',
    description: 'Three devices fanned for a lineup',
    badge: '3 devices',
    category: 'devices',
    preview: 'fan',
    background: 'sunset',
    gradient: { ...BUILTIN_GRADIENTS.sunset },
    compositionMode: 'single',
    devices: [
      {
        deviceId: 'iphone_15_pro_max',
        rotation: { x: -10, y: -38, z: 12 },
        position: { x: -1.55, y: 0.05, z: -0.15 },
        scale: 0.78,
      },
      {
        deviceId: 'iphone_16_pro_max',
        rotation: { x: -8, y: -8, z: 2 },
        position: { x: 0, y: 0.1, z: 0.2 },
        scale: 0.86,
      },
      {
        deviceId: 'galaxy_s25_ultra',
        rotation: { x: -10, y: 28, z: -10 },
        position: { x: 1.55, y: 0.05, z: -0.15 },
        scale: 0.78,
      },
    ],
  },
  {
    id: 'portrait-parade',
    label: 'Portrait Parade',
    description: 'Three phones facing forward in a row',
    badge: '3 devices',
    category: 'devices',
    preview: 'trio',
    background: 'studio',
    gradient: { ...BUILTIN_GRADIENTS.studio },
    compositionMode: 'single',
    devices: [
      {
        deviceId: 'pixel_9_pro',
        rotation: { x: -4, y: -8, z: 0 },
        position: { x: -1.7, y: 0, z: 0 },
        scale: 0.72,
      },
      {
        deviceId: 'iphone_17_pro_max',
        rotation: { x: -4, y: 0, z: 0 },
        position: { x: 0, y: 0.05, z: 0.1 },
        scale: 0.8,
      },
      {
        deviceId: 'galaxy_s25_ultra',
        rotation: { x: -4, y: 8, z: 0 },
        position: { x: 1.7, y: 0, z: 0 },
        scale: 0.72,
      },
    ],
  },
  {
    id: 'depth-stage',
    label: 'Depth Stage',
    description: 'Layered depth with a hero up front',
    badge: '3 devices',
    category: 'devices',
    preview: 'depth',
    background: 'midnight',
    compositionMode: 'single',
    devices: [
      {
        deviceId: 'iphone_15_pro_max',
        rotation: { x: -16, y: -42, z: 8 },
        position: { x: -1.4, y: 0.15, z: -0.85 },
        scale: 0.7,
      },
      {
        deviceId: 'iphone_17_pro',
        rotation: { x: -6, y: -12, z: 4 },
        position: { x: 0.15, y: 0, z: 0.35 },
        scale: 0.95,
      },
      {
        deviceId: 'pixel_10_pro',
        rotation: { x: -14, y: 34, z: -8 },
        position: { x: 1.55, y: 0.1, z: -0.55 },
        scale: 0.68,
      },
    ],
  },
  {
    id: 'android-focus',
    label: 'Android Focus',
    description: 'Galaxy hero with a soft companion',
    badge: '2 devices',
    category: 'devices',
    preview: 'pair',
    background: 'mint',
    gradient: { ...BUILTIN_GRADIENTS.mint },
    compositionMode: 'single',
    devices: [
      {
        deviceId: 'galaxy_s25_ultra',
        rotation: { x: -8, y: -20, z: 6 },
        position: { x: -0.35, y: 0, z: 0.2 },
        scale: 1,
      },
      {
        deviceId: 'pixel_9_pro_xl',
        rotation: { x: -14, y: 28, z: -8 },
        position: { x: 1.45, y: 0.05, z: -0.35 },
        scale: 0.78,
      },
    ],
  },
  {
    id: 'blank',
    label: 'Blank Canvas',
    description: 'Single device, neutral starting pose',
    badge: '1 device',
    category: 'devices',
    preview: 'solo',
    background: 'midnight',
    compositionMode: 'single',
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
    description: 'Phone nestled among soft clay shapes',
    badge: 'Clay set',
    category: 'scenes',
    preview: 'clay',
    background: 'studio',
    gradient: { center: '#f3ebe2', mid: '#d8cfc4', edge: '#b5aaa0' },
    compositionMode: 'single',
    lightIntensity: 2.2,
    fillIntensity: 0.95,
    shadowOpacity: 0.38,
    shadowSoftness: 3.2,
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -12, y: -28, z: 14 },
      position: { x: 0.15, y: -0.15, z: 0.35 },
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
    description: 'Phone leaning against a concrete wall',
    badge: 'Concrete',
    category: 'scenes',
    preview: 'concrete',
    background: 'studio',
    gradient: { center: '#ebe7e0', mid: '#cfc9c0', edge: '#9e9890' },
    compositionMode: 'single',
    lightIntensity: 2.6,
    fillIntensity: 0.65,
    shadowOpacity: 0.42,
    shadowSoftness: 2.4,
    devices: [{
      deviceId: 'iphone_17_pro',
      rotation: { x: -4, y: -18, z: 6 },
      position: { x: -0.15, y: -0.2, z: 0.55 },
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
    description: 'Hero phone on a concrete plinth with clay accents',
    badge: 'Pedestal',
    category: 'scenes',
    preview: 'pedestal',
    background: 'midnight',
    gradient: { center: '#3a424c', mid: '#1e242c', edge: '#0c1016' },
    compositionMode: 'single',
    lightIntensity: 2.8,
    fillIntensity: 0.55,
    shadowOpacity: 0.45,
    shadowSoftness: 2.8,
    devices: [{
      deviceId: 'iphone_15_pro_max',
      rotation: { x: -10, y: -22, z: 8 },
      position: { x: 0, y: 0.55, z: 0.1 },
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
    description: 'Two phones framed by oversized clay forms',
    badge: '2 devices',
    category: 'scenes',
    preview: 'desk',
    background: 'mint',
    gradient: { center: '#5a8a78', mid: '#1f4a40', edge: '#0a1c18' },
    compositionMode: 'single',
    lightIntensity: 2.4,
    fillIntensity: 0.8,
    shadowOpacity: 0.36,
    shadowSoftness: 3.0,
    devices: [
      {
        deviceId: 'iphone_17_pro_max',
        rotation: { x: -8, y: -30, z: 10 },
        position: { x: -0.55, y: -0.1, z: 0.4 },
        scale: 0.82,
      },
      {
        deviceId: 'galaxy_s25_ultra',
        rotation: { x: -6, y: 22, z: -8 },
        position: { x: 0.85, y: -0.05, z: 0.15 },
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
    description: 'Phone tucked into a concrete corner with clay blocks',
    badge: 'Concrete',
    category: 'scenes',
    preview: 'concrete',
    background: 'studio',
    gradient: { center: '#e4dfd6', mid: '#bbb4aa', edge: '#8a847a' },
    compositionMode: 'single',
    lightIntensity: 2.5,
    fillIntensity: 0.7,
    shadowOpacity: 0.4,
    shadowSoftness: 2.2,
    devices: [{
      deviceId: 'pixel_9_pro',
      rotation: { x: -6, y: 28, z: -4 },
      position: { x: 0.35, y: -0.25, z: 0.45 },
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
    description: 'iOS + Android resting on a clay-scattered slab',
    badge: 'Split + clay',
    category: 'scenes',
    preview: 'clay',
    background: 'sunset',
    gradient: { center: '#c894a8', mid: '#5a4868', edge: '#181228' },
    compositionMode: 'split',
    lightIntensity: 2.3,
    fillIntensity: 0.85,
    shadowOpacity: 0.35,
    shadowSoftness: 3.0,
    devices: [
      {
        deviceId: IOS_DEVICE_ID,
        rotation: { x: -8, y: -16, z: 5 },
        position: { x: 0, y: -0.05, z: 0.25 },
        scale: 0.85,
      },
      {
        deviceId: ANDROID_DEVICE_ID,
        rotation: { x: -8, y: -16, z: 5 },
        position: { x: 0, y: -0.05, z: 0.25 },
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
    description: 'Clean white cyclorama with a soft floating shadow',
    badge: 'Studio',
    category: 'scenes',
    preview: 'studio',
    background: 'studio',
    gradient: { center: '#ffffff', mid: '#fafafa', edge: '#f2f2f0' },
    compositionMode: 'single',
    lightIntensity: 2.6,
    fillIntensity: 1.2,
    shadowOpacity: 0.38,
    shadowSoftness: 4.2,
    devices: [{
      deviceId: 'iphone_16_pro_max',
      rotation: { x: -6, y: -18, z: 4 },
      // Lifted slightly so the soft contact shadow reads as floating
      position: { x: 0, y: 0.22, z: 0.45 },
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
];

export function getCompositionTemplate(id: string) {
  return COMPOSITION_TEMPLATES.find((item) => item.id === id);
}

export function templatesByCategory(category: TemplateCategory) {
  return COMPOSITION_TEMPLATES.filter((item) => item.category === category);
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
    return createDeviceInstance({
      id: index === 0
        ? (template.compositionMode === 'split' ? 'device-ios' : 'device-main')
        : (template.compositionMode === 'split' && index === 1 ? 'device-android' : `device-${index + 1}`),
      deviceId: entry.deviceId,
      rotation: entry.rotation ? { ...entry.rotation } : undefined,
      position: entry.position ? { ...entry.position } : undefined,
      scale: entry.scale,
      screenshot: shot ?? placeholderForDevice(entry.deviceId),
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
    linkSplitTransform: true,
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
    animation: createDefaultAnimation(primary.id),
  };
}
