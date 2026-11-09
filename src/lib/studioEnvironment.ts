import type { BackgroundPreset, GradientColors, Vec3 } from '../types';

/**
 * Virtual product-photography studio.
 * Presets drive backdrop colour, lighting balance, shadows, and HDRI intensity
 * so new projects look finished without manual light setup.
 */

export type StudioPresetId = 'dark' | 'light' | 'transparent';

export interface StudioLightDef {
  /** World-space position relative to the framed product. */
  position: Vec3;
  /** Softbox width × height in world units. */
  size: [number, number];
  /** Kelvin-ish CSS colour for the emitter. */
  color: string;
  /** Relative intensity multiplier (scaled by project key/fill). */
  intensity: number;
}

export interface StudioPreset {
  id: StudioPresetId;
  /** Maps onto BuiltinBackgroundId when applicable. */
  backgroundId: BackgroundPreset;
  label: string;
  description: string;
  /** Visible cyclorama / sky colours. Null for transparent export. */
  gradient: GradientColors | null;
  /** Clear colour behind the sky when not transparent. */
  clearColor: string;
  /** Scene environment (HDRI) intensity for PBR reflections. */
  environmentIntensity: number;
  /** ACES exposure for this look. */
  toneMappingExposure: number;
  /** Show infinite floor / cyclorama sweep under the product. */
  showCyclorama: boolean;
  /** Soft ground disc when cyclorama is off. */
  showGroundDisc: boolean;
  /** Contact-shadow defaults for this look. */
  shadow: {
    opacityScale: number;
    blurScale: number;
    color: string;
    far: number;
    scale: number;
  };
  /** Softbox / bounce luminaires (directional key still casts shadows). */
  key: StudioLightDef;
  fill: StudioLightDef;
  rim: StudioLightDef;
  groundBounce: {
    color: string;
    intensity: number;
  };
  hemisphere: {
    sky: string;
    ground: string;
    intensityScale: number;
  };
  ambientScale: number;
}

/** Charcoal seamless studio — wall / sky / floor read as three distinct stops. */
export const DARK_STUDIO_GRADIENT: GradientColors = {
  center: '#6b707a',
  mid: '#3a3f48',
  edge: '#1a1c21',
};

export const LIGHT_STUDIO_GRADIENT: GradientColors = {
  center: '#ffffff',
  mid: '#f4f4f6',
  edge: '#e6e6ea',
};

/** Warm key softbox — above and slightly to one side, daylight product photography. */
const SHARED_KEY: StudioLightDef = {
  position: { x: 3.8, y: 5.8, z: 5.6 },
  size: [5.2, 3.8],
  color: '#fff4e8',
  intensity: 1,
};

/** Cool bounce fill opposite the key — wrap only, no competing hard shadows. */
const SHARED_FILL: StudioLightDef = {
  position: { x: -4.0, y: 2.8, z: 3.4 },
  size: [4.2, 3.2],
  color: '#eaf0ff',
  intensity: 0.4,
};

/** Narrow hair/rim for edge separation on dark / metal devices. */
const SHARED_RIM: StudioLightDef = {
  position: { x: -1.6, y: 5.4, z: -4.0 },
  size: [0.55, 3.8],
  color: '#f5f8ff',
  intensity: 0.62,
};

