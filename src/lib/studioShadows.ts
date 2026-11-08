import * as THREE from 'three';
import type { ShadowQuality, Vec3 } from '../types';

/** Internal render quality — interactive stays responsive; studio refines after idle. */
export type StudioShadowMode = 'interactive' | 'studio';

/** Idle delay before progressive studio refinement (ms). */
export const STUDIO_SHADOW_IDLE_MS = 260;

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

/** Expand world AABB of every relevant caster (devices + shadow-casting props). */
export function collectCasterBounds(scene: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !isShadowCasterMesh(mesh)) return;
    if (!mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    _box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    target.union(_box);
  });
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
  let size = 2048;
  if (exportBoost || quality === 'ultra' || mode === 'studio') size = 4096;
  else if (quality === 'high') size = 2048;
  else size = 2048;
  const cap = Math.max(512, Math.min(4096, maxTextureSize || 4096));
  // Prefer power-of-two under the GPU limit.
  let out = size;
  while (out > cap) out = Math.floor(out / 2);
  return THREE.MathUtils.clamp(out, 512, 4096);
}

/** AccumulativeShadows / contact resolution for the floor plate. */
export function resolveFloorShadowResolution(
  quality: ShadowQuality,
  mode: StudioShadowMode,
  exportBoost: boolean,
  maxTextureSize: number,
): number {
  let size = mode === 'interactive' ? 1024 : 2048;
  if (exportBoost || quality === 'ultra') size = 2048;
  else if (quality === 'high' && mode === 'studio') size = 2048;
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

/**
 * Softness (project 0.2–8) → apparent penumbra width.
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
  const s = THREE.MathUtils.clamp(softness, 0.2, 8);
  const t = THREE.MathUtils.smoothstep(0.2, 8, s);
  return {
    radius: THREE.MathUtils.lerp(0.55, 3.4, t),
    contactBlur: THREE.MathUtils.lerp(0.55, 2.1, t),
    mapRadius: THREE.MathUtils.lerp(1.2, 3.8, t),
    emitterSize: Math.max(2, s * 6),
    alphaTest: THREE.MathUtils.lerp(0.55, 0.82, 1 - t),
  };
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
 * Opacity (0–2) → contact-plate strengths without crushing falloff.
 * PCSS carries the cast; contact stays a light foot kiss so raising Intensity
 * darkens the silhouette instead of washing the floor with a soft gray blob.
 */
export function opacityToShadowStrength(
  opacity: number,
  opacityScale: number,
): {
  accumulative: number;
  contactPrimary: number;
  contactAccent: number;
} {
  const o = shadowIntensityCurve(opacity, 0.55, 1.15) * opacityScale;
  const t = THREE.MathUtils.clamp(opacity, 0, SHADOW_INTENSITY_MAX) / SHADOW_INTENSITY_MAX;
  return {
    accumulative: THREE.MathUtils.clamp(o * 0.55, 0, 0.55),
    contactPrimary: THREE.MathUtils.clamp(o * 0.4, 0, 0.4),
    contactAccent: THREE.MathUtils.clamp(o * 0.18 * (0.35 + t), 0, 0.32),
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
