import * as THREE from 'three';
import type { ShadowQuality, Vec3 } from '../types';

/**
 * Internal render quality.
 * - interactive: orbit / gizmo / playback — freeze maps, skip DoF/AO/grade
 * - studio: idle preview — full soft shadows + post
 * Export paths force studio quality with exportBoost (up to 4096 maps).
 */
export type StudioShadowMode = 'interactive' | 'studio';

/** Explicit quality tiers used by diagnostics and docs (maps onto mode + exportBoost). */
export type RenderQualityTier = 'interactive' | 'preview' | 'export';

/** Idle delay before progressive studio refinement (ms). */
export const STUDIO_SHADOW_IDLE_MS = 400;

/**
 * Suggested shadow-map budgets by tier.
 * Live preview keeps a stable 1024 atlas across interactive↔studio so mode flips
 * never dispose/reallocate. Export may bump to 2048/4096. Interactive freezes
 * updates and uses a thinner PCSS kernel instead of resizing the atlas mid-orbit.
 */
export const SHADOW_MAP_BUDGET = {
  interactive: 1024,
  preview: 1024,
  export: 4096,
} as const;

/** Accumulation samples for stationary preview / export. */
export const STUDIO_SHADOW_SAMPLES = {
  interactive: 1,
  preview: 40,
  high: 48,
  ultra: 64,
  export: 56,
} as const;

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _lightPos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _viewMatrix = new THREE.Matrix4();
const _corner = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** True for meshes that should cast into floor / key soft shadows. */
export function isShadowCasterMesh(mesh: THREE.Mesh): boolean {
  if (!mesh.visible || !mesh.castShadow) return false;
  if (mesh.userData?.contactShadowPlane || mesh.userData?.exportHide || mesh.userData?.isGizmoHandle) {
    return false;
  }
  if (mesh.userData?.orbitPickFloor || mesh.userData?.isStudioBackdrop || mesh.userData?.isStudioSky) return false;
  let current: THREE.Object3D | null = mesh;
  while (current) {
    if (!current.visible) return false;
    if (current.userData?.isGizmoHandle || current.userData?.isStudioBackdrop || current.userData?.isStudioSky) return false;
    if (current.userData?.contactShadowPlane || current.userData?.orbitPickFloor) return false;
    if ((current as THREE.Object3D & { isTransformControls?: boolean }).isTransformControls) return false;
    if ((current as THREE.Object3D & { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo) {
      return false;
    }
    if (current.userData?.deviceGrabId || current.userData?.propGrabId) return true;
    current = current.parent;
  }
  // Custom GLTF roots often cast without grab markers — include if castShadow was set.
  return mesh.castShadow === true && !mesh.userData?.skipShadowFit;
}

/** Same-frame reuse when key-light fit and floor-plate extent both ask. */
let casterBoundsFrame = -1;
let casterBoundsScene: THREE.Object3D | null = null;
const casterBoundsCache = new THREE.Box3();

/**
 * Expand world AABB of every relevant caster (devices + shadow-casting props).
 * Pass `frame` from R3F's clock/frame counter so multiple callers in one tick share work.
 */
export function collectCasterBounds(
  scene: THREE.Object3D,
  target: THREE.Box3,
  frame = -1,
): THREE.Box3 {
  if (
    frame >= 0
    && frame === casterBoundsFrame
    && casterBoundsScene === scene
    && !casterBoundsCache.isEmpty()
  ) {
    target.copy(casterBoundsCache);
    return target;
  }

  target.makeEmpty();
  // Dirty-only update — force=true rewalked the whole tree every shadow fit.
  scene.updateMatrixWorld();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !isShadowCasterMesh(mesh)) return;
    if (!mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    _box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    target.union(_box);
  });

  if (frame >= 0) {
    casterBoundsFrame = frame;
    casterBoundsScene = scene;
    casterBoundsCache.copy(target);
  }
  return target;
}

export type FittedShadowCamera = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** Half-extent useful for AccumulativeShadows / RandomizedLight `size`. */
  halfExtent: number;
  /** World-space centre of fitted casters. */
  center: THREE.Vector3;
};

/**
 * Fit an orthographic shadow camera to casters in the directional light's view,
 * with padding for rotation and projection onto a floor receiver.
 */
