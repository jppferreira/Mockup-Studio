import * as THREE from 'three';
import { physicalFromAuthored } from './materialFidelity';

/**
 * Reusable PBR material looks for props / overrides.
 *
 * Critical: device GLB materials and textures must stay intact.
 * Call `applyMaterialPreset` only when the user explicitly picks a finish,
 * or when a mesh has no usable material of its own.
 */

export type MaterialPresetId =
  | 'brushed_aluminium'
  | 'polished_titanium'
  | 'stainless_steel'
  | 'glossy_glass'
  | 'matte_glass'
  | 'ceramic'
  | 'rubber'
  | 'plastic'
  | 'oled_display';

export interface MaterialPreset {
  id: MaterialPresetId;
  label: string;
  description: string;
  color: string;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  specularIntensity?: number;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'brushed_aluminium',
    label: 'Brushed aluminium',
    description: 'Soft anodized metal with directional sheen',
    color: '#c5c8ce',
    metalness: 0.92,
    roughness: 0.38,
    envMapIntensity: 0.85,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
  },
  {
    id: 'polished_titanium',
    label: 'Polished titanium',
    description: 'Cool grey mirror metal',
    color: '#9ea3ab',
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.15,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
  },
  {
    id: 'stainless_steel',
    label: 'Stainless steel',
    description: 'Bright industrial chrome-steel',
    color: '#d8dcdd',
    metalness: 1,
    roughness: 0.22,
    envMapIntensity: 1.05,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
  },
  {
    id: 'glossy_glass',
    label: 'Glossy glass',
    description: 'Clear coat glass with strong reflections',
    color: '#e8eef8',
    metalness: 0,
    roughness: 0.04,
    envMapIntensity: 1.8,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transmission: 0.92,
    thickness: 0.35,
    ior: 1.5,
    opacity: 1,
    transparent: true,
  },
  {
    id: 'matte_glass',
    label: 'Matte glass',
    description: 'Frosted glass, soft environment pickup',
    color: '#eef1f5',
    metalness: 0,
    roughness: 0.55,
    envMapIntensity: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    transmission: 0.55,
    thickness: 0.4,
    ior: 1.45,
    opacity: 1,
    transparent: true,
  },
  {
    id: 'ceramic',
    label: 'Ceramic',
    description: 'Smooth porcelain body',
    color: '#f2f0ec',
    metalness: 0,
    roughness: 0.42,
    envMapIntensity: 0.4,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
  },
  {
    id: 'rubber',
    label: 'Rubber',
    description: 'Soft matte elastomer',
    color: '#1c1d20',
    metalness: 0,
    roughness: 0.92,
    envMapIntensity: 0.12,
    clearcoat: 0.05,
    clearcoatRoughness: 0.85,
  },
  {
    id: 'plastic',
    label: 'Plastic',
    description: 'Injection-moulded polymer',
    color: '#eceff3',
    metalness: 0,
    roughness: 0.48,
    envMapIntensity: 0.35,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  },
  {
    id: 'oled_display',
    label: 'OLED display',
    description: 'Black glass panel for screen surfaces',
    color: '#050506',
    metalness: 0.05,
    roughness: 0.22,
    envMapIntensity: 1.1,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    emissive: '#000000',
    emissiveIntensity: 0,
    specularIntensity: 1,
  },
];

export function getMaterialPreset(id: MaterialPresetId): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find((preset) => preset.id === id);
}

/** Flatten a preset into a material-tweak record for DEV modeling overrides. */
export function tweakFromPreset(id: MaterialPresetId): Record<string, number | boolean | string> {
  const preset = getMaterialPreset(id);
  if (!preset) return {};
  const tweak: Record<string, number | boolean | string> = {
    color: preset.color,
    metalness: preset.metalness,
    roughness: preset.roughness,
    envMapIntensity: preset.envMapIntensity,
  };
  if (preset.clearcoat != null) tweak.clearcoat = preset.clearcoat;
  if (preset.clearcoatRoughness != null) tweak.clearcoatRoughness = preset.clearcoatRoughness;
  if (preset.transmission != null) tweak.transmission = preset.transmission;
  if (preset.thickness != null) tweak.thickness = preset.thickness;
  if (preset.ior != null) tweak.ior = preset.ior;
  if (preset.opacity != null) tweak.opacity = preset.opacity;
  if (preset.transparent != null) tweak.transparent = preset.transparent;
  if (preset.emissive != null) tweak.emissive = preset.emissive;
  if (preset.emissiveIntensity != null) tweak.emissiveIntensity = preset.emissiveIntensity;
  if (preset.specularIntensity != null) tweak.specularIntensity = preset.specularIntensity;
  return tweak;
}

/** Build a fresh physical material from a preset (does not mutate existing device mats). */
export function createMaterialFromPreset(id: MaterialPresetId): THREE.MeshPhysicalMaterial {
  const preset = getMaterialPreset(id);
  if (!preset) throw new Error(`Unknown material preset: ${id}`);
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(preset.color),
    metalness: preset.metalness,
    roughness: preset.roughness,
    envMapIntensity: preset.envMapIntensity,
    clearcoat: preset.clearcoat ?? 0,
    clearcoatRoughness: preset.clearcoatRoughness ?? 0.2,
    transmission: preset.transmission ?? 0,
    thickness: preset.thickness ?? 0,
    ior: preset.ior ?? 1.5,
    opacity: preset.opacity ?? 1,
    transparent: preset.transparent ?? false,
    emissive: new THREE.Color(preset.emissive ?? '#000000'),
    emissiveIntensity: preset.emissiveIntensity ?? 0,
    specularIntensity: preset.specularIntensity ?? 1,
  });
}

/**
 * Apply a preset onto an existing standard/physical material.
 * Preserves name, maps, and UV-related texture slots unless the preset
 * intentionally clears them for glass looks.
 */
export function applyMaterialPreset(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  id: MaterialPresetId,
): THREE.MeshPhysicalMaterial {
  const preset = getMaterialPreset(id);
  if (!preset) return material as THREE.MeshPhysicalMaterial;

  let target: THREE.MeshPhysicalMaterial;
  if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    target = material as THREE.MeshPhysicalMaterial;
  } else {
    target = physicalFromAuthored(material);
  }

  target.color.set(preset.color);
  target.metalness = preset.metalness;
  target.roughness = preset.roughness;
  target.envMapIntensity = preset.envMapIntensity;
  target.clearcoat = preset.clearcoat ?? 0;
  target.clearcoatRoughness = preset.clearcoatRoughness ?? 0.2;
  target.transmission = preset.transmission ?? 0;
  target.thickness = preset.thickness ?? 0;
  target.ior = preset.ior ?? 1.5;
  target.opacity = preset.opacity ?? 1;
  target.transparent = preset.transparent ?? false;
  target.emissive.set(preset.emissive ?? '#000000');
  target.emissiveIntensity = preset.emissiveIntensity ?? 0;
  if (typeof preset.specularIntensity === 'number') {
    target.specularIntensity = preset.specularIntensity;
  }
  target.needsUpdate = true;
  return target;
}
