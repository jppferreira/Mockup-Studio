import type { DeviceLidConfig } from './deviceLid';
import { TONE_SILVER } from './referenceTones';

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
  | 'iphone_18'
  | 'iphone_17'
  | 'iphone_air'
  | 'galaxy_s26_ultra'
  | 'galaxy_s26_plus'
  | 'galaxy_s26'
  | 'galaxy_z_fold8'
  | 'galaxy_z_fold8_ultra'
  | 'galaxy_z_flip8'
  | 'pixel_11'
  | 'pixel_11_pro'
  | 'pixel_11_pro_xl'
  | 'pixel_fold'
  | 'pixel_watch'
  | 'pixel_watch_7'
  | 'apple_watch_ultra_4'
  | 'apple_watch_se_3'
  | 'apple_watch_series_12'
  | 'apple_vision_pro'
  | 'apple_watch_ultra_2'
  | 'ipad_pro_m5'
  | 'macbook_pro_m5'
  | 'imac_24'
  | 'imac_m4'
  | 'apple_homeview'
  | 'generic_smartphone'
  | 'generic_tablet'
  | 'generic_laptop';

/** Built-in id, or a user-imported custom model id (`custom-…`). */
export type DeviceId = BuiltinDeviceId | (string & {});

export type DevicePlatform = 'ios' | 'android';
export type DeviceKind = 'gltf' | 'procedural';
export type ProceduralStyle = 'duo' | 'phone' | 'tablet' | 'laptop';

/**
 * Commercial-use clarity for the purchased / credited mesh.
 * `needs_review` = pack terms do not clearly permit a commercial mockup generator.
 * Does not constitute legal advice.
 */
export type ModelLicenseClarity = 'cc_by' | 'commercial_pack' | 'procedural' | 'needs_review';

/** Picker filter groups for the Device inspector. */
export type DeviceCategoryId =
  | 'phones'
  | 'tablets'
  | 'laptops'
  | 'desktops'
  | 'watches'
  | 'headphones'
  | 'spatial'
  | 'generic';

export type DeviceCategoryFilter = 'all' | DeviceCategoryId;

export const DEVICE_CATEGORY_TABS: ReadonlyArray<{ id: DeviceCategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'phones', label: 'Phones' },
  { id: 'tablets', label: 'Tablets' },
  { id: 'laptops', label: 'Laptops' },
  { id: 'desktops', label: 'Desktops' },
  { id: 'watches', label: 'Watches' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'generic', label: 'Generic' },
];

/** Lucide icon name key used by the Device panel category tabs. */
export type DeviceCategoryIconKey =
  | 'layout-grid'
  | 'smartphone'
  | 'tablet'
  | 'laptop'
  | 'monitor'
  | 'watch'
  | 'headphones'
  | 'glasses'
  | 'cuboid';

export const DEVICE_CATEGORY_ICON: Record<DeviceCategoryFilter, DeviceCategoryIconKey> = {
  all: 'layout-grid',
  phones: 'smartphone',
  tablets: 'tablet',
  laptops: 'laptop',
  desktops: 'monitor',
  watches: 'watch',
  headphones: 'headphones',
  spatial: 'glasses',
  generic: 'cuboid',
};

export interface DeviceUv {
  rot?: number;
  mirrorX?: boolean;
  flipY?: boolean;
  repeat?: [number, number];
  offset?: [number, number];
  clamp?: boolean;
  /**
   * Rebuild the screen mesh UVs from the fitted front plane.
   * Use when the glTF unwrap splits the display into rotated islands
   * so a single texture matrix cannot keep the screenshot upright.
   */
  planar?: boolean;
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
  /**
   * @deprecated GLB materials are always kept as authored now.
   * Clay mode is the only studio override. Kept for older project JSON.
   */
  lockMaterials?: boolean;
  /**
   * When false, skip the phone-screen emissive pipeline (headphones, cases, etc.).
   * Defaults to true for devices that show a screenshot.
   */
  hasScreen?: boolean;
  /** Node names to hide — stray plates that aren't part of the device */
  hideNodes?: string[];
  /** Drop meshes whose names include these strings before fitting. Used to discard extra colorways that would stretch the bounding box. */
  dropNameIncludes?: string[];
  /** Optional laptop lid open/close rig */
  lid?: DeviceLidConfig;
  /**
   * Licence clarity for commercial mockup-generator use.
   * `needs_review` must be checked with counsel before relying on the mesh commercially.
   */
  licenseClarity?: ModelLicenseClarity;
  /** Short note shown in Legal / Credits context when clarity is limited. */
  licenseNote?: string;
}