export function fitDirectionalShadowCamera(
  lightPosition: Vec3,
  lightTarget: Vec3,
  casterBounds: THREE.Box3,
  floorY: number,
  opts?: { padding?: number; minExtent?: number; maxExtent?: number },
): FittedShadowCamera | null {
  if (casterBounds.isEmpty()) return null;

  const padding = opts?.padding ?? 1.35;
  const minExtent = opts?.minExtent ?? 1.2;
  const maxExtent = opts?.maxExtent ?? 14;

  _lightPos.set(lightPosition.x, lightPosition.y, lightPosition.z);
  _target.set(lightTarget.x, lightTarget.y, lightTarget.z);
  _lightDir.subVectors(_target, _lightPos).normalize();
  if (_lightDir.lengthSq() < 1e-8) _lightDir.set(0, -1, 0);

  // Look from light toward target — same basis the shadow camera uses.
  _viewMatrix.lookAt(_lightPos, _target, _up);
  _viewMatrix.invert();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const min = casterBounds.min;
  const max = casterBounds.max;
  for (let ix = 0; ix < 2; ix += 1) {
    for (let iy = 0; iy < 2; iy += 1) {
      for (let iz = 0; iz < 2; iz += 1) {
        _corner.set(
          ix ? max.x : min.x,
          iy ? max.y : min.y,
          iz ? max.z : min.z,
        );
        _tmp.copy(_corner).applyMatrix4(_viewMatrix);
        minX = Math.min(minX, _tmp.x);
        maxX = Math.max(maxX, _tmp.x);
        minY = Math.min(minY, _tmp.y);
        maxY = Math.max(maxY, _tmp.y);
        minZ = Math.min(minZ, _tmp.z);
        maxZ = Math.max(maxZ, _tmp.z);

        // Project caster corner onto the floor along the light direction so the
        // cast footprint stays inside the shadow map when devices rotate.
        if (Math.abs(_lightDir.y) > 1e-4) {
          const t = (floorY - _corner.y) / _lightDir.y;
          if (t > 0 && t < 40) {
            _tmp.set(
              _corner.x + _lightDir.x * t,
              floorY,
              _corner.z + _lightDir.z * t,
            ).applyMatrix4(_viewMatrix);
            minX = Math.min(minX, _tmp.x);
            maxX = Math.max(maxX, _tmp.x);
            minY = Math.min(minY, _tmp.y);
            maxY = Math.max(maxY, _tmp.y);
            minZ = Math.min(minZ, _tmp.z);
            maxZ = Math.max(maxZ, _tmp.z);
          }
        }

        // March the cast a few metres so cove / wall receivers stay in the map.
        // Floor projection alone misses shadows that climb the seamless paper.
        for (let step = 1; step <= 4; step += 1) {
          _tmp.copy(_corner).addScaledVector(_lightDir, step * 1.8);
          if (_tmp.y < floorY - 0.05) continue;
          _tmp.applyMatrix4(_viewMatrix);
          minX = Math.min(minX, _tmp.x);
          maxX = Math.max(maxX, _tmp.x);
          minY = Math.min(minY, _tmp.y);
          maxY = Math.max(maxY, _tmp.y);
          minZ = Math.min(minZ, _tmp.z);
          maxZ = Math.max(maxZ, _tmp.z);
        }
      }
    }
  }

  const padX = (maxX - minX) * (padding - 1) * 0.5 + 0.35;
  const padY = (maxY - minY) * (padding - 1) * 0.5 + 0.35;
  let left = minX - padX;
  let right = maxX + padX;
  let bottom = minY - padY;
  let top = maxY + padY;

  // Keep roughly square so texels stay isotropic.
  const width = right - left;
  const height = top - bottom;
  const side = THREE.MathUtils.clamp(Math.max(width, height, minExtent), minExtent, maxExtent);
  const cx = (left + right) * 0.5;
  const cy = (bottom + top) * 0.5;
  left = cx - side * 0.5;
  right = cx + side * 0.5;
  bottom = cy - side * 0.5;
  top = cy + side * 0.5;

  const near = Math.max(0.2, -maxZ - 0.8);
  const far = Math.max(near + 2, -minZ + 4);

  casterBounds.getCenter(_center);

  return {
    left,
    right,
    top,
    bottom,
    near,
    far,
    halfExtent: side * 0.5,
    center: _center.clone(),
  };
}

