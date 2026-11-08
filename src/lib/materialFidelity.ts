import * as THREE from 'three';
import { createSceneLight, type SceneLight, type SceneLightKind } from '../types';

/**
 * Keep every authored texture / physical trait when we clone or upgrade
 * materials. glTF has no bump slot — convert bump → normal before export.
 */

const MAP_KEYS = [
  'map',
  'normalMap',
  'bumpMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'lightMap',
  'envMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
] as const;

type MapKey = (typeof MAP_KEYS)[number];

function readMap(src: THREE.Material, key: MapKey): THREE.Texture | null {
  const value = (src as unknown as Record<string, unknown>)[key];
  return value && (value as THREE.Texture).isTexture ? (value as THREE.Texture) : null;
}

/** Copy every texture slot that exists on the source material. */
export function copyAuthoredMaps(
  target: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  source: THREE.Material,
) {
  for (const key of MAP_KEYS) {
    const tex = readMap(source, key);
    if (tex) (target as unknown as Record<string, unknown>)[key] = tex;
  }

  const src = source as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  if (src.normalScale?.clone) target.normalScale = src.normalScale.clone();
  if (typeof src.bumpScale === 'number') target.bumpScale = src.bumpScale;
  if (typeof src.displacementScale === 'number') target.displacementScale = src.displacementScale;
  if (typeof src.displacementBias === 'number') target.displacementBias = src.displacementBias;
  if (typeof src.aoMapIntensity === 'number') target.aoMapIntensity = src.aoMapIntensity;
  if (typeof src.lightMapIntensity === 'number') target.lightMapIntensity = src.lightMapIntensity;
  const clearcoatNormal = (src as THREE.MeshPhysicalMaterial).clearcoatNormalScale;
  if (clearcoatNormal && typeof clearcoatNormal.copy === 'function'
    && (target as THREE.MeshPhysicalMaterial).clearcoatNormalScale) {
    (target as THREE.MeshPhysicalMaterial).clearcoatNormalScale.copy(clearcoatNormal);
  }
}

/** Copy physical / PBR traits without inventing values that weren't authored. */
export function copyAuthoredPhysicalTraits(
  target: THREE.MeshPhysicalMaterial,
  source: THREE.Material,
) {
  const src = source as THREE.MeshPhysicalMaterial;
  const assign = (key: keyof THREE.MeshPhysicalMaterial) => {
    const value = src[key];
    if (typeof value === 'number') (target as unknown as Record<string, number>)[key as string] = value;
  };

  for (const key of [
    'clearcoat',
    'clearcoatRoughness',
    'sheen',
    'sheenRoughness',
    'transmission',
    'thickness',
    'ior',
    'specularIntensity',
    'iridescence',
    'iridescenceIOR',
    'anisotropy',
    'anisotropyRotation',
    'attenuationDistance',
  ] as const) {
    assign(key);
  }

  if (src.sheenColor?.isColor) target.sheenColor = src.sheenColor.clone();
  if (src.specularColor?.isColor) target.specularColor = src.specularColor.clone();
  if (src.attenuationColor?.isColor) target.attenuationColor = src.attenuationColor.clone();
  if (src.iridescenceThicknessRange) {
    target.iridescenceThicknessRange = [...src.iridescenceThicknessRange] as [number, number];
  }
}

/**
 * Build a MeshPhysicalMaterial that keeps the source's maps and traits.
 * Avoid MeshPhysicalMaterial.copy(standard) — Three crashes on undefined
 * clearcoatNormalScale.
 */
export function physicalFromAuthored(source: THREE.Material): THREE.MeshPhysicalMaterial {
  if ((source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return source as THREE.MeshPhysicalMaterial;
  }

  const src = source as THREE.MeshStandardMaterial;
  const phys = new THREE.MeshPhysicalMaterial({
    name: source.name,
    color: src.color?.clone?.() ?? new THREE.Color(0xffffff),
    metalness: typeof src.metalness === 'number' ? src.metalness : 0,
    roughness: typeof src.roughness === 'number' ? src.roughness : 0.5,
    emissive: src.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 1,
    envMapIntensity: typeof src.envMapIntensity === 'number' ? src.envMapIntensity : 1,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    alphaTest: source.alphaTest,
    toneMapped: src.toneMapped ?? true,
    vertexColors: src.vertexColors,
    wireframe: src.wireframe,
    flatShading: src.flatShading,
  });

  copyAuthoredMaps(phys, source);
  copyAuthoredPhysicalTraits(phys, source);
  phys.userData = { ...source.userData };
  return phys;
}

/** Convert a greyscale bump/height map into a tangent-space normal map. */
export function bumpTextureToNormal(
  bump: THREE.Texture,
  strength = 1,
): THREE.CanvasTexture | null {
  const image = bump.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | OffscreenCanvas
    | { width: number; height: number; data?: Uint8ClampedArray }
    | undefined;
  if (!image) return null;

  const width = ('width' in image ? image.width : 0) || 0;
  const height = ('height' in image ? image.height : 0) || 0;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    if ('data' in image && image.data) {
      const src = new ImageData(
        new Uint8ClampedArray(image.data),
        width,
        height,
      );
      ctx.putImageData(src, 0, 0);
    } else {
      ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
    }
  } catch {
    return null;
  }

  const src = ctx.getImageData(0, 0, width, height);
  const heightField = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    heightField[i] = (src.data[o] + src.data[o + 1] + src.data[o + 2]) / (3 * 255);
  }

  const out = ctx.createImageData(width, height);
  const scale = Math.max(0.05, strength) * 2.4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = heightField[y * width + ((x - 1 + width) % width)];
      const right = heightField[y * width + ((x + 1) % width)];
      const up = heightField[((y - 1 + height) % height) * width + x];
      const down = heightField[((y + 1) % height) * width + x];
      const dx = (left - right) * scale;
      const dy = (up - down) * scale;
      const len = Math.hypot(dx, dy, 1) || 1;
      const idx = (y * width + x) * 4;
      out.data[idx] = Math.floor(((dx / len) * 0.5 + 0.5) * 255);
      out.data[idx + 1] = Math.floor(((dy / len) * 0.5 + 0.5) * 255);
      out.data[idx + 2] = Math.floor(((1 / len) * 0.5 + 0.5) * 255);
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const normal = new THREE.CanvasTexture(canvas);
  normal.colorSpace = THREE.NoColorSpace;
  normal.wrapS = bump.wrapS;
  normal.wrapT = bump.wrapT;
  normal.repeat.copy(bump.repeat);
  normal.offset.copy(bump.offset);
  normal.center.copy(bump.center);
  normal.rotation = bump.rotation;
  normal.flipY = bump.flipY;
  normal.needsUpdate = true;
  return normal;
}