export function categoryOfDevice(device: Pick<DeviceModel, 'id' | 'category'>): DeviceCategoryId {
  if (device.category) return device.category;
  const id = String(device.id);
  if (/^generic_/.test(id)) return 'generic';
  if (/ipad|tablet|\btab_/.test(id)) return 'tablets';
  if (/imac|desktop|studio_display|homeview/.test(id)) return 'desktops';
  if (/macbook|laptop/.test(id)) return 'laptops';
  if (/watch/.test(id)) return 'watches';
  if (/airpods|mdr_|skullcandy|jbl_|headphone/.test(id)) return 'headphones';
  if (/vision_pro|spatial/.test(id)) return 'spatial';
  return 'phones';
}

/** Devices whose pack / Sketchfab terms do not clearly permit SaaS mockup use. */
export function deviceNeedsLicenseReview(device: Pick<DeviceModel, 'licenseClarity'>): boolean {
  return device.licenseClarity === 'needs_review' || device.licenseClarity === 'commercial_pack';
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
    licenseClarity: 'cc_by',
    licenseNote: 'No separate logo mesh found — check albedo for baked marks before release.',
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
    rot: [0, Math.PI / 2, 0],
    uv: { repeat: [1, -1] },
    glassMats: ['glass.002', 'lensinglass'],
    // Metal squares glued to the bottom edge of the Sketchfab mesh + back Apple logo.
    hideNodes: ['Plane.013_metaL.001_0', 'Plane.014_metaL.001_0', 'Cube.014_apple logo.001_0'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'iphone_17_pro',
    label: 'iPhone 17 Pro',
    subtitle: 'iOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_17_pro.glb',
    screenMat: 'screen',
    screenSize: { width: 1206, height: 2622 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['glass', 'camera glass', 'flash glass', 'lens'],
    lockMaterials: true,
    hideNodes: ['Cube'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'iphone_17_pro_max',
    label: 'iPhone 17 Pro Max',
    subtitle: 'iOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_17_pro_max.glb',
    screenMat: 'screen.1',
    screenSize: { width: 1320, height: 2868 },
    rot: [0, Math.PI, 0],
    uv: { planar: true },
    glassMats: ['camera glass.1', 'flash glass', 'lens.1'],
    lockMaterials: true,
    hideNodes: ['Cube'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'iphone_duo',
    label: 'iPhone Duo',
    subtitle: 'iOS · Foldable concept',
    platform: 'ios',
    kind: 'gltf',
    category: 'phones',
    url: './models/iphone_duo.glb',
    screenMat: 'Screen',
    screenSize: { width: 2064, height: 2752 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['Glass'],
    lockMaterials: true,
    lid: {
      mode: 'fold',
      wing: ['Base_02', 'Screen_02', 'Glass_Screen_02', 'Lens_01'],
      splitSpans: ['Screen_01', 'Glass_Screen_01'],
      wingSide: 'min',
      axis: 'y',
      closeAngle: Math.PI,
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
    rot: [Math.PI / 2, -Math.PI / 2, Math.PI / 2],
    uv: { flipY: true, clamp: true, planar: true },
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
    hideNodes: ['BackBody..001_Logo_0'],
    licenseClarity: 'cc_by',
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
    // Google wordmark lives on material Google.002 (Object_10) — auto-hidden by brandMarks.
    licenseClarity: 'cc_by',
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
    hideNodes: ['BackBody..001_Logo_0'],
    licenseClarity: 'cc_by',
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
    subtitle: 'iOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_13_pro_max.glb',
    screenMat: 'Wallpaper',
    screenSize: { width: 1284, height: 2778 },
    rot: [0, Math.PI, 0],
    uv: { flipY: true, mirrorX: true },
    glassMats: ['Glass', 'Screen_Glass', 'Camera_Glass', 'Gray_Glass', 'Black_Glass', 'Lens'],
    hideNodes: ['Apple Logo', 'Apple Logo_Logo_0'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'galaxy_s21_ultra',
    label: 'Galaxy S21 Ultra',
    subtitle: 'Android',
    platform: 'android',
    kind: 'gltf',
    url: './models/galaxy_s21_ultra.glb',
    screenMat: 'Screen',
    screenSize: { width: 1440, height: 3200 },
    rot: [0, Math.PI, 0],
    uv: { flipY: true },
    glassMats: ['Glass', 'Lens', 'Lens.001'],
    hideNodes: ['Logo', 'Logo_BodyFrame_0'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'ipad_mini_6',
    label: 'iPad mini 6',
    subtitle: 'iPadOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/ipad_mini_6.glb',
    screenMat: 'Screen',
    screenSize: { width: 1488, height: 2266 },
    rot: [0, Math.PI, 0],
    uv: { mirrorX: true, flipY: true },
    glassMats: ['CamGlass', 'Lens'],
    hideNodes: ['iPad Mini_BaseColorLogo_0'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'macbook_pro_13_2020',
    label: 'MacBook Pro 13″ (2020)',
    subtitle: 'macOS',
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
    glassMats: ['Glass_Clear2'],
    lockMaterials: true,
  },
  {
    id: 'airpods_pro',
    label: 'AirPods Pro',
    subtitle: 'Audio · SceneView',
    platform: 'ios',
    kind: 'gltf',
    category: 'headphones',
    url: './models/airpods_pro.glb',
    screenMat: 'cEVcwrpGKjNUrED',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, Math.PI / 2, -Math.PI / 2],
    uv: {},
    glassMats: ['czaVLhHNccVShhr', 'OXPzgZBrHvcYhRk'],
    // Authored white plastic + glossy case — never paint finish swatches / fake a screen.
    hasScreen: false,
    lockMaterials: true,
    // Soft gloss + clearcoat so the case picks up studio softboxes (stock GLB is too matte).
    tweaks: {
      DrEQLAPBkLNlpSM: {
        roughness: 0.28, metalness: 0, envMapIntensity: 1.15,
        clearcoat: 0.62, clearcoatRoughness: 0.22,
      },
      FJixwyYXpYmTghW: {
        roughness: 0.32, metalness: 0.08, envMapIntensity: 1.05,
        clearcoat: 0.48, clearcoatRoughness: 0.26,
      },
      BQKMNbgpcCWqzPH: {
        roughness: 0.2, metalness: 0, envMapIntensity: 1.2,
        clearcoat: 0.72, clearcoatRoughness: 0.16,
      },
      EGgayDtrTMexFep: {
        roughness: 0.36, metalness: 0, envMapIntensity: 0.95,
        clearcoat: 0.4, clearcoatRoughness: 0.3,
      },
      czaVLhHNccVShhr: {
        roughness: 0.06, metalness: 0.15, envMapIntensity: 1.85,
        clearcoat: 1, clearcoatRoughness: 0.04,
      },
      OXPzgZBrHvcYhRk: {
        roughness: 0.02, metalness: 0.05, envMapIntensity: 2.0,
        clearcoat: 1, clearcoatRoughness: 0.03,
      },
    },
  },
  {
    id: 'sony_mdr_7506',
    label: 'Sony MDR-7506',
    subtitle: 'Audio · CC BY',
    platform: 'android',
    kind: 'gltf',
    category: 'headphones',
    url: './models/sony_mdr_7506.glb',
    screenMat: 'pasted__headphones1',
    screenSize: { width: 1024, height: 1024 },
    // Authored upright: tall Y, thin Z (front silhouette)
    rot: [0, 0, 0],
    uv: {},
    hasScreen: false,
    lockMaterials: true,
  },
  {
    id: 'skullcandy_crusher',
    label: 'Skullcandy Crusher',
    subtitle: 'Audio · CC BY',
    platform: 'android',
    kind: 'gltf',
    category: 'headphones',
    url: './models/skullcandy_crusher.glb',
    screenMat: 'M_Skullcandy_Crusher',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, 0, 0],
    uv: {},
    hasScreen: false,
    lockMaterials: true,
  },
  {
    id: 'jbl_tour_one_m3',
    label: 'JBL Tour One M3',
    subtitle: 'Audio',
    platform: 'android',
    kind: 'gltf',
    category: 'headphones',
    url: './models/jbl_tour_one_m3.glb',
    screenMat: 'Black',
    screenSize: { width: 1024, height: 1024 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Button_Glossy', 'Ring', 'Icons'],
    hideNodes: ['JBL_Logo_Inner_14', 'Button_Logo_19', 'JBL_Logo_Outer_21'],
    hasScreen: false,
    lockMaterials: true,
    licenseClarity: 'cc_by',
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
    subtitle: 'iOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_18_pro_max.glb',
    screenMat: 'Black',
    screenSize: { width: 1320, height: 2868 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['Glass'],
    lockMaterials: true,
    hideNodes: ['Apple'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'iphone_18_pro',
    label: 'iPhone 18 Pro',
    subtitle: 'iOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_18_pro.glb',
    screenMat: 'Black',
    screenSize: { width: 1206, height: 2622 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['Glass'],
    lockMaterials: true,
    hideNodes: ['Apple'],
    licenseClarity: 'cc_by',
  },
  {
    id: 'iphone_18',
    label: 'iPhone 18',
    subtitle: 'iOS · Concept',
    platform: 'ios',
    kind: 'gltf',
    url: './models/iphone_18.glb',
    screenMat: 'OLED',
    screenSize: { width: 1206, height: 2622 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Glass', 'Tinted glass', 'Frosted glass', 'Camera sapphire miror', 'Camera Lens'],
    tweaks: {
      'Display Frame': {
        color: 0x000000, emissive: 0x0d0d0f, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
      'OLED off': {
        color: 0x000000, emissive: 0x0d0d0f, emissiveIntensity: 1,
        metalness: 0, roughness: 1, envMapIntensity: 0, toneMapped: false,
      },
    },
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
    subtitle: 'visionOS · Spatial headset',
    platform: 'ios',
    kind: 'gltf',
    url: './models/apple_vision_pro.glb',
    screenMat: 'FAJMtZQLswdvuhO',
    screenSize: { width: 3660, height: 3200 },
    rot: [0, Math.PI, Math.PI / 2],
    uv: {},
    glassMats: ['NLAQCwOxsrAPIlV', 'LlnrRvRtBSKKJtZ', 'FOugkDgsmvxAjLB', 'nctcFIvFhZfKDLQ'],
    lockMaterials: true,
    licenseClarity: 'cc_by',
  },
  {
    id: 'apple_watch_ultra_2',
    label: 'Apple Watch Ultra 2',
    subtitle: 'watchOS',
    platform: 'ios',
    kind: 'gltf',
    url: './models/apple_watch_ultra_2.glb',
    screenMat: 'edYkGGAdRWeopLP',
    screenSize: { width: 410, height: 502 },
    rot: [Math.PI, Math.PI, 0],
    uv: { mirrorX: true },
    glassMats: ['VJcIxaYCeMHzzAJ', 'EbFYvXZFEOELnji', 'IsuszdatyklnjoT', 'JlRKetQcktLwJwa'],
    lockMaterials: true,
  },
  {
    id: 'pixel_watch',
    label: 'Pixel Watch 5',
    subtitle: 'Wear OS · 41mm',
    platform: 'android',
    kind: 'gltf',
    category: 'watches',
    url: './models/pixel_watch.glb',
    screenMat: 'replaceable_screen_black',
    screenSize: { width: 450, height: 450 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Gorilla_Glass_5_black_high_gloss_clearcoat', 'optical_sensor_glass'],
    lockMaterials: true,
  },
  {
    id: 'galaxy_z_flip8',
    label: 'Galaxy Z Flip 8',
    subtitle: 'Android · Graphite',
    platform: 'android',
    kind: 'gltf',
    category: 'phones',
    url: './models/galaxy_z_flip8.glb',
    // Screen mesh shares the Graphite atlas with the body — isolated at load.
    screenMat: 'Graphite',
    screenSize: { width: 1080, height: 2640 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['Glass'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack GLB — verify licence covers a commercial mockup generator.',
  },
  {
    id: 'galaxy_z_fold8',
    label: 'Galaxy Z Fold 8',
    subtitle: 'Android · Graphite',
    platform: 'android',
    kind: 'gltf',
    category: 'phones',
    url: './models/galaxy_z_fold8.glb',
    screenMat: 'Screen_Graphite',
    screenSize: { width: 1968, height: 2184 },
    rot: [0, Math.PI, Math.PI / 2],
    uv: { planar: true },
    glassMats: ['Glass', 'Glass.001'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack GLB — verify licence covers a commercial mockup generator.',
    // Left cover + half of the spanning inner screen swing closed around Y.
    lid: {
      mode: 'fold',
      wing: ['Base_L', 'Screen_02', 'Glass_Screen_02', 'Lens_02'],
      splitSpans: ['Screen_01', 'Glass_Screen_01'],
      wingSide: 'min',
      axis: 'y',
      closeAngle: Math.PI,
    },
  },
  {
    id: 'galaxy_z_fold8_ultra',
    label: 'Galaxy Z Fold 8 Ultra',
    subtitle: 'Android · Graphite',
    platform: 'android',
    kind: 'gltf',
    category: 'phones',
    url: './models/galaxy_z_fold8_ultra.glb',
    screenMat: 'Screen_Graphite',
    screenSize: { width: 1920, height: 2160 },
    rot: [0, Math.PI, 0],
    uv: { planar: true },
    glassMats: ['Glass', 'Glass.001'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack GLB — verify licence covers a commercial mockup generator.',
    lid: {
      mode: 'fold',
      wing: ['Base_L', 'Screen_02', 'Glass_Screen_02', 'Lens_02'],
      splitSpans: ['Screen_01', 'Glass_Screen_01'],
      wingSide: 'min',
      axis: 'y',
      closeAngle: Math.PI,
    },
  },
  {
    id: 'apple_homeview',
    label: 'HomeView',
    subtitle: 'Desktop · Concept display',
    platform: 'ios',
    kind: 'gltf',
    category: 'desktops',
    url: './models/apple_homeview.glb',
    screenMat: 'screen',
    screenSize: { width: 1920, height: 1440 },
    // Blender glTF: tip so the pad sits on -Y and the hinged display faces +Z.
    rot: [-Math.PI / 2, 0, 0],
    uv: { planar: true },
    glassMats: ['Camera:0:0:0 #1', 'Camera:0:0:0 #2', 'Camera:0:0:0 #3'],
    lockMaterials: true,
    hideNodes: ['logo', 'logo.001', 'logo.002'],
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack asset — confirm SaaS / mockup-generator rights before commercial release.',
  },
  {
    id: 'apple_watch_series_12',
    label: 'Apple Watch Series 12',
    subtitle: 'watchOS · 46mm',
    platform: 'ios',
    kind: 'gltf',
    category: 'watches',
    url: './models/apple_watch_series_12.glb',
    screenMat: 'screen',
    screenSize: { width: 422, height: 514 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['frame gold', 'crown ring gold'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Converted from a commercial DCC pack — redistribution OK note is unverified for SaaS mockup use.',
  },
  {
    id: 'pixel_fold',
    label: 'Pixel 11 Pro Fold',
    subtitle: 'Android · Obsidian',
    platform: 'android',
    kind: 'gltf',
    category: 'phones',
    url: './models/pixel_fold.glb',
    screenMat: 'Screen',
    screenSize: { width: 2076, height: 2152 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Glass'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack GLB — verify licence covers a commercial mockup generator.',
    lid: {
      mode: 'fold',
      wing: [
        'Fold_Base_02',
        'Fold_Screen_02',
        'Fold_Glass_Screen_02',
        'Fold_Lens_02',
        'Fold_Plastic_02',
        'Fold_iron_02',
      ],
      splitSpans: ['Fold_Screen_01', 'Fold_Glass_Screen_01'],
      wingSide: 'min',
      axis: 'y',
      closeAngle: Math.PI,
    },
  },
  {
    id: 'pixel_watch_7',
    label: 'Pixel Watch 7',
    subtitle: 'Wear OS',
    platform: 'android',
    kind: 'gltf',
    category: 'watches',
    url: './models/pixel_watch_7.glb',
    screenMat: 'screen',
    screenSize: { width: 450, height: 450 },
    rot: [0, Math.PI / 2, 0],
    uv: {},
    glassMats: ['glass'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial pack FBX → GLB — confirm mockup-generator rights.',
    // Source pack used a vivid blue rubber placeholder + chrome metals.
    tweaks: {
      Brass: { metalness: 1, roughness: 0.35, envMapIntensity: 0.55 },
      rubber: { color: 0x121214, metalness: 0, roughness: 0.8, envMapIntensity: 0.25 },
      shiny: { color: 0x95989c, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.4 },
      'shiny.001': { color: 0x95989c, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.4 },
      shine2: { color: 0x8e9196, metalness: 0.4, roughness: 0.45, envMapIntensity: 0.35 },
    },
  },
  {
    id: 'ipad_pro_m5',
    label: 'iPad Pro M5',
    subtitle: 'iPadOS · 13″',
    platform: 'ios',
    kind: 'gltf',
    category: 'tablets',
    url: './models/ipad_pro_m5.glb',
    screenMat: 'Display',
    screenSize: { width: 2064, height: 2752 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['transparent glass', 'foggy glass', 'camera lens'],
    lockMaterials: true,
    hideNodes: ['Cube_1'],
    licenseClarity: 'needs_review',
    licenseNote: 'Apple Products 2026 pack FBX — confirm SaaS / mockup-generator rights.',
  },
  {
    id: 'macbook_pro_m5',
    label: 'MacBook Pro M5 14″',
    subtitle: 'macOS',
    platform: 'ios',
    kind: 'gltf',
    category: 'laptops',
    url: './models/macbook_pro_m5.glb',
    screenMat: 'screen',
    screenSize: { width: 3024, height: 1964 },
    rot: [0, 0, 0],
    uv: { planar: true },
    glassMats: ['glass transparent', 'pearly glass', 'pearly glass cyan'],
    lockMaterials: true,
    hideNodes: ['Cube', 'Extrude', 'Extrude_2'],
    lid: { mode: 'hinge', nodes: ['rotate_screen', 'screen', 'black bezel'], closeAngle: 1.55, hingeZ: 'max' },
    licenseClarity: 'needs_review',
    licenseNote: 'Apple Products 2026 pack FBX — confirm SaaS / mockup-generator rights.',
  },
  {
    id: 'imac_24',
    label: 'iMac 24″',
    subtitle: 'macOS · 2021',
    platform: 'ios',
    kind: 'gltf',
    category: 'desktops',
    url: './models/imac_24.glb',
    screenMat: 'Screen',
    screenSize: { width: 4480, height: 2520 },
    rot: [0, 0, 0],
    uv: {},
    glassMats: ['Glass', 'Lens'],
    lockMaterials: true,
    // GLB ships seven colorways in a row; keep the origin iMac only.
    dropNameIncludes: ['Plane003', 'Plane004', 'Plane005', 'Plane006', 'Plane007', 'Plane008'],
    licenseClarity: 'needs_review',
    licenseNote: 'Commercial iMac colors pack — confirm mockup-generator rights.',
  },
  {
    id: 'imac_m4',
    label: 'iMac M4',
    subtitle: 'macOS · 24″',
    platform: 'ios',
    kind: 'gltf',
    category: 'desktops',
    url: './models/imac_m4.glb',
    screenMat: 'screen',
    screenSize: { width: 4480, height: 2520 },
    rot: [0, Math.PI, 0],
    uv: {},
    glassMats: ['pearly glass cyan'],
    lockMaterials: true,
    licenseClarity: 'needs_review',
    licenseNote: 'Apple Products 2026 pack FBX — confirm SaaS / mockup-generator rights.',
  },
  {
    id: 'generic_smartphone',
    label: 'Smartphone',
    subtitle: 'Generic · No brand marks',
    platform: 'ios',
    kind: 'procedural',
    category: 'generic',
    procedural: 'phone',
    finish: '#c8ccd1',
    screenMat: 'ProceduralScreen',
    screenSize: { width: 1170, height: 2532 },
    rot: [0, 0, 0],
    uv: {},
    licenseClarity: 'procedural',
  },
  {
    id: 'generic_tablet',
    label: 'Tablet',
    subtitle: 'Generic · No brand marks',
    platform: 'ios',
    kind: 'procedural',
    category: 'generic',
    procedural: 'tablet',
    finish: '#d2d5da',
    screenMat: 'ProceduralScreen',
    screenSize: { width: 1668, height: 2388 },
    rot: [0, 0, 0],
    uv: {},
    licenseClarity: 'procedural',
  },
  {
    id: 'generic_laptop',
    label: 'Laptop',
    subtitle: 'Generic · No brand marks',
    platform: 'ios',
    kind: 'procedural',
    category: 'generic',
    procedural: 'laptop',
    finish: '#b8bcc0',
    screenMat: 'ProceduralScreen',
    screenSize: { width: 2560, height: 1600 },
    rot: [0, 0, 0],
    uv: {},
    lid: { mode: 'hinge', nodes: ['GenericLid'], closeAngle: Math.PI * (110 / 180) },
    licenseClarity: 'procedural',
  },
];

/** Same mesh as an existing model, with its own library name and thumbnail. */
function listedVariant(
  sourceId: BuiltinDeviceId,
  id: BuiltinDeviceId,
  label: string,
  subtitle: string,
  category?: DeviceCategoryId,
  platform?: DevicePlatform,
): DeviceModel {
  const source = DEVICE_MODELS.find((device) => device.id === sourceId);
  if (!source) throw new Error(`Missing device ${sourceId}`);
  return {
    ...source,
    id,
    label,
    subtitle,
    platform: platform ?? source.platform,
    category: category ?? categoryOfDevice(source),
    screenSize: { ...source.screenSize },
    rot: [...source.rot],
    uv: { ...source.uv },
    tweaks: source.tweaks ? { ...source.tweaks } : undefined,
  };
}

DEVICE_MODELS.push(
  listedVariant('iphone_17_pro', 'iphone_17', 'iPhone 17', 'iOS'),
  listedVariant('iphone_18_pro', 'iphone_air', 'iPhone Air', 'iOS'),
  listedVariant('galaxy_s26_ultra', 'galaxy_s26_plus', 'Galaxy S26+', 'Android', 'phones', 'android'),
  listedVariant('galaxy_s26_ultra', 'galaxy_s26', 'Galaxy S26', 'Android', 'phones', 'android'),
  listedVariant('pixel_9', 'pixel_11', 'Pixel 11', 'Android', 'phones', 'android'),
  listedVariant('pixel_10_pro', 'pixel_11_pro', 'Pixel 11 Pro', 'Android', 'phones', 'android'),
  listedVariant('pixel_9_pro_xl', 'pixel_11_pro_xl', 'Pixel 11 Pro XL', 'Android', 'phones', 'android'),
  listedVariant('apple_watch_ultra_2', 'apple_watch_ultra_4', 'Apple Watch Ultra 4', 'watchOS', 'watches'),
  listedVariant('apple_watch_series_7', 'apple_watch_se_3', 'Apple Watch SE 3', 'watchOS', 'watches'),
);

import {
  customMetaToDeviceModel,
  getCustomDeviceObjectUrl,
  isCustomDeviceId,
  loadCustomDeviceMeta,
  resolveCustomDevice,
} from './customDevices';

export { isCustomDeviceId };

/** Bump when replacing public/models GLBs so useGLTF / HTTP caches reload textures. */
export const DEVICE_MODEL_PACK_VERSION = 'texpack3';

/** Cache-bust relative model URLs; leave blob / absolute URLs alone. */
export function deviceAssetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(blob:|data:|https?:)/i.test(url)) return url;
  const marker = `v=${DEVICE_MODEL_PACK_VERSION}`;
  if (url.includes(marker)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${marker}`;
}

/**
 * Versioned builtin models — cached so callers get a stable object identity.
 * Returning `{ ...builtin, url }` on every getDevice() made React effects that
 * depend on `device` re-run every parent render (screen placeholder flicker).
 */
const versionedDeviceCache = new Map<string, DeviceModel>();

export function getDevice(id: DeviceId | string | undefined): DeviceModel {
  const builtin = DEVICE_MODELS.find((d) => d.id === id);
  if (builtin) {
    const cached = versionedDeviceCache.get(builtin.id);
    if (cached) return cached;
    const url = deviceAssetUrl(builtin.url);
    const model = url && url !== builtin.url ? { ...builtin, url } : builtin;
    versionedDeviceCache.set(builtin.id, model);
    return model;
  }
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