/** Map size for key-light / RandomizedLight — respect GPU caps. */
export function resolveKeyShadowMapSize(
  quality: ShadowQuality,
  mode: StudioShadowMode,
  exportBoost: boolean,
  maxTextureSize: number,
): number {
  // Stable live atlas (even while orbiting) so mode flips never dispose/reallocate.
  // Orbit freezes updates + thinner PCSS; export may bump for stills/video.
  void mode;
  let size: number = SHADOW_MAP_BUDGET.preview;
  if (exportBoost || quality === 'ultra') size = SHADOW_MAP_BUDGET.export;
  else if (quality === 'high') size = Math.max(SHADOW_MAP_BUDGET.preview, 2048);
  const cap = Math.max(512, Math.min(4096, maxTextureSize || 4096));
  let out = size;
  while (out > cap) out = Math.floor(out / 2);
  return THREE.MathUtils.clamp(out, 512, 4096);
}

/** ContactShadows resolution for the floor plate. */
export function resolveFloorShadowResolution(
  quality: ShadowQuality,
  mode: StudioShadowMode,
  exportBoost: boolean,
  maxTextureSize: number,
): number {
  // Stable live resolution in both modes — plate stays visible/frozen on orbit.
  void mode;
  let size: number = SHADOW_MAP_BUDGET.preview;
  if (exportBoost || quality === 'ultra' || quality === 'high') {
    size = exportBoost ? 2048 : Math.max(SHADOW_MAP_BUDGET.preview, 1024);
  }
  const cap = Math.max(512, Math.min(2048, maxTextureSize || 2048));
  let out = size;
  while (out > cap) out = Math.floor(out / 2);
  return THREE.MathUtils.clamp(out, 512, 2048);
}

/** Extra scene lights (spot / directional) — stable size; export may bump. */
export function resolveSceneLightShadowMapSize(
  mode: StudioShadowMode,
  exportBoost: boolean,
  maxTextureSize: number,
): number {
  void mode;
  let size = exportBoost ? 2048 : SHADOW_MAP_BUDGET.preview;
  const cap = Math.max(512, Math.min(2048, maxTextureSize || 2048));
  let out = size;
  while (out > cap) out = Math.floor(out / 2);
  return THREE.MathUtils.clamp(out, 512, 2048);
}

/** How many progressive samples to resolve in studio / export. */
export function resolveAccumulationSamples(
  quality: ShadowQuality,
  exportBoost: boolean,
): number {
  if (exportBoost) return STUDIO_SHADOW_SAMPLES.export;
  if (quality === 'ultra') return STUDIO_SHADOW_SAMPLES.ultra;
  if (quality === 'high') return STUDIO_SHADOW_SAMPLES.high;
  return STUDIO_SHADOW_SAMPLES.preview;
}

/** Softness slider floor / ceiling (project units). */
export const SHADOW_SOFTNESS_MIN = 0.2;
/** High end is a wide softbox bloom — past the old 8 ceiling. */
export const SHADOW_SOFTNESS_MAX = 14;

/** How far a floor shadow can reach (world units). Covers standing phones; raise for floats. */
export const SHADOW_DISTANCE_MIN = 0.6;
export const SHADOW_DISTANCE_MAX = 10;

/** Default cool-black product shadow — Apple-like, not pure #000. */
export const DEFAULT_SHADOW_COLOR = '#1a1c22';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isShadowColor(value: unknown): value is string {
  return typeof value === 'string' && HEX6.test(value);
}

/** Softness 0.2–14 → 0–100% for the properties panel. */
export function softnessToPercent(softness: number): number {
  const s = THREE.MathUtils.clamp(softness, SHADOW_SOFTNESS_MIN, SHADOW_SOFTNESS_MAX);
  return ((s - SHADOW_SOFTNESS_MIN) / (SHADOW_SOFTNESS_MAX - SHADOW_SOFTNESS_MIN)) * 100;
}

export function percentToSoftness(percent: number): number {
  const t = THREE.MathUtils.clamp(percent, 0, 100) / 100;
  return SHADOW_SOFTNESS_MIN + t * (SHADOW_SOFTNESS_MAX - SHADOW_SOFTNESS_MIN);
}

/** Opacity 0–1 (photographic) → 0–100%. Values above 1 still render darker. */
export function opacityToPercent(opacity: number): number {
  return THREE.MathUtils.clamp(opacity, 0, 1) * 100;
}

export function percentToOpacity(percent: number): number {
  return THREE.MathUtils.clamp(percent, 0, 100) / 100;
}

/** Ambient occlusion 0–1 → 0–100%. */
export function aoToPercent(amount: number): number {
  return THREE.MathUtils.clamp(amount, 0, 1) * 100;
}

