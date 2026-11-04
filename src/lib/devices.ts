export type BuiltinDeviceId =
  | 'iphone_15_pro_max'
  | 'iphone_16_pro_max'
  | 'iphone_17_pro'
  | 'iphone_17_pro_max'
  | 'iphone_duo'
  | 'pixel_9'
  | 'pixel_9_pro'
  | 'pixel_9_pro_xl'
  | 'pixel_10_pro'
  | 'galaxy_s25_ultra';

/** Built-in id, or a user-imported custom model id (`custom-…`). */
export type DeviceId = BuiltinDeviceId | (string & {});

export type DevicePlatform = 'ios' | 'android';
export type DeviceKind = 'gltf' | 'procedural';
export type ProceduralStyle = 'duo';

export interface DeviceUv {
  rot?: number;
  mirrorX?: boolean;
  flipY?: boolean;
  repeat?: [number, number];
  offset?: [number, number];
  clamp?: boolean;
}

export interface ScreenSize {
  /** Native screenshot width in px */
  width: number;
  /** Native screenshot height in px */
  height: number;
}

export interface DeviceModel {
  id: DeviceId;
  label: string;
  subtitle: string;
  platform: DevicePlatform;
  kind: DeviceKind;
  /** GLB path or blob URL for gltf devices */
  url?: string;
  /** Procedural body style */
  procedural?: ProceduralStyle;
  /** Accent / body finish for procedural models */
  finish?: string;
  screenMat: string;
  /** Recommended screenshot / placeholder pixel size */
  screenSize: ScreenSize;
  /** Model-space rotation so height is Y and screen faces +Z */
  rot: [number, number, number];
  uv: DeviceUv;
  screenInset?: { border: number; radius: number };
  tweaks?: Record<string, Record<string, number | boolean | string>>;
  /** Extra material names treated as glass for reflection control */
  glassMats?: string[];
}

