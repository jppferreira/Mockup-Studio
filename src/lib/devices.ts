import type { DeviceLidConfig } from './deviceLid';

export type { DeviceLidConfig };

export type BuiltinDeviceId =
  | 'iphone_15_pro_max'
  | 'iphone_16_pro_max'
  | 'iphone_17_pro'
  | 'iphone_17_pro_max'
  | 'iphone_duo'
  | 'iphone_13_pro_max'
  | 'pixel_9'
  | 'pixel_9_pro'
  | 'pixel_9_pro_xl'
  | 'pixel_10_pro'
  | 'galaxy_s21_ultra'
  | 'ipad_mini_6'
  | 'macbook_pro_13_2020'
  | 'apple_watch_series_7'
  | 'chronograph_watch'
  | 'rolex_watch'
  | 'airpods_pro'
  | 'sony_mdr_7506'
  | 'skullcandy_crusher'
  | 'jbl_tour_one_m3'
  | 'macbook_pro_m3_16'
  | 'macbook_pro_m3_space_black'
  | 'macbook_pro_16_2021'
  | 'macbook_pro_touchbar'
  | 'macbook_air_13_2023'
  | 'iphone_18_pro_max'
  | 'iphone_18_pro'
  | 'galaxy_s26_ultra'
  | 'apple_vision_pro'
  | 'apple_watch_ultra_2';

/** Built-in id, or a user-imported custom model id (`custom-…`). */
export type DeviceId = BuiltinDeviceId | (string & {});

export type DevicePlatform = 'ios' | 'android';
export type DeviceKind = 'gltf' | 'procedural';
export type ProceduralStyle = 'duo';

/** Picker filter groups for the Device inspector. */
export type DeviceCategoryId =
  | 'phones'
  | 'tablets'
  | 'laptops'
  | 'watches'
  | 'headphones'
  | 'spatial';

export type DeviceCategoryFilter = 'all' | DeviceCategoryId;

export const DEVICE_CATEGORY_TABS: ReadonlyArray<{ id: DeviceCategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'phones', label: 'Phones' },
  { id: 'tablets', label: 'Tablets' },
  { id: 'laptops', label: 'Laptops' },
  { id: 'watches', label: 'Watches' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'spatial', label: 'Spatial' },
];

/** Lucide icon name key used by the Device panel category tabs. */
export type DeviceCategoryIconKey =
  | 'layout-grid'
  | 'smartphone'
  | 'tablet'
  | 'laptop'
  | 'watch'
  | 'headphones'
  | 'glasses';

export const DEVICE_CATEGORY_ICON: Record<DeviceCategoryFilter, DeviceCategoryIconKey> = {
  all: 'layout-grid',
  phones: 'smartphone',
  tablets: 'tablet',
  laptops: 'laptop',
  watches: 'watch',
  headphones: 'headphones',
  spatial: 'glasses',
};

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
  /** Picker category; inferred from id when omitted. */
  category?: DeviceCategoryId;
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
  /** Node names to hide — stray plates that aren't part of the device */
  hideNodes?: string[];
  /** Optional laptop lid open/close rig */
  lid?: DeviceLidConfig;
}

export function categoryOfDevice(device: Pick<DeviceModel, 'id' | 'category'>): DeviceCategoryId {
  if (device.category) return device.category;
  const id = String(device.id);
  if (/ipad|tablet|\btab_/.test(id)) return 'tablets';
  if (/macbook|laptop/.test(id)) return 'laptops';
  if (/watch|chronograph|rolex/.test(id)) return 'watches';
  if (/airpods|mdr_|skullcandy|jbl_|headphone/.test(id)) return 'headphones';
  if (/vision_pro|spatial/.test(id)) return 'spatial';
  return 'phones';
}