export function percentToAo(percent: number): number {
  return THREE.MathUtils.clamp(percent, 0, 100) / 100;
}

/**
 * Softness (project 0.2–14) → apparent penumbra width.
 * Preserves saved meaning: low = defined, mid = product photo, high = softbox bloom.
 */
export function softnessToPenumbra(softness: number): {
  /** RandomizedLight radius (world). */
  radius: number;
  /** Contact shadow blur amount (drei units). */
  contactBlur: number;
  /** Key-light PCF radius (texels). */
  mapRadius: number;
  /** Key-light PCSS emitter size at a 2048 map (texels) — drives penumbra growth. */
  emitterSize: number;
  /** AccumulativeShadows alphaTest (higher = tighter core). */
  alphaTest: number;
} {
  const s = THREE.MathUtils.clamp(softness, SHADOW_SOFTNESS_MIN, SHADOW_SOFTNESS_MAX);
  const t = THREE.MathUtils.smoothstep(SHADOW_SOFTNESS_MIN, SHADOW_SOFTNESS_MAX, s);
  return {
    radius: THREE.MathUtils.lerp(0.5, 4.4, t),
    contactBlur: THREE.MathUtils.lerp(0.7, 3.4, t),
    mapRadius: THREE.MathUtils.lerp(1.4, 5.2, t),
    emitterSize: Math.max(2.5, s * 7.2),
    alphaTest: THREE.MathUtils.lerp(0.55, 0.82, 1 - t),
  };
}

/** World-space reach of the contact plate. Distance 3.6 covers a standing phone. */
export function distanceToContactFar(distance: number): number {
  return THREE.MathUtils.clamp(distance, SHADOW_DISTANCE_MIN, SHADOW_DISTANCE_MAX);
}

/**
 * Default Shadow → Intensity slider value (0–2 range).
 * Soft penumbras average toward lit, so values above 1 remain available to crush
 * the core darker without forcing Softness down.
 */
export const SHADOW_INTENSITY_PIVOT = 1;
/** Slider / project ceiling for Intensity. */
export const SHADOW_INTENSITY_MAX = 2;

/**
 * Map Intensity (0–2) onto an output strength.
 * 0 → 0, pivot (1) → `anchor`, max (2) → `max`.
 * `max` may exceed 1 — callers that feed ShadowMaterial / shadow.intensity use
 * that headroom to darken soft cores that never fully occlude.
 */
export function shadowIntensityCurve(opacity: number, anchor: number, max: number): number {
  const o = THREE.MathUtils.clamp(opacity, 0, SHADOW_INTENSITY_MAX);
  if (o <= SHADOW_INTENSITY_PIVOT) {
    return SHADOW_INTENSITY_PIVOT <= 1e-6 ? 0 : (o / SHADOW_INTENSITY_PIVOT) * anchor;
  }
  const span = SHADOW_INTENSITY_MAX - SHADOW_INTENSITY_PIVOT;
  return anchor + ((o - SHADOW_INTENSITY_PIVOT) / Math.max(span, 1e-6)) * (max - anchor);
}

/**
 * Opacity (0–2) → floor-plate strengths.
 * Contact is the photographic ground (Rotato / Apple product shot).
 * PCSS catcher adds the directional cast on top.
 */
export function opacityToShadowStrength(
  opacity: number,
  opacityScale: number,
): {
  accumulative: number;
  contactPrimary: number;
  contactAccent: number;
  catcher: number;
} {
  const o = shadowIntensityCurve(opacity, 0.72, 1.35) * opacityScale;
  const t = THREE.MathUtils.clamp(opacity, 0, SHADOW_INTENSITY_MAX) / SHADOW_INTENSITY_MAX;
  return {
    accumulative: THREE.MathUtils.clamp(o * 0.7, 0, 0.78),
    contactPrimary: THREE.MathUtils.clamp(o * 0.78, 0, 0.7),
    contactAccent: THREE.MathUtils.clamp(o * 0.38 * (0.45 + t), 0, 0.48),
    catcher: THREE.MathUtils.clamp(o * 0.62, 0, 0.72),
  };
}

export type StudioShadowApi = {
  /** Reset progressive buffers after a scene / light change. */
  reset: () => void;
  /**
   * Synchronously bake `samples` progressive frames.
   * Used by still / video capture so exports never show half-resolved shadows.
   */
  settle: (samples?: number) => void;
  /** Current mode the floor shadow system is in. */
  getMode: () => StudioShadowMode;
};