export const STUDIO_PRESETS: Record<StudioPresetId, StudioPreset> = {
  dark: {
    id: 'dark',
    backgroundId: 'midnight',
    label: 'Dark Studio',
    description: 'Charcoal seamless, soft ambient wrap',
    gradient: DARK_STUDIO_GRADIENT,
    clearColor: '#1a1c21',
    // Soft IBL + neutral exposure — ambient wrap first, not a softbox blast.
    environmentIntensity: 0.55,
    toneMappingExposure: 1.08,
    showCyclorama: true,
    showGroundDisc: false,
    shadow: {
      opacityScale: 0.92,
      blurScale: 1.08,
      color: '#12141a',
      far: 8,
      scale: 10,
    },
    key: { ...SHARED_KEY, color: '#fff1e2', intensity: 1 },
    fill: { ...SHARED_FILL, intensity: 0.42 },
    rim: { ...SHARED_RIM, color: '#e8f0ff', intensity: 0.38 },
    groundBounce: { color: '#b8b4ac', intensity: 0.14 },
    hemisphere: { sky: '#fff6ec', ground: '#16181c', intensityScale: 0.62 },
    ambientScale: 0.48,
  },
  light: {
    id: 'light',
    backgroundId: 'studio',
    label: 'Light Studio',
    description: 'Soft white cyclorama, natural ambient studio light',
    gradient: LIGHT_STUDIO_GRADIENT,
    clearColor: '#e6e6ea',
    environmentIntensity: 0.5,
    toneMappingExposure: 1.05,
    showCyclorama: true,
    showGroundDisc: false,
    shadow: {
      opacityScale: 0.96,
      blurScale: 1.08,
      color: '#1a1c22',
      far: 7.5,
      scale: 9.5,
    },
    key: { ...SHARED_KEY, color: '#ffffff', intensity: 1 },
    fill: { ...SHARED_FILL, color: '#f4f6ff', intensity: 0.5 },
    rim: { ...SHARED_RIM, color: '#ffffff', intensity: 0.28 },
    groundBounce: { color: '#ffffff', intensity: 0.16 },
    // Soft sky wrap + slightly darker ground so form still reads.
    hemisphere: { sky: '#ffffff', ground: '#d8d8d8', intensityScale: 0.7 },
    ambientScale: 0.52,
  },
  transparent: {
    id: 'transparent',
    backgroundId: 'transparent',
    label: 'Transparent Studio',
    description: 'Clear background for PNG/WebP, lighting retained',
    gradient: null,
    clearColor: '#16191f',
    environmentIntensity: 0.58,
    toneMappingExposure: 1.08,
    showCyclorama: false,
    showGroundDisc: true,
    shadow: {
      opacityScale: 0.95,
      blurScale: 1.08,
      color: '#1a1c22',
      far: 6,
      scale: 8,
    },
    key: { ...SHARED_KEY, intensity: 1 },
    fill: { ...SHARED_FILL, intensity: 0.48 },
    rim: { ...SHARED_RIM, intensity: 0.32 },
    groundBounce: { color: '#8a8782', intensity: 0.12 },
    hemisphere: { sky: '#fff6ec', ground: '#8a8782', intensityScale: 0.72 },
    ambientScale: 0.5,
  },
};

function isBrightWhiteGradient(colors?: GradientColors | null): boolean {
  if (!colors) return false;
  const bright = (hex: string, floor = 230) => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    if (!Number.isFinite(n)) return false;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return Math.min(r, g, b) >= floor;
  };
  // Soft Apple cycloramas keep a slightly cooler edge — still light-studio lighting.
  return bright(colors.center, 245) && bright(colors.mid, 235) && bright(colors.edge, 220);
}

/** Resolve the photography-studio look from a project background id. */
export function resolveStudioPreset(
  background: BackgroundPreset,
  colors?: GradientColors | null,
): StudioPreset {
  if (background === 'transparent') return STUDIO_PRESETS.transparent;
  if (background === 'studio') return STUDIO_PRESETS.light;
  if (background === 'midnight') return STUDIO_PRESETS.dark;
  // Pure-white custom / edited looks should keep the light cyclorama, not dark lighting.
  if (isBrightWhiteGradient(colors)) {
    return {
      ...STUDIO_PRESETS.light,
      backgroundId: background,
    };
  }
  // Coloured built-ins keep a soft cyclorama with balanced product lighting.
  return {
    ...STUDIO_PRESETS.light,
    id: 'light',
    backgroundId: background,
    showCyclorama: true,
    showGroundDisc: false,
    clearColor: colors?.edge ?? STUDIO_PRESETS.light.clearColor,
    gradient: colors ? { ...colors } : STUDIO_PRESETS.light.gradient,
  };
}

export function isStudioCycloramaBackground(background: BackgroundPreset): boolean {
  return background !== 'transparent';
}

/** Default key-light placement for new projects (upper front-left softbox). */
export const DEFAULT_STUDIO_KEY_POSITION: Vec3 = { ...SHARED_KEY.position };
export const DEFAULT_STUDIO_KEY_COLOR = '#fff8f0';
export const DEFAULT_STUDIO_KEY_INTENSITY = 0.9;
export const DEFAULT_STUDIO_FILL_INTENSITY = 1.05;
export const DEFAULT_STUDIO_SHADOW_SOFTNESS = 4.2;
export const DEFAULT_STUDIO_SHADOW_OPACITY = 0.28;

/**
 * Fitted device height in world units. Every model is scaled so its upright
 * height matches this — then a centered device sits just above the studio floor
 * with a soft contact shadow underneath.
 */
export const STUDIO_DEVICE_HEIGHT = 3;
/** Soft gap between the device bottom and the contact-shadow floor. */
export const STUDIO_GROUND_CLEARANCE = 0.02;
/** World Y of the studio floor / contact shadow plane. */
export const STUDIO_FLOOR_Y = -(STUDIO_DEVICE_HEIGHT / 2) - STUDIO_GROUND_CLEARANCE;

/** Front-facing rest pose every new / switched model starts in. */
export const STUDIO_START_ROTATION: Vec3 = { x: 0, y: 0, z: 0 };
export const STUDIO_START_POSITION: Vec3 = { x: 0, y: 0, z: 0 };