export function filterDevicesByCategory(
  devices: DeviceModel[],
  filter: DeviceCategoryFilter,
): DeviceModel[] {
  if (filter === 'all') return devices;
  return devices.filter((device) => categoryOfDevice(device) === filter);
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
    screenMat: 'screen.001',
    screenSize: { width: 1320, height: 2868 },
    rot: [0, Math.PI / 2, Math.PI],
    uv: {},
    glassMats: ['glass.002', 'lensinglass'],
    // Metal squares glued to the bottom edge of the Sketchfab mesh.
    hideNodes: ['Plane.013_metaL.001_0', 'Plane.014_metaL.001_0'],
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
    rot: [0, 0, 0],
    uv: { },
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
    rot: [0, Math.PI / 2, Math.PI],
    uv: {
      repeat: [-1.028278, -1],
      offset: [0.020257, 1.0019],
      clamp: true,
      flipY: true,
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
    subtitle: 'iOS · Procedural foldable',
    platform: 'ios',
    kind: 'procedural',
    procedural: 'duo',
    finish: '#c8ccd1',
    screenMat: 'ProceduralScreen',
    screenSize: { width: 2064, height: 2752 },
    rot: [0, 0, 0],
    uv: {},
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
    rot: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
    uv: { mirrorX: true },
    glassMats: ['Glass', 'LEDGlass', 'Lens'],
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
    rot: [0, Math.PI, 0],
    uv: { flipY: true },
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
    rot: [0, 0, 0],
    uv: { flipY: true },
    glassMats: ['Material.011', 'Material.021', 'Material.018', 'Lens'],
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
    rot: [0, Math.PI, 0],
    uv: { flipY: true },
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
    id: 'iphone_13_pro_max',
    label: 'iPhone 13 Pro Max',
    subtitle: 'iOS · SceneView / DatSketch',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_13_pro_max.glb',
    screenMat: 'Wallpaper',
    screenSize: { width: 1284, height: 2778 },
    rot: [0, 0, 0],
    uv: { flipY: true, mirrorX: true },
    glassMats: ['Glass', 'Screen_Glass', 'Camera_Glass', 'Gray_Glass', 'Black_Glass', 'Lens'],
  },
  {
    id: 'galaxy_s21_ultra',
    label: 'Galaxy S21 Ultra',
    subtitle: 'Android · SceneView / DatSketch',
    platform: 'android',
    kind: 'gltf',
    url: './models/galaxy_s21_ultra.glb',
    screenMat: 'Screen',
    screenSize: { width: 1440, height: 3200 },
    // Screen was authored on −Z; turn it toward the camera.
    rot: [0, Math.PI, 0],
    uv: { flipY: true },
    glassMats: ['Glass', 'Lens', 'Lens.001'],
  },
  {
    id: 'ipad_mini_6',
    label: 'iPad mini 6',
    subtitle: 'iPadOS · SceneView / DatSketch',
    platform: 'ios',
    kind: 'gltf',
    url: './models/ipad_mini_6.glb',
    screenMat: 'Screen',
    screenSize: { width: 1488, height: 2266 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true, flipY: true },
    glassMats: ['CamGlass', 'Lens'],
  },
  {
    id: 'macbook_pro_13_2020',
    label: 'MacBook Pro 13″ (2020)',
    subtitle: 'macOS · Timblewee / SceneView',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_pro_13_2020.glb',
    screenMat: 'Material.002',
    screenSize: { width: 2560, height: 1600 },
    rot: [Math.PI / 2, 0, Math.PI],
    uv: { mirrorX: true },
    glassMats: ['Glass', 'Black_Glass'],
    // Timblewee Bevels_2 lid — authored closed; ~110° open (matches embedded Animation mid-pose)
    lid: { mode: 'node', nodes: ['Bevels_2'], openAngle: -Math.PI * (110 / 180) },
  },
  {
    id: 'apple_watch_series_7',
    label: 'Apple Watch Series 7',
    subtitle: 'watchOS · SceneView',
    platform: 'ios',
    kind: 'gltf',
    url: './models/apple_watch_series_7.glb',
    screenMat: 'Material.001',
    screenSize: { width: 396, height: 484 },
    rot: [0, 0, 0],
    uv: { flipY: true },
    glassMats: ['Glass_Clear2', 'Black_Glossy', 'Black_Glossy2', 'Black_Glossy_TEXT'],
  },
  {
    id: 'chronograph_watch',
    label: 'Chronograph Watch',
    subtitle: 'Accessory · Khronos sample',
    platform: 'ios',
    kind: 'gltf',
    url: './models/chronograph_watch.glb',
    screenMat: 'Watch Face',
    screenSize: { width: 512, height: 512 },
    rot: [Math.PI / 2, 0, 0],
    uv: {},
    glassMats: ['Glass Face'],
  },
  {
    id: 'rolex_watch',
    label: 'Rolex Watch',
    subtitle: 'Accessory · CC BY',
    platform: 'ios',
    kind: 'gltf',
    url: './models/rolex_watch.glb',
    screenMat: 'Empty',
    screenSize: { width: 512, height: 512 },
    rot: [0, 0, -Math.PI / 2],
    uv: {},
  },
  {
    id: 'airpods_pro',
    label: 'AirPods Pro',
    subtitle: 'Audio · SceneView',
    platform: 'ios',
    kind: 'gltf',
    url: './models/airpods_pro.glb',
    screenMat: 'cEVcwrpGKjNUrED',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, Math.PI / 2, -Math.PI / 2],
    uv: {},
    glassMats: ['czaVLhHNccVShhr', 'OXPzgZBrHvcYhRk'],
  },
  {
    id: 'sony_mdr_7506',
    label: 'Sony MDR-7506',
    subtitle: 'Audio · CC BY',
    platform: 'android',
    kind: 'gltf',
    url: './models/sony_mdr_7506.glb',
    screenMat: 'pasted__headphones1',
    screenSize: { width: 1024, height: 1024 },
    // Authored upright: tall Y, thin Z (front silhouette)
    rot: [0, 0, 0],
    uv: {},
  },
  {
    id: 'skullcandy_crusher',
    label: 'Skullcandy Crusher',
    subtitle: 'Audio · CC BY',
    platform: 'android',
    kind: 'gltf',
    url: './models/skullcandy_crusher.glb',
    screenMat: 'M_Skullcandy_Crusher',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, 0, 0],
    uv: {},
  },
  {
    id: 'jbl_tour_one_m3',
    label: 'JBL Tour One M3',
    subtitle: 'Audio · CC BY',
    platform: 'android',
    kind: 'gltf',
    url: './models/jbl_tour_one_m3.glb',
    screenMat: 'Black',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Button_Glossy', 'Ring', 'Icons', 'JBL_Logo_Outer'],
  },
  {
    id: 'macbook_pro_m3_16',
    label: 'MacBook Pro M3 16″',
    subtitle: 'macOS · jackbaeten',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_pro_m3_16.glb',
    screenMat: 'LtEafgAVRolQqRw',
    screenSize: { width: 3456, height: 2234 },
    // Base down, screen toward +Z
    rot: [Math.PI / 2, 0, Math.PI],
    uv: {},
    glassMats: ['jwuTsnFxKtBUxpK', 'sIfSZcqgDlKMJPf'],
    // Lid hinge disabled until explicit lid node names are known — autoAbove
    // reparenting was creating a cyclic scene graph and blanking the UI.
  },
  {
    id: 'macbook_pro_m3_space_black',
    label: 'MacBook Pro M3 Space Black',
    subtitle: 'macOS · EV_car2013',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_pro_m3_space_black.glb',
    screenMat: 'RMKjvllDyhhTZCT',
    screenSize: { width: 3456, height: 2234 },
    rot: [Math.PI / 2, 0, 0],
    uv: {},
    glassMats: ['fkwfGoiyRwUtiJt', 'DTtyFpSjtoSKNpU'],
    lid: { mode: 'hinge', nodes: ['ctmNimOYaZdxEUt'], closeAngle: 1.6, hingeZ: 'max' },
  },
  {
    id: 'macbook_pro_16_2021',
    label: 'MacBook Pro 16″ (2021)',
    subtitle: 'macOS · jasperchui2007',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_pro_16_2021.glb',
    screenMat: 'Material.002',
    screenSize: { width: 3456, height: 2234 },
    rot: [Math.PI / 2, 0, 0],
    uv: {},
    glassMats: ['Material.005', 'Material.007', 'Material.017'],
    // Jasper — Cube016_2 stores ~-110° open angle in the GLB
    lid: { mode: 'node', nodes: ['Cube016_2'] },
  },
  {
    id: 'macbook_pro_touchbar',
    label: 'MacBook Pro (Touch Bar)',
    subtitle: 'macOS · jasperchui2007',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_pro_touchbar.glb',
    screenMat: 'Material.004',
    screenSize: { width: 2880, height: 1800 },
    rot: [Math.PI / 2, 0, 0],
    uv: {},
    glassMats: ['Material.005', 'Material.002', 'Material.007', 'Material.009'],
    lid: { mode: 'node', nodes: ['Cube012_1'] },
  },
  {
    id: 'macbook_air_13_2023',
    label: 'MacBook Air 13″ (2023)',
    subtitle: 'macOS · akshatmittal',
    platform: 'ios',
    kind: 'gltf',
    url: './models/macbook_air_13_2023.glb',
    screenMat: 'WgepFXghdzLuexM',
    screenSize: { width: 2560, height: 1664 },
    // Base down, screen toward +Z
    rot: [0, Math.PI, Math.PI],
    uv: { mirrorX: true },
    glassMats: ['bcpnEXkmszsmZdS', 'lYneAwFQipafcnj', 'vuMpgMlHdXrAecr'],
    lid: { mode: 'hinge', nodes: ['oFmtZsVimojULVl'], closeAngle: 1.55, hingeZ: 'max' },
  },
  {
    id: 'iphone_18_pro_max',
    label: 'iPhone 18 Pro Max',
    subtitle: 'iOS · Adreamyouvehadbefore',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_18_pro_max.glb',
    screenMat: 'Display',
    screenSize: { width: 1320, height: 2868 },
    rot: [Math.PI / 2, 0, 0],
    uv: {},
    glassMats: [
      'Black_Glass', 'Back_Glass_Burgundy', 'LiDAR_Glass', 'Sapphire',
      'Front_Element', 'Antenna_Window', 'Front_Camera_photo', 'Rear_Element_photo',
    ],
  },
  {
    id: 'iphone_18_pro',
    label: 'iPhone 18 Pro',
    subtitle: 'iOS · DUOPlyer',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_18_pro.glb',
    // Material.013 is camera housing — display panels use Material.020 (+ color variants)
    screenMat: 'Material.020',
    screenSize: { width: 1206, height: 2622 },
    rot: [Math.PI / 2, Math.PI, Math.PI / 2],
    uv: { flipY: true },
    // No dedicated glass sheets — lens / flash discs get glossy treatment
    glassMats: ['Material.021', 'Material.012', 'Material.014', 'Material.022'],
  },
  {
    id: 'galaxy_s26_ultra',
    label: 'Galaxy S26 Ultra',
    subtitle: 'Android · AbrasiveFowl4870',
    platform: 'android',
    kind: 'gltf',
    url: './models/galaxy_s26_ultra.glb',
    screenMat: 'material',
    screenSize: { width: 1440, height: 3120 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['CPP_Glasses', 'EyeTransparent'],
    tweaks: {
      CPP_Glasses: { roughness: 0.08, metalness: 0, envMapIntensity: 1.4, opacity: 0.28, transparent: true },
      EyeTransparent: { roughness: 0.04, metalness: 0, envMapIntensity: 1.6, opacity: 0.12, transparent: true },
    },
  },
  {
    id: 'apple_vision_pro',
    label: 'Apple Vision Pro',
    subtitle: 'visionOS · DextonOfficial',
    platform: 'ios',
    kind: 'gltf',
    url: './models/apple_vision_pro.glb',
    screenMat: 'FAJMtZQLswdvuhO',
    screenSize: { width: 3660, height: 3200 },
    rot: [0, Math.PI, Math.PI / 2],
    uv: {},
    glassMats: ['NLAQCwOxsrAPIlV', 'LlnrRvRtBSKKJtZ', 'FOugkDgsmvxAjLB', 'nctcFIvFhZfKDLQ'],
  },
  {
    id: 'apple_watch_ultra_2',
    label: 'Apple Watch Ultra 2',
    subtitle: 'watchOS · Polyman_3D',
    platform: 'ios',
    kind: 'gltf',
    url: './models/apple_watch_ultra_2.glb',
    screenMat: 'edYkGGAdRWeopLP',
    screenSize: { width: 410, height: 502 },
    rot: [Math.PI, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['VJcIxaYCeMHzzAJ', 'EbFYvXZFEOELnji', 'IsuszdatyklnjoT', 'JlRKetQcktLwJwa'],
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