export function screenSizeLabel(size: ScreenSize) {
  return `${size.width} × ${size.height}`;
}

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'iphone_15_pro_max',
    label: 'iPhone 15 Pro Max',
    subtitle: 'iOS · Titanium OLED',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_15_pro_max.glb',
    screenMat: 'pIJKfZsazmcpEiU',
    screenSize: { width: 1290, height: 2796 },
    rot: [0, Math.PI, 0],
    uv: { rot: Math.PI, mirrorX: true },
    // Hashed Sketchfab names — BLEND/low-opacity glass parts
    glassMats: [
      'jpGaQNgTtEGkTfo', 'sxNzrmuTqVeaXdg', 'xNrofRCqOXXHVZt',
      'ZQfGMLaFcpPaLMU', 'EszxgwYUTxbhBrC', 'HGhEhpqSBZRnjHC',
    ],
  },
  {
    id: 'iphone_16_pro_max',
    label: 'iPhone 16 Pro Max',
    subtitle: 'iOS · Natural Titanium',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_16_pro_max.glb',
    screenMat: 'Screen',
    screenSize: { width: 1320, height: 2868 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['glass.002', 'lensinglass'],
  },
  {
    id: 'iphone_17_pro',
    label: 'iPhone 17 Pro',
    subtitle: 'iOS · Cosmic Orange',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_17_pro.glb',
    screenMat: 'OLED',
    screenSize: { width: 1206, height: 2622 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['Glass', 'Glass_tint', 'Frosted_glass', 'Camera_sapphire_miror', 'Camera_Lens'],
    tweaks: {
      Glass: { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.03, transparent: true },
      Display_Frame: {
        color: 0x000000, emissive: 0x0d0d0f, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
      OLED_off: {
        color: 0x000000, emissive: 0x0d0d0f, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
    },
  },
  {
    id: 'iphone_17_pro_max',
    label: 'iPhone 17 Pro Max',
    subtitle: 'iOS · Edge display',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_17_pro_max.glb',
    screenMat: 'screen.001',
    screenSize: { width: 1320, height: 2868 },
    rot: [0, Math.PI / 2, 0],
    uv: {
      repeat: [-1.028278, -1],
      offset: [0.020257, 1.0019],
      clamp: true,
    },
    screenInset: { border: 26, radius: 162 },
    glassMats: ['glass.002', 'lensinglass'],
    tweaks: {
      'black.002': {
        color: 0x000000, emissive: 0x000000, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
    },
  },
  {
    id: 'iphone_duo',
    label: 'iPhone Duo',
    subtitle: 'iOS · Star White foldable',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_duo.glb',
    screenMat: 'C_StarWhite_Screen_Inner',
    screenSize: { width: 2064, height: 2752 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: [
      'BASE_Glass', 'BASE_Glass_Black', 'BASE_Cam_Lens_Outer',
      'C_SW_CamGloss', 'BASE_Cam_Lens01', 'BASE_Cam_Lens02', 'BASE_Cam_Lens_Front',
    ],
    tweaks: {
      BASE_Glass: {
        roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.03, transparent: true,
      },
      BASE_Glass_Black: {
        roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.04, transparent: true,
      },
      C_SW_Screen_Outer: {
        color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
    },
  },
  {
    id: 'pixel_9',
    label: 'Pixel 9',
    subtitle: 'Android · Porcelain',
    platform: 'android',
    kind: 'gltf',
    url: './models/pixel_9.glb',
    screenMat: 'Screen',
    screenSize: { width: 1080, height: 2424 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['Glass', 'LEDGlass'],
    tweaks: {
      Glass: { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.04, transparent: true },
      BodyTexture: { metalness: 0.35, roughness: 0.42, envMapIntensity: 0.7 },
    },
  },
  {
    id: 'pixel_9_pro',
    label: 'Pixel 9 Pro',
    subtitle: 'Android · Obsidian',
    platform: 'android',
    kind: 'gltf',
    url: './models/pixel_9_pro.glb',
    screenMat: 'Screen',
    screenSize: { width: 1280, height: 2856 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['CamGlass', 'Lens'],
    tweaks: {
      CamGlass: { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.05, transparent: true },
      Bezel: {
        color: 0x000000, emissive: 0x050505, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
      Frame: { color: 0x1a1a1c, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.8 },
      Backtop: { color: 0x2b2a28, metalness: 0.2, roughness: 0.55, envMapIntensity: 0.4 },
      BackBottom: { color: 0x2b2a28, metalness: 0.2, roughness: 0.55, envMapIntensity: 0.4 },
    },
  },
  {
    id: 'pixel_9_pro_xl',
    label: 'Pixel 9 Pro XL',
    subtitle: 'Android · Hazel',
    platform: 'android',
    kind: 'gltf',
    url: './models/pixel_9_pro_xl.glb',
    screenMat: 'Material.002',
    screenSize: { width: 1344, height: 2992 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['Material.011', 'Material.021', 'Material.018'],
    tweaks: {
      'Material.011': { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.04, transparent: true },
      'Material.021': { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.04, transparent: true },
      Frame: { color: 0x8a8476, metalness: 0.75, roughness: 0.4, envMapIntensity: 0.75 },
      'Material.001': { color: 0x8a8476, metalness: 0.25, roughness: 0.55, envMapIntensity: 0.45 },
      'Material.006': { color: 0x6f6a5e, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.4 },
    },
  },
  {
    id: 'pixel_10_pro',
    label: 'Pixel 10 Pro',
    subtitle: 'Android · Moonstone',
    platform: 'android',
    kind: 'gltf',
    url: './models/pixel_10_pro.glb',
    screenMat: 'Screen',
    screenSize: { width: 1280, height: 2856 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['CamGlass', 'Lens'],
    tweaks: {
      CamGlass: { roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.05, transparent: true },
      Bezel: {
        color: 0x000000, emissive: 0x050505, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
      Frame: { color: 0xb8c0c8, metalness: 0.9, roughness: 0.28, envMapIntensity: 0.85 },
      Backtop: { color: 0xd6dde3, metalness: 0.15, roughness: 0.5, envMapIntensity: 0.55 },
      BackBottom: { color: 0xd6dde3, metalness: 0.15, roughness: 0.5, envMapIntensity: 0.55 },
    },
  },
  {
    id: 'galaxy_s25_ultra',
    label: 'Galaxy S25 Ultra',
    subtitle: 'Android · Titanium Black',
    platform: 'android',
    kind: 'gltf',
    url: './models/galaxy_s25_ultra.glb',
    screenMat: 'Screen',
    screenSize: { width: 1440, height: 3120 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Screen glass', 'Back glass', 'Back glass flash', 'Camera glass', 'Camera lens'],
    tweaks: {
      'Screen glass': {
        roughness: 1, metalness: 0, envMapIntensity: 0, opacity: 0.03, transparent: true,
      },
      Body: { color: 0x8a8a8d, metalness: 1, roughness: 1, envMapIntensity: 0.85 },
      'Body .001': { color: 0x848487, metalness: 1, roughness: 1, envMapIntensity: 0.85 },
      'Body .002': { color: 0x7d7d81, metalness: 1, roughness: 1, envMapIntensity: 0.8 },
      Button: { color: 0x888a8c, metalness: 0.9, roughness: 0.4, envMapIntensity: 0.8 },
      'Back glass': { color: 0x2b2927, metalness: 0, roughness: 0.9, envMapIntensity: 0.15 },
      Camera: {
        color: 0x000000, emissive: 0x000000, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
      'Camera glass': {
        color: 0x000000, metalness: 0, roughness: 1, envMapIntensity: 0, transparent: true, opacity: 0.04,
      },
    },
  },
];

import {
  customMetaToDeviceModel,
  getCustomDeviceObjectUrl,
  isCustomDeviceId,
  loadCustomDeviceMeta,
  resolveCustomDevice,
} from './customDevices';

export { isCustomDeviceId };

export function getDevice(id: DeviceId | string | undefined): DeviceModel {
  const builtin = DEVICE_MODELS.find((d) => d.id === id);
  if (builtin) return builtin;
  if (typeof id === 'string' && isCustomDeviceId(id)) {
    const custom = resolveCustomDevice(id);
    if (custom) return custom;
  }
  return DEVICE_MODELS[0];
}

/** Built-ins plus currently imported custom models (for pickers). */
export function listAllDevices(): DeviceModel[] {
  const custom = loadCustomDeviceMeta().map((meta) =>
    customMetaToDeviceModel(meta, getCustomDeviceObjectUrl(meta.id) ?? undefined),
  );
  return [...DEVICE_MODELS, ...custom];
}

export function isBuiltinDeviceId(id: string | undefined | null): id is BuiltinDeviceId {
  return typeof id === 'string' && DEVICE_MODELS.some((d) => d.id === id);
}

export function isKnownDeviceId(id: string | undefined | null): boolean {
  if (!id) return false;
  if (DEVICE_MODELS.some((d) => d.id === id)) return true;
  if (isCustomDeviceId(id) && loadCustomDeviceMeta().some((d) => d.id === id)) return true;
  return false;
}