/**
 * glTF has no bumpMap — bake bump into normalMap before packing a GLB so
 * surface detail survives FBX/OBJ/DAE conversion.
 */
export function convertBumpMapsForGltf(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      if (!mat) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      if (!standard.bumpMap) continue;
      if (standard.normalMap) {
        // Prefer an authored normal; drop bump so the exporter cannot lose it silently.
        standard.bumpMap = null;
        standard.needsUpdate = true;
        continue;
      }
      const strength = typeof standard.bumpScale === 'number' ? standard.bumpScale : 1;
      const normal = bumpTextureToNormal(standard.bumpMap, strength);
      if (normal) {
        standard.normalMap = normal;
        standard.normalScale = new THREE.Vector2(1, 1);
      }
      standard.bumpMap = null;
      standard.bumpScale = 1;
      standard.needsUpdate = true;
    }
  });
}

function colorToHex(color: THREE.Color | undefined): string {
  if (!color) return '#ffffff';
  return `#${color.getHexString()}`;
}

function worldPosition(obj: THREE.Object3D): { x: number; y: number; z: number } {
  const v = new THREE.Vector3();
  obj.getWorldPosition(v);
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Pull Point / Spot / Directional / RectArea lights out of an imported
 * Spline / Blender scene so they become editable studio luminaires.
 */
export function extractSceneLights(root: THREE.Object3D, limit = 8): SceneLight[] {
  root.updateMatrixWorld(true);
  const found: SceneLight[] = [];
  const lights: THREE.Light[] = [];

  root.traverse((obj) => {
    const light = obj as THREE.Light;
    if (!light.isLight) return;
    if ((light as THREE.AmbientLight).isAmbientLight) return;
    if ((light as THREE.HemisphereLight).isHemisphereLight) return;
    lights.push(light);
  });

  for (const light of lights) {
    if (found.length >= limit) break;
    let kind: SceneLightKind | null = null;
    if ((light as THREE.DirectionalLight).isDirectionalLight) kind = 'directional';
    else if ((light as THREE.SpotLight).isSpotLight) kind = 'spot';
    else if ((light as THREE.RectAreaLight).isRectAreaLight) kind = 'area';
    else if ((light as THREE.PointLight).isPointLight) kind = 'point';
    if (!kind) continue;

    const position = worldPosition(light);
    let target = { x: 0, y: 0, z: 0 };
    const aiming = light as THREE.DirectionalLight | THREE.SpotLight;
    if ('target' in aiming && aiming.target) {
      target = worldPosition(aiming.target);
    } else {
      const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(light.getWorldQuaternion(new THREE.Quaternion()));
      target = {
        x: position.x + dir.x * 2,
        y: position.y + dir.y * 2,
        z: position.z + dir.z * 2,
      };
    }

    const spot = light as THREE.SpotLight;
    const area = light as THREE.RectAreaLight;
    const point = light as THREE.PointLight;

    found.push(createSceneLight({
      kind,
      label: (light.name && light.name.trim()) || undefined,
      enabled: light.visible,
      position,
      target,
      color: colorToHex(light.color),
      intensity: typeof light.intensity === 'number' ? light.intensity : 1,
      distance: typeof point.distance === 'number' ? point.distance : 0,
      decay: typeof point.decay === 'number' ? point.decay : 2,
      angle: typeof spot.angle === 'number' ? spot.angle : Math.PI / 6,
      penumbra: typeof spot.penumbra === 'number' ? spot.penumbra : 0,
      width: typeof area.width === 'number' ? area.width : 2,
      height: typeof area.height === 'number' ? area.height : 2,
      castShadow: Boolean(light.castShadow),
    }));
  }

  return found;
}

/** Remove cameras and lights so the packed mesh only carries geometry + materials. */
export function stripSceneHelpers(root: THREE.Object3D) {
  const drop: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const light = obj as THREE.Light;
    const camera = obj as THREE.Camera;
    if (light.isLight || camera.isCamera) drop.push(obj);
  });
  for (const obj of drop) obj.parent?.remove(obj);
}
