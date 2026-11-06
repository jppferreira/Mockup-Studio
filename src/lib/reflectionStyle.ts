import { createContext } from 'react';
import * as THREE from 'three';

/** Finish of the reflection on glass and screens. Each value is a different shader look. */
export type ReflectionStyle = 'matte' | 'glossy' | 'mirror';

export const REFLECTION_STYLES: { id: ReflectionStyle; label: string }[] = [
  { id: 'matte', label: 'Matte' },
  { id: 'glossy', label: 'Glossy' },
  { id: 'mirror', label: 'Mirror' },
];

export interface ReflectionDrive {
  style: ReflectionStyle;
  /** 0–1 strength. Scales intensity; the style still owns roughness and clearcoat. */
  amount: number;
  clay: boolean;
}

export const SceneEnvMapContext = createContext<THREE.Texture | null>(null);

export const ReflectionDriveContext = createContext<ReflectionDrive>({
  style: 'glossy',
  amount: 0.55,
  clay: false,
});

export interface SurfaceLook {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
}

/**
 * Distinct looks. Screen/glass clearcoat roughness is clamped to 0.0525 in the
 * shader, so the base roughness is what separates a soft sheen from a mirror.
 */
const SCREEN_LOOK: Record<ReflectionStyle, SurfaceLook> = {
  matte: { roughness: 0.96, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.8, envMapIntensity: 0.16 },
  glossy: { roughness: 0.38, metalness: 0, clearcoat: 0.84, clearcoatRoughness: 0.22, envMapIntensity: 1.4 },
  mirror: { roughness: 0.02, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.8 },
};

const GLASS_LOOK: Record<ReflectionStyle, SurfaceLook> = {
  matte: { roughness: 0.86, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.72, envMapIntensity: 0.28 },
  glossy: { roughness: 0.12, metalness: 0.04, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 1.75 },
  mirror: { roughness: 0.012, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.1 },
};

export function normalizeReflectionStyle(value: unknown): ReflectionStyle | null {
  return value === 'matte' || value === 'glossy' || value === 'mirror' ? value : null;
}

/** Slider position that matches a style, so the strength control and the type stay together. */
export function amountForReflectionStyle(style: ReflectionStyle): number {
  if (style === 'matte') return 0.12;
  if (style === 'mirror') return 1;
  return 0.55;
}

export function reflectionStyleForAmount(amount: number): ReflectionStyle {
  if (amount < 0.28) return 'matte';
  if (amount >= 0.82) return 'mirror';
  return 'glossy';
}

export function surfaceLook(
  kind: 'screen' | 'glass',
  style: ReflectionStyle,
  amount: number,
  clay: boolean,
): SurfaceLook {
  const base = (kind === 'screen' ? SCREEN_LOOK : GLASS_LOOK)[clay ? 'matte' : style];
  const t = Math.min(1, Math.max(0, amount));
  const gain = clay ? 0.18 : 0.62 + t * 0.75;
  return {
    roughness: base.roughness,
    metalness: clay ? 0 : base.metalness,
    clearcoat: base.clearcoat * (clay ? 0.3 : 1),
    clearcoatRoughness: base.clearcoatRoughness,
    envMapIntensity: base.envMapIntensity * gain,
  };
}

/** Write the look onto a live physical material. Maps are cleared so the uniforms win. */
export function applySurfaceLook(
  material: THREE.MeshPhysicalMaterial,
  look: SurfaceLook,
  envMap: THREE.Texture | null,
) {
  material.envMap = envMap;
  material.roughness = look.roughness;
  material.metalness = look.metalness;
  material.clearcoat = look.clearcoat;
  material.clearcoatRoughness = look.clearcoatRoughness;
  material.envMapIntensity = look.envMapIntensity;
  material.roughnessMap = null;
  material.metalnessMap = null;
  material.transmission = 0;
  material.specularIntensity = 1;
  material.needsUpdate = true;
}
