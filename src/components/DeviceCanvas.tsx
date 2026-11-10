import {
  Component, Suspense, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ErrorInfo, type MutableRefObject, type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { hideBrandMarks, isBrandLogoObject } from '../lib/brandMarks';
import { getDevice, type DeviceUv } from '../lib/devices';
import { useDeviceModelUrl } from '../lib/useDeviceModelUrl';
import { applyLidOpen, setupLidRig, type LidRig } from '../lib/deviceLid';
import { applyProgressiveEdgeBlur } from '../lib/edgeBlur';
import { accentPair, useAccentTheme } from '../lib/accentTheme';
import {
  installRenderGrade,
  renderOutputGain,
  setRenderGradeGain,
} from '../lib/renderRealism';
import {
  installProgressiveShadowShader,
  refreshShadowMaterials,
  releaseProgressiveShadowProfile,
  retainProgressiveShadowProfile,
  type ProgressiveShadowProfile,
} from '../lib/progressiveShadows';
import { useScreenEmissiveMap } from '../lib/useScreenTexture';
import {
  applySurfaceLook,
  attachStudioEnvMap,
  ReflectionDriveContext,
  SceneEnvMapContext,
  surfaceLook,
  type ReflectionStyle,
} from '../lib/reflectionStyle';
import ProceduralDevice from './ProceduralDevice';
import ScreenLayerExplosion from './ScreenLayerExplosion';
import RotationBall, { type GizmoControl, type GizmoMode, type GizmoTargets } from './RotationBall';
import SceneProps from './SceneProps';
import ExtrudedText from './ExtrudedText';
import ExtrudedShape from './ExtrudedShape';
import { AnnotationDrawController, ModelAnnotationLayer, type AnnotationMark } from './ModelAnnotations';
import {
  StudioAmbientOcclusion,
  StudioDepthOfField,
  StudioExposure,
  StudioHdri,
  StudioLighting,
  StudioShadowInteractionProvider,
  useStudioPreset,
  useStudioShadowInteraction,
} from './StudioEnvironment';
import SceneLights from './SceneLights';
import LightTranslateGizmo from './LightTranslateGizmo';
import { STUDIO_DEVICE_HEIGHT } from '../lib/studioEnvironment';
import {
  collectCasterBounds,
  DEFAULT_SHADOW_COLOR,
  fitDirectionalShadowCamera,
  opacityToShadowStrength,
  resolveKeyShadowMapSize,
  shadowIntensityCurve,
  softnessToPenumbra,
} from '../lib/studioShadows';
import { physicalFromAuthored, stripSceneHelpers } from '../lib/materialFidelity';
import {
  DEVICE_COLORS, DEFAULT_PROJECT, EYE_CAMERA_DISTANCE, EYE_PERSPECTIVE_FOV, EYE_SPLIT_CAMERA_DISTANCE, cameraLensFov,
  type BackgroundPreset, type CameraLens, type CameraView, type DeviceColor, type DeviceInstance,
  type GradientColors, type MockupProject, type ShadowQuality, type Vec3,
} from '../types';
import { STUDIO_FLOOR_Y } from '../lib/studioEnvironment';

/** Live preview DPR — Retina 2× is expensive with shadows + grade; thumbs still pass pixelRatio. */
const LIVE_CANVAS_DPR: [number, number] = [1, 1.5];


export type CaptureApi = {
  toPng: (width: number, height: number) => Promise<string>;
  toImage: (width: number, height: number, mime?: 'image/png' | 'image/webp', quality?: number) => Promise<string>;
  /** The picture currently on the canvas, after Electron has presented it. */
  toPresentedImage: () => Promise<string>;
  /** Reads a render target, so card shots still work when the canvas is covered. */
  toSnapshot: (width: number, height: number) => Promise<string>;
  drawFrame: (width: number, height: number, dest: CanvasRenderingContext2D) => void;
};

/** @deprecated Prefer CaptureApi */
export type CaptureFunction = CaptureApi;

export interface DeviceSelectPayload {
  id: string;
  clientX: number;
  clientY: number;
  /** When false, select the device without opening the action menu. */
  openMenu?: boolean;
}

export type ViewGesture = 'pan' | 'zoom' | 'rotate' | 'longpress' | 'swipe';

export type MaterialPickPayload = {
  deviceInstanceId: string;
  materialName: string;
  /** Mesh / node name under the pointer — used by DEV “Remove part”. */
  meshName?: string;
  /** Current authored hex when readable from the hit material */
  colorHex?: string;
};

interface Props {
  project: MockupProject;
  captureRef: MutableRefObject<CaptureApi | null>;
  gizmoMode?: GizmoMode;
  /** Preview playback — keeps screen videos moving with the timeline */
  mediaPlaying?: boolean;
  /** Live USB iPhone/iPad mirror stream painted onto device screens */
  liveStream?: MediaStream | null;
  /** Only this device receives the live mirror stream (active publish env). */
  liveStreamDeviceId?: string | null;
  /** Evaluated camera position when camera tracks are active */
  cameraPosition?: Vec3 | null;
  /** Unique id per WebGL canvas — keeps ContactShadows / R3F state from colliding in dual mode. */
  canvasId?: string;
  /** When false, hide TransformControls (inactive dual-pane) so linked poses aren’t fought. */
  gizmoActive?: boolean;
  /**
   * Shared dual-pane orbit as an offset from the device look-at.
   * Both panes keep the same viewing angle while each centers on its own device.
   * lookOffset shifts the pan target so Space-drag can move the frame.
   */
  sharedOrbit?: { offset: Vec3; lookOffset?: Vec3 } | null;
  onSharedOrbitChange?: (orbit: { offset: Vec3; lookOffset?: Vec3 }) => void;
  /**
   * User finished orbiting or dollying. World-space camera position plus the
   * device-relative orbit that must be sealed into the project (typed rotation
   * writes the project directly; mouse orbit must pass the pose here so it
   * cannot be dropped by publishOrbit gates).
   */
  onCameraCommit?: (
    position: Vec3,
    orbit: { offset: Vec3; lookOffset?: Vec3 },
  ) => void;
  /** Orbit / dolly gesture started — pause playback so the playhead stays put. */
  onOrbitStart?: () => void;
  /** Device center to frame — camera always looks here. */
  focusPoint?: Vec3 | null;
  /** Bump to force an instant centered snap (no damping / easing). */
  recenterToken?: number;
  onSelectDevice?: (payload: DeviceSelectPayload) => void;
  /** Playhead used to show or hide extruded text. */
  overlayTime?: number;
  selectedPropId?: string | null;
  onSelectProp?: (id: string) => void;
  /** Built-in studio cyclorama selected in the hierarchy / canvas. */
  backdropSelected?: boolean;
  onSelectBackdrop?: () => void;
  /** Tap empty surrounding sky (not devices / stage / backdrop wall). */
  onSelectSky?: () => void;
  /** Tap empty floor / ground plane (not devices / stage / backdrop wall). */
  onSelectFloor?: () => void;
  onSelectOverlay?: (id: string) => void;
  selectedOverlayId?: string | null;
  /** Device under the pointer, or null when the pointer leaves the canvas. */
  onHoverDevice?: (id: string | null) => void;
  /** Device under a dragged file, or null when the drag leaves the canvas. */
  onDragTargetDevice?: (id: string | null) => void;
  /** Right-click on a device — open the action menu so Paste can target that screen. */
  onDeviceContextMenu?: (payload: DeviceSelectPayload) => void;
  onClearSelection?: () => void;
  onRotateDevice?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveDevice?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveProp?: (id: string, position: Vec3) => void;
  onRotateProp?: (id: string, rotation: Vec3) => void;
  /** Clean tap on empty canvas → sky / floor / backdrop colour in the sidebar. */
  onSelectEmpty?: (target: 'sky' | 'floor' | 'backdrop') => void;
  onGizmoDraggingChange?: (dragging: boolean) => void;
  /** True while the gimbal / body-drag is active — freezes camera framing chase. */
  gizmoDragging?: boolean;
  /** While a screenshot file is dragged over the canvas, glow this device's screen. */
  screenDropDeviceId?: string | null;
  /** Show translate gizmo for the key directional light */
  lightGizmoActive?: boolean;
  onLightPositionChange?: (position: Vec3) => void;
  /** Extra scene light currently showing a move gimbal */
  selectedSceneLightId?: string | null;
  onSceneLightPositionChange?: (id: string, position: Vec3) => void;
  onSelectSceneLight?: (id: string) => void;
  onSelectKeyLight?: () => void;
  /** Fired once the user actually pans: Space held and the canvas dragged. */
  onSpacePanDrag?: () => void;
  /** Active viewport gesture. Rotate matches the default orbit. */
  viewGesture?: ViewGesture;
  onSwipe?: (direction: 'left' | 'right') => void;
  onLongPress?: (point: { clientX: number; clientY: number }) => void;
  /** Draw or pin notes in device space so they follow the model. */
  annotate?: 'pen' | 'comment' | null;
  /** Stroke colour used while drawing an annotation. */
  annotateInk?: string;
  onAnnotation?: (mark: AnnotationMark) => void;
  /** Pixel ratio override. Thumbnails pass 1 to stay light. */
  pixelRatio?: [number, number];
  /** Lock orbit / pan / zoom — used by offscreen card bakers. */
  freezeFraming?: boolean;
  /** Fires after the device meshes have mounted — thumbnails wait on this. */
  onSceneReady?: () => void;
  /** Force Ultra floor-shadow sampling while exporting stills / video. */
  shadowExportBoost?: boolean;
  /** DEV modeling mode — tap a surface to edit its material. */
  materialEditEnabled?: boolean;
  /** Material currently open in the modeling editor (highlight). */
  selectedMaterialName?: string | null;
  /** Device instance that owns the selected material. */
  selectedMaterialDeviceId?: string | null;
  onPickMaterial?: (payload: MaterialPickPayload) => void;
}

/**
 * Keep authored albedo from bleaching under the studio HDRI.
 * Glossy / metal / clearcoat surfaces keep their env pickup — crushing those
 * is what made AirPods and similar plastics read flat grey.
 */
function tameAuthoredEnvPickup(root: THREE.Object3D, screenMatName: string) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || '').toLowerCase();
      if (mat.name === screenMatName || isDisplayScreenMaterialName(mat.name || '')) continue;
      if (name.includes('glass') || name.includes('lens')) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      if (!('envMapIntensity' in standard)) continue;
      const roughness = typeof standard.roughness === 'number' ? standard.roughness : 1;
      const metalness = typeof standard.metalness === 'number' ? standard.metalness : 0;
      const physical = standard as THREE.MeshPhysicalMaterial;
      const clearcoat = typeof physical.clearcoat === 'number' ? physical.clearcoat : 0;
      const sheen = typeof physical.sheen === 'number' ? physical.sheen : 0;
      const iridescence = typeof physical.iridescence === 'number' ? physical.iridescence : 0;
      const anisotropy = typeof physical.anisotropy === 'number' ? Math.abs(physical.anisotropy) : 0;
      // Glossy / shimmer finishes need the studio softboxes.
      if (
        roughness < 0.45
        || metalness > 0.35
        || clearcoat > 0.05
        || sheen > 0.02
        || iridescence > 0.02
        || anisotropy > 0.02
      ) continue;
      const hasAlbedo = Boolean(standard.map);
      const cap = hasAlbedo ? 0.75 : 0.95;
      if (typeof standard.envMapIntensity === 'number' && standard.envMapIntensity > cap) {
        standard.envMapIntensity = cap;
        standard.needsUpdate = true;
      }
    }
  });
}

function applyDeviceFinish(
  root: THREE.Object3D,
  screenMatName: string,
  deviceColor: DeviceColor,
  clayMode: boolean,
  lockMaterials = true,
) {
  const clay = clayMode || deviceColor === 'clay';
  // GLB materials stay as authored. Finish swatches never repaint the model —
  // only Clay mode is an explicit studio override. Imported / locked models
  // also skip the env-intensity crush so sheen and shimmer survive.
  if (!clay) {
    if (!lockMaterials) tameAuthoredEnvPickup(root, screenMatName);
    return;
  }
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || '').toLowerCase();
      if (mat.name === screenMatName || isDisplayScreenMaterialName(mat.name || '')) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      if (!('color' in standard) || !standard.color) continue;
      if (name.includes('glass') || name.includes('lens') || name.includes('camera_glass')) {
        standard.metalness = 0;
        standard.roughness = 0.85;
        standard.envMapIntensity = 0.15;
        standard.transparent = false;
        standard.opacity = 1;
        standard.needsUpdate = true;
        continue;
      }
      const finish = DEVICE_COLORS.find((c) => c.id === 'clay') ?? DEVICE_COLORS[0];
      standard.color = new THREE.Color(finish.hex);
      standard.metalness = 0;
      standard.roughness = 0.92;
      standard.envMapIntensity = 0.08;
      if ('clearcoat' in standard) (standard as THREE.MeshPhysicalMaterial).clearcoat = 0;
      standard.needsUpdate = true;
    }
  });
}

function applyUvTransform(tex: THREE.Texture, uv: DeviceUv, original?: THREE.Texture | null) {
  if (original) {
    tex.flipY = original.flipY;
    tex.wrapS = original.wrapS;
    tex.wrapT = original.wrapT;
    if (original.center) tex.center.copy(original.center);
    if (original.offset) tex.offset.copy(original.offset);
    if (original.repeat) tex.repeat.copy(original.repeat);
    tex.rotation = original.rotation ?? 0;
  } else {
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  }

  tex.center.set(0.5, 0.5);
  if (uv.rot) tex.rotation += uv.rot;
  if (uv.mirrorX) tex.repeat.x = -Math.abs(tex.repeat.x || 1);
  if (uv.flipY !== undefined) tex.flipY = uv.flipY;
  if (uv.repeat) {
    tex.repeat.set(uv.repeat[0], uv.repeat[1]);
  }
  if (uv.offset) tex.offset.set(uv.offset[0], uv.offset[1]);
  if (uv.clamp) {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
}

const TEXTURE_TWEAK_KEYS = new Set(['mapDataUrl', 'normalMapDataUrl', 'roughnessMapDataUrl', 'metalnessMapDataUrl']);

function applyMaterialTweaks(
  root: THREE.Object3D,
  material: THREE.MeshStandardMaterial,
  tweak: Record<string, number | boolean | string | null>,
) {
  const needsPhysical = ['clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior', 'specularIntensity']
    .some((key) => key in tweak);
  const target = needsPhysical ? upgradeToPhysical(root, material) : material;
  for (const [key, value] of Object.entries(tweak)) {
    if (TEXTURE_TWEAK_KEYS.has(key)) continue;
    if (value == null) continue;
    if (key === 'color' || key === 'emissive') {
      (target as any)[key] = new THREE.Color(value as string | number);
    } else if (key === 'toneMapped') {
      target.toneMapped = Boolean(value);
    } else if (key === 'transparent') {
      target.transparent = Boolean(value);
    } else if (typeof value === 'number' && (key in target || needsPhysical)) {
      (target as any)[key] = value;
    }
  }
  target.needsUpdate = true;
}

function loadTweakTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.flipY = false;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function applyMaterialTextureTweaks(
  material: THREE.MeshStandardMaterial,
  tweak: Record<string, number | boolean | string | null>,
) {
  const jobs: Promise<void>[] = [];
  const assign = (
    key: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap',
    dataKey: string,
    srgb: boolean,
  ) => {
    if (!(dataKey in tweak)) return;
    const url = tweak[dataKey];
    if (typeof url !== 'string' || !url) {
      const previous = material[key];
      material[key] = null;
      if (previous && previous !== material.map) previous.dispose?.();
      material.needsUpdate = true;
      return;
    }
    jobs.push(loadTweakTexture(url, srgb).then((tex) => {
      const previous = material[key];
      material[key] = tex;
      if (previous && previous !== tex) previous.dispose?.();
      material.needsUpdate = true;
    }));
  };
  assign('map', 'mapDataUrl', true);
  assign('normalMap', 'normalMapDataUrl', false);
  assign('roughnessMap', 'roughnessMapDataUrl', false);
  assign('metalnessMap', 'metalnessMapDataUrl', false);
  if (jobs.length) await Promise.all(jobs);
}


function materialFromHit(hit: THREE.Intersection): {
  material: THREE.Material;
  name: string;
  meshName: string;
} | null {
  const mesh = hit.object as THREE.Mesh;
  if (!mesh?.isMesh) return null;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const index = typeof hit.face?.materialIndex === 'number' ? hit.face.materialIndex : 0;
  const mat = mats[Math.min(Math.max(0, index), mats.length - 1)];
  if (!mat) return null;
  const meshName = (mesh.name && mesh.name.trim())
    || (mesh.parent?.name && mesh.parent.name.trim())
    || '';
  const name = (mat.name && mat.name.trim()) || meshName || 'Material';
  return { material: mat, name, meshName: meshName || name };
}

function highlightMaterialSelection(
  root: THREE.Object3D,
  materialName: string | null,
  screenMat?: string,
) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      const selected = Boolean(materialName) && standard.name === materialName;
      const was = (standard.userData.modelingHighlight as { emissive?: THREE.Color; intensity?: number } | undefined);
      if (selected) {
        if (!was) {
          standard.userData.modelingHighlight = {
            emissive: standard.emissive?.clone?.() ?? new THREE.Color(0x000000),
            intensity: standard.emissiveIntensity ?? 0,
          };
        }
        // Keep screens readable — don't wash out the emissive plate.
        if (screenMat && standard.name === screenMat) continue;
        standard.emissive = new THREE.Color('#3d7eff');
        standard.emissiveIntensity = Math.max(standard.emissiveIntensity ?? 0, 0.35);
        standard.needsUpdate = true;
      } else if (was) {
        if (was.emissive) standard.emissive.copy(was.emissive);
        standard.emissiveIntensity = was.intensity ?? 0;
        delete standard.userData.modelingHighlight;
        standard.needsUpdate = true;
      }
    }
  });
}

/** Map the fitted screen onto 0–1 so the screenshot is upright. Left → u 0, top → v 1. */
function planarizeScreen(root: THREE.Object3D, screenMat: string) {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Fold splits bake continuous UVs across both halves — don't remap per half.
    if (mesh.userData.foldPreserveUv) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some((mat) => mat?.name === screenMat)) return;

    const geo = mesh.geometry.clone();
    mesh.geometry = geo;
    const pos = geo.getAttribute('position');
    const uvAttr = geo.getAttribute('uv');
    const nrm = geo.getAttribute('normal');
    if (!pos || !uvAttr || !nrm) return;

    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const vert = (tri: number, corner: number) => (index ? index.getX(tri * 3 + corner) : tri * 3 + corner);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const normal = new THREE.Vector3();

    let maxArea = 0;
    const front: number[][] = [];
    for (let tri = 0; tri < triCount; tri++) {
      const ids = [vert(tri, 0), vert(tri, 1), vert(tri, 2)];
      let facing = 0;
      for (const id of ids) {
        normal.fromBufferAttribute(nrm, id).applyMatrix3(normalMatrix);
        facing += normal.z;
      }
      if (facing / 3 < 0.85) continue;
      a.fromBufferAttribute(pos, ids[0]).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ids[1]).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ids[2]).applyMatrix4(mesh.matrixWorld);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
      if (area > maxArea) maxArea = area;
      front.push(ids.concat(area));
    }
    if (maxArea <= 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const world = new THREE.Vector3();
    for (const ids of front) {
      const area = ids[3];
      if (area < maxArea * 0.08) continue;
      for (let corner = 0; corner < 3; corner++) {
        const id = ids[corner];
        world.fromBufferAttribute(pos, id).applyMatrix4(mesh.matrixWorld);
        minX = Math.min(minX, world.x);
        maxX = Math.max(maxX, world.x);
        minY = Math.min(minY, world.y);
        maxY = Math.max(maxY, world.y);
      }
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    for (const ids of front) {
      for (let corner = 0; corner < 3; corner++) {
        const id = ids[corner];
        world.fromBufferAttribute(pos, id).applyMatrix4(mesh.matrixWorld);
        uvAttr.setXY(id, (world.x - minX) / spanX, (world.y - minY) / spanY);
      }
    }
    uvAttr.needsUpdate = true;
  });
}

/** Bounds of solid device meshes only — skip invisible / empty helpers that shift the pivot. */
function deviceBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  let hasMesh = false;
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    if (mesh.userData?.exportHide || mesh.userData?.isGizmoHandle) return;
    meshBox.setFromObject(mesh);
    if (meshBox.isEmpty()) return;
    if (!hasMesh) {
      box.copy(meshBox);
      hasMesh = true;
    } else {
      box.union(meshBox);
    }
  });
  if (!hasMesh) box.setFromObject(root);
  return box;
}

/**
 * deviceBounds() is world-space. If we subtract that center from root.position
 * while a parent pivot is already translated/rotated (common after the user
 * moves a device, then switches model / remounts the GLB), the mesh is shoved
 * off the gimbal origin. Neutralize ancestors for the measure+center pass so
 * the product stays glued to the rotate/move tool.
 *
 * Critical: mutating parent.position/quaternion/scale does NOT refresh
 * matrixWorld. root.updateMatrixWorld() still reads the old posed parent
 * matrices, so bounds stay wrong and the mesh drifts beside the gimbal.
 * Always rebuild from the top neutralized ancestor before measuring.
 */
function withIdentityAncestors(root: THREE.Object3D, run: () => void) {
  const saved: { obj: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
  let top: THREE.Object3D | null = null;
  for (let p = root.parent; p; p = p.parent) {
    saved.push({
      obj: p,
      position: p.position.clone(),
      quaternion: p.quaternion.clone(),
      scale: p.scale.clone(),
    });
    p.position.set(0, 0, 0);
    p.quaternion.identity();
    p.scale.set(1, 1, 1);
    top = p;
  }
  const refreshWorld = () => {
    if (top) top.updateMatrixWorld(true);
    else root.updateMatrixWorld(true);
  };
  try {
    refreshWorld();
    run();
  } finally {
    for (let i = saved.length - 1; i >= 0; i -= 1) {
      const entry = saved[i];
      entry.obj.position.copy(entry.position);
      entry.obj.quaternion.copy(entry.quaternion);
      entry.obj.scale.copy(entry.scale);
    }
    refreshWorld();
  }
}

/** Ensure display meshes have normals so upright planar UVs / facing checks work. */
function ensureScreenNormals(root: THREE.Object3D, screenMat: string) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const named = mats.some((mat) => mat?.name === screenMat);
    if (!named && !isScreenMeshName(mesh.name)) return;
    if (!mesh.geometry.getAttribute('normal')) {
      mesh.geometry.computeVertexNormals();
    }
  });
}

/**
 * Orient, scale to a fixed upright height, and center on the geometric middle.
 * Scaling by height (not the longest axis) keeps every model sitting just above
 * the studio floor with a soft contact shadow, while the gimbal stays through
 * the product center.
 */
function fitDeviceRoot(root: THREE.Object3D, rot: [number, number, number], screenMat?: string) {
  withIdentityAncestors(root, () => {
    root.rotation.set(rot[0], rot[1], rot[2]);
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);

    if (screenMat) ensureScreenNormals(root, screenMat);

    const sized = deviceBounds(root);
    const size = new THREE.Vector3();
    sized.getSize(size);
    if (size.y > 1e-6) root.scale.setScalar(STUDIO_DEVICE_HEIGHT / size.y);
    root.updateMatrixWorld(true);

    const center = deviceBounds(root).getCenter(new THREE.Vector3());
    root.position.sub(center);
    root.updateMatrixWorld(true);
  });
}

function isDisplayScreenMaterialName(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower || /glass/.test(lower)) return false;
  // Exact display slots only — not body finishes like "Screen_Graphite".
  return /^(screen|display|oled|lcd)([._-]?\d+)?$/.test(lower);
}

/** Mesh names that are the replaceable display panel (not Glass_Screen covers). */
function isScreenMeshName(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower || /glass/.test(lower)) return false;
  return /^(fold_)?screen([._-]?\d+)?$/.test(lower)
    || /^(display)([._-]?\d+)?$/.test(lower)
    || /replaceable.*display|display.*replaceable/.test(lower);
}

/**
 * Pack GLBs often share one atlas material between body + Screen mesh (Black / Graphite).
 * Clone that material onto screen meshes only so painting the display never wipes body color.
 */
function isolateScreenMaterials(
  root: THREE.Object3D,
  preferredName: string,
): THREE.MeshStandardMaterial | null {
  type Slot = { mesh: THREE.Mesh; index: number; mat: THREE.Material };
  const screenSlots: Slot[] = [];
  const bodyUsers = new Set<THREE.Material>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const onScreen = isScreenMeshName(mesh.name);
    mats.forEach((mat, index) => {
      if (!mat) return;
      if (onScreen) screenSlots.push({ mesh, index, mat });
      else bodyUsers.add(mat);
    });
  });

  if (screenSlots.length === 0) return null;

  const pickSlot = () => {
    const preferred = screenSlots.find((s) => s.mat.name === preferredName);
    if (preferred) return preferred;
    const named = screenSlots.find((s) => isDisplayScreenMaterialName(s.mat.name || ''));
    if (named) return named;
    return screenSlots[0];
  };

  const primary = pickSlot();
  const sharedWithBody = bodyUsers.has(primary.mat);
  let screenMat = primary.mat as THREE.MeshStandardMaterial;

  if (sharedWithBody) {
    const clone = primary.mat.clone() as THREE.MeshStandardMaterial;
    // Keep a display-looking name so lockMaterials / screen pipelines accept it,
    // without renaming the authored body material the clone came from.
    clone.name = isDisplayScreenMaterialName(preferredName)
      || (/screen|display|oled|lcd/i.test(preferredName) && !/glass/i.test(preferredName))
      ? preferredName
      : 'Screen';
    clone.userData = { ...clone.userData, isolatedDisplay: true };
    const replace = new Set(
      screenSlots
        .filter((s) => s.mat === primary.mat)
        .map((s) => s.mesh),
    );
    for (const mesh of replace) {
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => (m === primary.mat ? clone : m));
      } else {
        mesh.material = clone;
      }
    }
    screenMat = clone;
  }

  return screenMat;
}

function findScreenMaterial(root: THREE.Object3D, preferredName: string): THREE.MeshStandardMaterial | null {
  const isolated = isolateScreenMaterials(root, preferredName);
  if (isolated) return isolated;

  let preferred: THREE.MeshStandardMaterial | null = null;
  let fallback: THREE.MeshStandardMaterial | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      if (mat.name === preferredName) preferred = standard;
      if (!fallback && isDisplayScreenMaterialName(mat.name || '')) fallback = standard;
    }
  });
  return preferred ?? fallback;
}

function isGlassMaterial(
  mat: THREE.Material,
  screenMat: string,
  extraNames: Set<string>,
  tweakGlassNames: Set<string>,
): boolean {
  const name = mat.name || '';
  if (!name || name === screenMat) return false;
  if (extraNames.has(name) || tweakGlassNames.has(name)) return true;
  const lower = name.toLowerCase();
  // Real display slot only — body finishes like Screen_Graphite stay opaque.
  if (isDisplayScreenMaterialName(name)) return false;
  if (/glass|gloss|crystal|lens|sapphire|transparent|window|visor|element/.test(lower)) return true;
  const standard = mat as THREE.MeshStandardMaterial;
  const physical = mat as THREE.MeshPhysicalMaterial;
  if (standard.transparent && typeof standard.opacity === 'number' && standard.opacity < 0.55) return true;
  if ('transmission' in physical && (physical.transmission ?? 0) > 0.05) return true;
  return false;
}

function replaceMaterialEverywhere(
  root: THREE.Object3D,
  from: THREE.Material,
  to: THREE.Material,
) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.material === from) {
      mesh.material = to;
      return;
    }
    if (Array.isArray(mesh.material)) {
      for (let i = 0; i < mesh.material.length; i += 1) {
        if (mesh.material[i] === from) mesh.material[i] = to;
      }
    }
  });
}

function upgradeToPhysical(
  root: THREE.Object3D,
  mat: THREE.Material,
): THREE.MeshPhysicalMaterial {
  if ((mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return mat as THREE.MeshPhysicalMaterial;
  }

  // Keep bump / AO / clearcoat / transmission maps — dropping those is what
  // made some authored product surfaces look flatter than Spline / Blender.
  const phys = physicalFromAuthored(mat);
  phys.userData = { ...phys.userData, glassUpgraded: true };
  replaceMaterialEverywhere(root, mat, phys);
  return phys;
}

/** Screen glass. The style sets roughness and clearcoat; intensity must stay above 0 or the clearcoat lobe is black. */
function applyScreenClearcoat(
  screenMaterial: THREE.MeshStandardMaterial,
  style: ReflectionStyle,
  amount: number,
  clay: boolean,
  envMap?: THREE.Texture | null,
) {
  const physical = (screenMaterial as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
    ? screenMaterial as THREE.MeshPhysicalMaterial
    : null;
  if (!physical) return;
  applySurfaceLook(physical, surfaceLook('screen', style, amount, clay), envMap ?? null);
}

function applyGlassReflection(
  root: THREE.Object3D,
  screenMat: string,
  style: ReflectionStyle,
  amount: number,
  clay: boolean,
  glassMats: string[] = [],
  tweaks?: Record<string, Record<string, number | boolean | string>>,
  envMap?: THREE.Texture | null,
  screenMaterial?: THREE.MeshStandardMaterial | null,
) {
  const t = Math.min(1, Math.max(0, amount));
  if (screenMaterial) applyScreenClearcoat(screenMaterial, style, amount, clay, envMap);

  const extraNames = new Set(glassMats);
  const tweakGlassNames = new Set(
    Object.entries(tweaks ?? {})
      .filter(([, tweak]) => tweak.transparent === true || (typeof tweak.opacity === 'number' && tweak.opacity < 0.4))
      .map(([name]) => name),
  );
  const seen = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat) || mat === screenMaterial) continue;
      if (!isGlassMaterial(mat, screenMat, extraNames, tweakGlassNames)) continue;
      seen.add(mat);
      const physical = upgradeToPhysical(root, mat);
      seen.add(physical);
      const lower = (physical.name || '').toLowerCase();
      const thinCover = /screen\s*glass|lensinglass|camglass|cam.?glass|camera.?glass|sapphire|glass\.00|base_glass(?!_black)|front_?element|antenna_?window|cpp_?glasses|eye.?transparent/.test(lower)
        && !/back|body|panel|frame|frosted/.test(lower);

      const look = surfaceLook('glass', style, amount, clay);
      applySurfaceLook(physical, look, envMap ?? null);
      physical.specularColor = new THREE.Color(0xffffff);

      if (thinCover) {
        // Additive glass sheet over the display — env highlights without hiding the image
        physical.color = new THREE.Color(0xffffff);
        physical.transparent = true;
        physical.depthWrite = false;
        physical.blending = THREE.AdditiveBlending;
        physical.opacity = style === 'mirror' ? 0.55 + t * 0.3 : style === 'matte' ? 0.12 : 0.28 + t * 0.3;
        mesh.renderOrder = 2;
      } else if (physical.transparent || (physical.opacity ?? 1) < 0.55) {
        physical.blending = THREE.NormalBlending;
        physical.transparent = true;
        physical.depthWrite = false;
        physical.opacity = style === 'mirror' ? 0.5 : style === 'matte' ? 0.14 : 0.32;
      } else {
        physical.blending = THREE.NormalBlending;
        physical.depthWrite = true;
      }

      physical.needsUpdate = true;
    }
  });
}

const SCREEN_DROP_COLOR = '#d6ff3a';

/** Recolors the display while a file is dragged over it so the drop hotspot is obvious. */
function ScreenDropHighlight({
  root,
  active,
  material,
}: {
  root: THREE.Object3D;
  active: boolean;
  material: THREE.Material | null;
}) {
  const matsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const screenMatRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useLayoutEffect(() => {
    if (!active || !material) return undefined;
    const screenMat = material as THREE.MeshStandardMaterial;
    const previousEmissive = screenMat.emissive?.clone?.() ?? new THREE.Color(0xffffff);
    const previousIntensity = screenMat.emissiveIntensity ?? 1;
    if (screenMat.emissive) screenMat.emissive.set(SCREEN_DROP_COLOR);
    screenMat.emissiveIntensity = 1.2;
    screenMat.needsUpdate = true;
    screenMatRef.current = screenMat;

    const added: THREE.Mesh[] = [];
    const mats: THREE.MeshBasicMaterial[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!list.some((entry) => entry === material)) return;
      const mat = new THREE.MeshBasicMaterial({
        name: 'screen-drop-highlight',
        color: SCREEN_DROP_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.name = 'screen-drop-highlight';
      overlay.renderOrder = 30;
      overlay.raycast = () => {};
      mesh.add(overlay);
      added.push(overlay);
      mats.push(mat);
    });
    matsRef.current = mats;
    return () => {
      if (screenMat.emissive) screenMat.emissive.copy(previousEmissive);
      screenMat.emissiveIntensity = previousIntensity;
      screenMat.needsUpdate = true;
      screenMatRef.current = null;
      for (const overlay of added) overlay.parent?.remove(overlay);
      for (const mat of mats) mat.dispose();
      matsRef.current = [];
    };
  }, [active, root, material]);

  useFrame(({ clock, invalidate }) => {
    if (!matsRef.current.length && !screenMatRef.current) return;
    const pulse = 0.5 + Math.sin(clock.elapsedTime * 5.5) * 0.18;
    for (const mat of matsRef.current) mat.opacity = pulse;
    const screenMat = screenMatRef.current;
    if (screenMat) screenMat.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 5.5) * 0.35;
    // Demand frameloop: keep pulsing while the drop highlight is mounted.
    invalidate();
  });

  return null;
}

/** Keeps the demand frameloop alive while media / continuous contact shadows need frames. */
function DemandKeepAlive({ active }: { active: boolean }) {
  useFrame(({ invalidate }) => {
    if (active) invalidate();
  });
  return null;
}

function poseOpenAnimation(root: THREE.Object3D, animations: THREE.AnimationClip[]) {
  if (!animations.length) return;
  const clip = animations.find((a) => /open/i.test(a.name)) ?? animations[0];
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  // Prefer fully open pose for mockups
  mixer.setTime(clip.duration);
  root.updateMatrixWorld(true);
}

/** Keeps a single bad GLB from tearing down the whole R3F canvas (black UI). */
class GltfLoadBoundary extends Component<
  { url: string; children: ReactNode },
  { failedUrl: string | null }
> {
  state: { failedUrl: string | null } = { failedUrl: null };

  static getDerivedStateFromError(): { failedUrl: string | null } {
    return { failedUrl: '' };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.warn('[device-model]', this.props.url, error.message);
    this.setState({ failedUrl: this.props.url });
  }

  componentDidUpdate(prev: { url: string }) {
    if (prev.url !== this.props.url && this.state.failedUrl != null) {
      this.setState({ failedUrl: null });
    }
  }

  render() {
    if (this.state.failedUrl != null && this.state.failedUrl === this.props.url) return null;
    if (this.state.failedUrl === '') return null;
    return this.props.children;
  }
}

function GltfDeviceContent({
  url,
  deviceId,
  screenshot,
  liveStream,
  glassReflection,
  reflectionStyle,
  deviceColor,
  clayMode,
  mediaPlaying,
  lidOpen = 1,
  dropHighlight = false,
  materialTweaks,
  hiddenMeshes,
  /** DEV modeling: keep brand marks visible so they can be removed from the panel. */
  preserveBrandMarks = false,
  selectedMaterialName = null,
}: {
  url: string;
  deviceId: string;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  glassReflection: number;
  reflectionStyle: ReflectionStyle;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
  lidOpen?: number;
  dropHighlight?: boolean;
  materialTweaks?: Record<string, Record<string, number | boolean | string | null>>;
  hiddenMeshes?: string[];
  preserveBrandMarks?: boolean;
  selectedMaterialName?: string | null;
}) {
  const device = getDevice(deviceId);
  const mergedTweaks = useMemo(() => {
    if (!device.tweaks && !materialTweaks) return undefined;
    const names = new Set([
      ...Object.keys(device.tweaks ?? {}),
      ...Object.keys(materialTweaks ?? {}),
    ]);
    const out: Record<string, Record<string, number | boolean | string | null>> = {};
    for (const name of names) {
      out[name] = { ...(device.tweaks?.[name] ?? {}), ...(materialTweaks?.[name] ?? {}) };
    }
    return out;
  }, [device.tweaks, materialTweaks]);
  const { scene, animations } = useGLTF(url);
  const lidRigRef = useRef<LidRig | null>(null);
  const hiddenMeshKey = (hiddenMeshes ?? []).join('\0');
  const root = useMemo(() => {
    const hasSkin = Boolean(scene.getObjectByProperty('isSkinnedMesh', true));
    const cloned = (hasSkin ? cloneSkinned(scene) : scene.clone(true)) as THREE.Object3D;
    const map = new Map<THREE.Material, THREE.Material>();
    // DEV modeling keeps library hideNodes / auto logos visible so parts can be
    // removed from the panel. User mode still applies the authored cleanup.
    const libraryHide = preserveBrandMarks ? [] : (device.hideNodes ?? []);
    const hidden = new Set([
      ...libraryHide,
      ...(hiddenMeshes ?? []),
    ]);
    if (!preserveBrandMarks) {
      hideBrandMarks(cloned, { hideNodes: libraryHide });
    }
    const drop: THREE.Object3D[] = [];
    cloned.traverse((obj) => {
      if (hidden.has(obj.name) || (!preserveBrandMarks && isBrandLogoObject(obj))) {
        obj.visible = false;
      }
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (hidden.has(mesh.name)) mesh.visible = false;
      if (device.dropNameIncludes?.some((part) => mesh.name.includes(part))) drop.push(mesh);
      const assign = (mat: THREE.Material) => {
        let next = map.get(mat);
        if (!next) {
          next = mat.clone();
          map.set(mat, next);
        }
        return next;
      };
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(assign);
      else if (mesh.material) mesh.material = assign(mesh.material);
    });
    for (const mesh of drop) mesh.removeFromParent();
    // Studio key/fill own lighting — drop cameras / leftover lights from the GLB.
    stripSceneHelpers(cloned);
    // Laptop lids are driven by lidOpen — don't freeze an embedded clip pose.
    if (device.lid) {
      try {
        lidRigRef.current = setupLidRig(cloned, device.lid, device.screenMat);
      } catch (error) {
        console.warn('Lid rig setup failed; showing model without lid control', error);
        lidRigRef.current = null;
      }
    } else {
      lidRigRef.current = null;
      poseOpenAnimation(cloned, animations);
    }
    return cloned;
    // hiddenMeshKey stands in for hiddenMeshes contents without array-identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, animations, device.lid, device.screenMat, device.hideNodes, device.dropNameIncludes, hiddenMeshKey, preserveBrandMarks]);

  useLayoutEffect(() => {
    if (!lidRigRef.current) return;
    applyLidOpen(lidRigRef.current, lidOpen);
  }, [lidOpen, root]);

  const [screen, setScreen] = useState<{
    material: THREE.MeshPhysicalMaterial;
    originalEmissiveMap: THREE.Texture | null;
  } | null>(null);

  // Fit once per mounted mesh — not on colour / clay / material picks.
  // Those cosmetic updates used to re-run world-space centering and shove the
  // body off the gimbal whenever the parent pivots were already posed.
  useLayoutEffect(() => {
    fitDeviceRoot(root, device.rot, device.screenMat);
    if (device.uv.planar) planarizeScreen(root, device.screenMat);
  }, [root, device.id, device.rot[0], device.rot[1], device.rot[2], device.uv.planar, device.screenMat]);

  useEffect(() => {
    let cancelled = false;
    const processed = new Set<THREE.Material>();
    const textureJobs: Promise<void>[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat || processed.has(mat)) continue;
        processed.add(mat);
        const tweak = mergedTweaks?.[mat.name];
        if (tweak) {
          applyMaterialTweaks(root, mat as THREE.MeshStandardMaterial, tweak);
          textureJobs.push(applyMaterialTextureTweaks(mat as THREE.MeshStandardMaterial, tweak));
        }
      }
    });

    // Headphones / cases have no display — don't turn a body material into a
    // black emissive "screen" (that is what made AirPods look flat graphite).
    // Imported GLBs also refuse non-display names so authored finishes stay intact.
    let found = device.hasScreen === false
      ? null
      : findScreenMaterial(root, device.screenMat);
    if (found && device.lockMaterials) {
      const name = found.name || '';
      const looksLikeScreen = Boolean(found.userData?.isolatedDisplay)
        || isDisplayScreenMaterialName(name)
        || (/screen|display|oled|lcd/i.test(name) && !/glass/i.test(name));
      if (!looksLikeScreen) found = null;
    }
    if (found) {
      // Isolated display clones must not run replaceMaterialEverywhere on the body.
      const screenMaterial = found.userData?.isolatedDisplay
        ? ((found as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
          ? found as THREE.MeshPhysicalMaterial
          : (() => {
            const phys = physicalFromAuthored(found);
            phys.name = found.name;
            phys.userData = { ...found.userData, glassUpgraded: true, isolatedDisplay: true };
            replaceMaterialEverywhere(root, found, phys);
            return phys;
          })())
        : upgradeToPhysical(root, found);

      // First configure only — re-entry must not wipe a painted placeholder
      // (white emissive + null map was the green↔white flicker).
      const alreadyConfigured = Boolean(screenMaterial.userData?.studioScreenConfigured);
      let uvReference = screenMaterial.userData?.studioUvReference as THREE.Texture | null | undefined;
      if (!alreadyConfigured) {
        // Keep UV from the authored emissive/albedo before clearing the atlas map.
        const authoredEmissive = (found.emissiveMap || null) as THREE.Texture | null;
        uvReference = (authoredEmissive || found.map || null) as THREE.Texture | null;
        screenMaterial.userData.studioUvReference = uvReference ?? null;
        screenMaterial.userData.studioScreenConfigured = true;
        // Off until useScreenEmissiveMap paints — black plate, not white flash.
        screenMaterial.emissive = new THREE.Color(0x000000);
        screenMaterial.emissiveIntensity = 1;
        screenMaterial.toneMapped = false;
        screenMaterial.metalness = 0;
        screenMaterial.roughness = 1;
        screenMaterial.envMapIntensity = 0;
        screenMaterial.clearcoat = 0;
        screenMaterial.clearcoatRoughness = 0.2;
        screenMaterial.color = new THREE.Color(0x000000);
        screenMaterial.map = null;
        screenMaterial.emissiveMap = null;
        screenMaterial.transparent = false;
        screenMaterial.opacity = 1;
        screenMaterial.blending = THREE.NormalBlending;
        screenMaterial.needsUpdate = true;
      } else {
        // Cosmetic re-runs: keep the live emissiveMap / UV reference intact.
        screenMaterial.toneMapped = false;
        screenMaterial.color = new THREE.Color(0x000000);
        screenMaterial.map = null;
        screenMaterial.transparent = false;
        screenMaterial.opacity = 1;
        screenMaterial.blending = THREE.NormalBlending;
        if (screenMaterial.emissiveMap) {
          screenMaterial.emissive = new THREE.Color(0xffffff);
          screenMaterial.emissiveIntensity = 1;
        }
        screenMaterial.needsUpdate = true;
      }

      const nextUv = (uvReference ?? null) as THREE.Texture | null;
      setScreen((prev) => (
        prev?.material === screenMaterial && prev.originalEmissiveMap === nextUv
          ? prev
          : { material: screenMaterial, originalEmissiveMap: nextUv }
      ));
    } else {
      setScreen(null);
    }
    applyDeviceFinish(root, device.screenMat, deviceColor, clayMode, device.lockMaterials);
    void Promise.all(textureJobs).then(() => {
      if (cancelled) return;
      highlightMaterialSelection(root, selectedMaterialName, device.screenMat);
    });
    return () => { cancelled = true; };
  }, [
    root,
    device.id,
    device.hasScreen,
    device.lockMaterials,
    device.screenMat,
    deviceColor,
    clayMode,
    mergedTweaks,
    selectedMaterialName,
  ]);

  useEffect(() => {
    highlightMaterialSelection(root, selectedMaterialName, device.screenMat);
  }, [root, selectedMaterialName, device.screenMat]);

  const envMap = useContext(SceneEnvMapContext);
  const screenMaterial = screen?.material ?? null;
  useEffect(() => {
    // Imported GLBs / scene sets keep authored metal, glass, transmission, and maps.
    // Only attach the studio HDRI so reflections still light under in-app softboxes.
    if (device.hasScreen === false || device.lockMaterials) {
      try {
        const skip = new Set<string>();
        if (screenMaterial?.name) skip.add(screenMaterial.name);
        if (device.screenMat) skip.add(device.screenMat);
        attachStudioEnvMap(root, envMap, skip);
      } catch (err) {
        console.warn('[authored env map]', err);
      }
      return;
    }
    try {
      applyGlassReflection(
        root,
        device.screenMat,
        reflectionStyle,
        glassReflection,
        clayMode,
        device.glassMats,
        mergedTweaks as Record<string, Record<string, number | boolean | string>> | undefined,
        envMap,
        screenMaterial,
      );
    } catch (err) {
      console.warn('[glass reflection]', err);
    }
  }, [
    root,
    device.id,
    device.hasScreen,
    device.lockMaterials,
    device.screenMat,
    device.glassMats,
    glassReflection,
    reflectionStyle,
    envMap,
    screenMaterial,
    clayMode,
    mergedTweaks,
  ]);

  const applyUv = useCallback((tex: THREE.Texture, original?: THREE.Texture | null) => {
    applyUvTransform(tex, device.uv, original);
  }, [device.uv]);

  useScreenEmissiveMap({
    material: screen?.material ?? null,
    originalEmissiveMap: screen?.originalEmissiveMap ?? null,
    screenshot,
    liveStream,
    width: device.screenSize.width,
    height: device.screenSize.height,
    inset: device.screenInset,
    applyUv,
    playing: mediaPlaying,
  });

  return (
    <>
      <primitive object={root} />
      <ScreenDropHighlight root={root} active={dropHighlight} material={screen?.material ?? null} />
    </>
  );
}

function clampDevicePosition(position: THREE.Vector3) {
  position.x = Math.min(10, Math.max(-10, position.x));
  position.y = Math.min(6, Math.max(-6, position.y));
  position.z = Math.min(8, Math.max(-8, position.z));
  return position;
}

function deviceGrabId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.deviceGrabId;
    if (typeof id === 'string') return id;
    current = current.parent;
  }
  return null;
}

function propGrabId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.propGrabId;
    if (typeof id === 'string') return id;
    current = current.parent;
  }
  return null;
}

type GrabHit = { kind: 'device' | 'prop'; id: string; distance: number };

/** True when the hit belongs to a translate axis arrow (not a rotate ring). */
function isTranslateGizmoHandle(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.userData.gizmoTool === 'translate') return true;
    if (node.userData.gizmoTool === 'rotate') return false;
    node = node.parent;
  }
  return false;
}

/**
 * Nearest grabbable object along the ray. A gizmo farther down the ray must
 * not cancel the object in front of it. On touch, another object still wins
 * when a fat ring is only slightly closer — that is what makes a second
 * device selectable with a finger.
 */
function pickGrabTarget(
  hits: THREE.Intersection[],
  selectedDeviceId: string | null,
  touchLike: boolean,
): { object: GrabHit | null; gizmoWins: boolean } {
  let gizmoDistance = Number.POSITIVE_INFINITY;
  let translateGizmoDistance = Number.POSITIVE_INFINITY;
  let solidDistance = Number.POSITIVE_INFINITY;
  let object: GrabHit | null = null;
  for (const hit of hits) {
    const kind = classifyPointerHit(hit.object);
    if (kind === 'skip') continue;
    if (kind === 'gizmo') {
      if (gizmoDistance === Number.POSITIVE_INFINITY) gizmoDistance = hit.distance;
      if (
        translateGizmoDistance === Number.POSITIVE_INFINITY
        && isTranslateGizmoHandle(hit.object)
      ) {
        translateGizmoDistance = hit.distance;
      }
      continue;
    }
    if (solidDistance === Number.POSITIVE_INFINITY) solidDistance = hit.distance;
    // Floor / backdrop / contact-shadow meshes are solid but not grabbable —
    // keep scanning so a nearer ground hit can still beat a farther gizmo.
    const deviceId = deviceGrabId(hit.object);
    if (deviceId) {
      object = { kind: 'device', id: deviceId, distance: hit.distance };
      break;
    }
    const propId = propGrabId(hit.object);
    if (propId) {
      object = { kind: 'prop', id: propId, distance: hit.distance };
      break;
    }
  }
  if (gizmoDistance === Number.POSITIVE_INFINITY) return { object, gizmoWins: false };
  // Empty canvas / floor: rotate rings stay suppressed so fat tubes do not
  // freeze orbit beside the model. Translate arrows stick out past the
  // silhouette — especially when zoomed out — so let them win when the
  // shaft is clearly in front of the floor/backdrop. Pickers behind the
  // surface still lose (that path used to teleport the device).
  if (!object) {
    if (solidDistance < Number.POSITIVE_INFINITY) {
      if (
        translateGizmoDistance < Number.POSITIVE_INFINITY
        && translateGizmoDistance <= solidDistance + 0.35
      ) {
        return { object: null, gizmoWins: true };
      }
      return { object: null, gizmoWins: false };
    }
    return {
      object: null,
      gizmoWins: gizmoDistance < Number.POSITIVE_INFINITY,
    };
  }
  // Axis arrows sit on / just behind the body silhouette. If we only let the
  // closer hit win, suppressGesture kills the coloured arrows and the body
  // free-rotate steals left/right/up/down moves. Keep a generous slack so
  // tips beside the body still win when the gizmo is large on screen.
  if (
    translateGizmoDistance < Number.POSITIVE_INFINITY
    && translateGizmoDistance <= object.distance + 2.5
  ) {
    return { object, gizmoWins: true };
  }
  const gap = object.distance - gizmoDistance;
  if (gap <= 0) return { object, gizmoWins: false };
  // Mouse: whichever is closer wins so rings in front of the body lock the
  // camera instead of starting an orbit. Touch keeps a fat-ring bias so a
  // second device under a ring stays selectable.
  if (!touchLike) return { object, gizmoWins: true };
  const preferSolidGap = object.kind === 'prop' || object.id !== selectedDeviceId ? 1.35 : 0.95;
  if (gap < preferSolidGap) return { object, gizmoWins: false };
  return { object, gizmoWins: true };
}

/** Prefer floor / backdrop wall / sky from an empty-canvas ray. */
function emptyCanvasColourTarget(hits: THREE.Intersection[]): 'sky' | 'floor' | 'backdrop' {
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      if (node.userData?.isStudioBackdrop) return 'backdrop';
      if (node.userData?.orbitPickFloor) return 'floor';
      if (node.userData?.isStudioSky) return 'sky';
      node = node.parent;
    }
  }
  return 'sky';
}

function classifyPointerHit(object: THREE.Object3D): 'skip' | 'gizmo' | 'solid' {
  if ((object as THREE.Object3D & { isTransformControlsPlane?: boolean }).isTransformControlsPlane) return 'skip';
  // Walk ancestors — translate arrow pickers are Meshes inside a marked handle
  // group. Checking only the leaf skipped those hits, suppressGesture then
  // disabled TransformControls, and the coloured arrows felt dead.
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.userData.isGizmoHandle) return 'gizmo';
    node = node.parent;
  }
  let parent: THREE.Object3D | null = object.parent;
  while (parent) {
    if ((parent as THREE.Object3D & { isTransformControls?: boolean }).isTransformControls) return 'skip';
    if ((parent as THREE.Object3D & { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo) return 'skip';
    parent = parent.parent;
  }
  if (!object.visible) return 'skip';
  const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (material) {
    const list = Array.isArray(material) ? material : [material];
    if (list.length > 0 && list.every((entry) => entry && entry.visible === false)) return 'skip';
  }
  return 'solid';
}

function pointerNdc(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
}

/** Stable Euler readout matching DeviceModelView / RotationBall. */
function readObjectRotation(object: THREE.Object3D): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
  const toDeg = (rad: number) => {
    let deg = THREE.MathUtils.radToDeg(rad);
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    return Number(deg.toFixed(1));
  };
  return { x: toDeg(euler.x), y: toDeg(euler.y), z: toDeg(euler.z) };
}

/**
 * Spin a device under the pointer relative to the camera so left-drag on the
 * body tumbles freely (not locked to a single axis ring).
 */
function applyTrackballDelta(
  object: THREE.Object3D,
  camera: THREE.Camera,
  dx: number,
  dy: number,
  sensitivity = 0.0075,
) {
  if (dx === 0 && dy === 0) return;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const qYaw = new THREE.Quaternion().setFromAxisAngle(up, dx * sensitivity);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(right, dy * sensitivity);
  object.quaternion.premultiply(qYaw).premultiply(qPitch).normalize();
}

/**
 * Drag a device by grabbing its body. Runs in the capture phase so it can
 * claim the click before the gimbal and the orbit controls.
 */
function hitDeviceId(
  raycaster: THREE.Raycaster,
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  scene: THREE.Scene,
  element: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const rect = element.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  ndc.set(
    ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    const kind = classifyPointerHit(hit.object);
    if (kind === 'skip' || kind === 'gizmo') continue;
    return deviceGrabId(hit.object);
  }
  return null;
}

/** Tracks the device under the pointer and opens the action menu on right-click. */
function DevicePointerBridge({
  onHoverDevice,
  onDragTargetDevice,
  onContextMenuDevice,
}: {
  onHoverDevice?: (id: string | null) => void;
  onDragTargetDevice?: (id: string | null) => void;
  onContextMenuDevice?: (payload: DeviceSelectPayload) => void;
}) {
  const { camera, gl, scene } = useThree();
  const onHoverRef = useRef(onHoverDevice);
  const onDragTargetRef = useRef(onDragTargetDevice);
  const onMenuRef = useRef(onContextMenuDevice);
  onHoverRef.current = onHoverDevice;
  onDragTargetRef.current = onDragTargetDevice;
  onMenuRef.current = onContextMenuDevice;

  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let frame = 0;
    let pending: { x: number; y: number } | null = null;
    let rightDown: { x: number; y: number } | null = null;

    const publishHover = (x: number, y: number) => {
      onHoverRef.current?.(hitDeviceId(raycaster, ndc, camera, scene, element, x, y));
    };

    const onMove = (event: PointerEvent) => {
      pending = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        publishHover(pending.x, pending.y);
      });
    };
    const onLeave = () => {
      pending = null;
      onHoverRef.current?.(null);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      rightDown = { x: event.clientX, y: event.clientY };
    };
    const onContext = (event: MouseEvent) => {
      const moved = rightDown
        && (Math.abs(event.clientX - rightDown.x) > 6 || Math.abs(event.clientY - rightDown.y) > 6);
      rightDown = null;
      if (moved) {
        event.preventDefault();
        return;
      }
      const id = hitDeviceId(raycaster, ndc, camera, scene, element, event.clientX, event.clientY);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      onMenuRef.current?.({ id, clientX: event.clientX, clientY: event.clientY, openMenu: true });
    };

    const onDragOver = (event: DragEvent) => {
      const types = event.dataTransfer?.types;
      if (!types || !Array.from(types).includes('Files')) return;
      onDragTargetRef.current?.(hitDeviceId(raycaster, ndc, camera, scene, element, event.clientX, event.clientY));
    };
    const onDragLeave = () => onDragTargetRef.current?.(null);

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('contextmenu', onContext);
    element.addEventListener('dragover', onDragOver);
    element.addEventListener('dragleave', onDragLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('contextmenu', onContext);
      element.removeEventListener('dragover', onDragOver);
      element.removeEventListener('dragleave', onDragLeave);
    };
  }, [camera, gl, scene]);

  return null;
}

function DeviceGrabController({
  registry,
  propRegistry,
  selectedIdRef,
  gizmoControlRef,
  gizmoDraggingRef,
  annotateRef,
  onSelect,
  onMove,
  onRotate,
  onSelectProp,
  onMoveProp,
  onRotateProp,
  onSelectEmpty,
  onDraggingChange,
  materialEditEnabled = false,
  onPickMaterial,
}: {
  registry: MutableRefObject<Map<string, THREE.Object3D>>;
  propRegistry: MutableRefObject<Map<string, THREE.Object3D>>;
  selectedIdRef: MutableRefObject<string | null>;
  gizmoControlRef: MutableRefObject<GizmoControl | null>;
  gizmoDraggingRef: MutableRefObject<boolean>;
  annotateRef: MutableRefObject<boolean>;
  onSelect?: (payload: DeviceSelectPayload) => void;
  onMove?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onRotate?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onSelectProp?: (id: string) => void;
  onMoveProp?: (id: string, position: Vec3) => void;
  onRotateProp?: (id: string, rotation: Vec3) => void;
  /** Clean tap on empty surround / floor / cyclorama (no device or shape). */
  onSelectEmpty?: (target: 'sky' | 'floor' | 'backdrop') => void;
  onDraggingChange?: (dragging: boolean) => void;
  materialEditEnabled?: boolean;
  onPickMaterial?: (payload: MaterialPickPayload) => void;
}) {
  const { camera, gl, scene, controls } = useThree();
  const draggingRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onMoveRef = useRef(onMove);
  const onRotateRef = useRef(onRotate);
  const onSelectPropRef = useRef(onSelectProp);
  const onPickMaterialRef = useRef(onPickMaterial);
  const materialEditRef = useRef(materialEditEnabled);
  onPickMaterialRef.current = onPickMaterial;
  materialEditRef.current = materialEditEnabled;
  const onMovePropRef = useRef(onMoveProp);
  const onRotatePropRef = useRef(onRotateProp);
  const onSelectEmptyRef = useRef(onSelectEmpty);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onSelectRef.current = onSelect;
  onMoveRef.current = onMove;
  onRotateRef.current = onRotate;
  onSelectPropRef.current = onSelectProp;
  onMovePropRef.current = onMoveProp;
  onRotatePropRef.current = onRotateProp;
  onSelectEmptyRef.current = onSelectEmpty;
  onDraggingChangeRef.current = onDraggingChange;

  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    // Layer 1 = cyclorama. Layer 2 = invisible orbit floor (kept off the contact-shadow pass).
    raycaster.layers.enable(1);
    raycaster.layers.enable(2);
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();
    const world = new THREE.Vector3();
    const grabOffset = new THREE.Vector3();
    const normal = new THREE.Vector3();

    const onCapture = (event: PointerEvent) => {
      if (annotateRef.current) return;
      if (!event.isPrimary || draggingRef.current || gizmoDraggingRef.current) return;
      const touchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
      if (!touchLike && event.button !== 0) return;
      const orbit = controls as { enabled?: boolean; enableRotate?: boolean; enablePan?: boolean } | null;
      // Space-pan remaps left-drag to camera pan — don't steal that gesture.
      if (orbit?.enablePan && orbit.enableRotate === false) return;

      const rect = element.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const picked = pickGrabTarget(hits, selectedIdRef.current, touchLike);
      // Floor / empty canvas in front of fat gizmo pickers: suppress the gimbal
      // for this gesture. Otherwise TransformControls still raycasts its invisible
      // rings behind the floor and teleports the device on the tap.
      if (!picked.gizmoWins) {
        gizmoControlRef.current?.suppressGesture();
      }
      // Axis rings / arrows (even outside the body silhouette): kill camera
      // orbit in capture before OrbitControls sees the same pointerdown.
      // Do not stopImmediatePropagation — TransformControls still needs it.
      if (picked.gizmoWins) {
        const orbitCtrl = controls as { enabled?: boolean } | null;
        if (orbitCtrl) orbitCtrl.enabled = false;
        const restoreOrbit = (ev: PointerEvent) => {
          if (ev.pointerId !== event.pointerId) return;
          window.removeEventListener('pointerup', restoreOrbit, true);
          window.removeEventListener('pointercancel', restoreOrbit, true);
          requestAnimationFrame(() => {
            // RotationBall owns gizmoDraggingRef while a handle drag is live.
            if (orbitCtrl && !gizmoDraggingRef.current) orbitCtrl.enabled = true;
          });
        };
        window.addEventListener('pointerup', restoreOrbit, true);
        window.addEventListener('pointercancel', restoreOrbit, true);
        // Gizmo sits in front of the body — still resolve a surface colour pick
        // on a clean click so the right-hand material panel lights up.
        if (materialEditRef.current) {
          const deviceHit = hits.find((hit) => (
            classifyPointerHit(hit.object) === 'solid' && Boolean(deviceGrabId(hit.object))
          ));
          const resolved = deviceHit ? materialFromHit(deviceHit) : null;
          const deviceId = deviceHit ? deviceGrabId(deviceHit.object) : null;
          if (resolved && deviceId) {
            const startX = event.clientX;
            const startY = event.clientY;
            const pointerId = event.pointerId;
            let moved = false;
            const onMovePick = (ev: PointerEvent) => {
              if (ev.pointerId !== pointerId) return;
              if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) moved = true;
            };
            const onUpPick = (ev: PointerEvent) => {
              if (ev.pointerId !== pointerId) return;
              window.removeEventListener('pointermove', onMovePick, true);
              window.removeEventListener('pointerup', onUpPick, true);
              window.removeEventListener('pointercancel', onUpPick, true);
              if (moved || gizmoDraggingRef.current) return;
              const standard = resolved.material as THREE.MeshStandardMaterial;
              const hex = standard?.color?.getHexString?.();
              onSelectRef.current?.({
                id: deviceId,
                clientX: startX,
                clientY: startY,
                openMenu: false,
              });
              onPickMaterialRef.current?.({
                deviceInstanceId: deviceId,
                materialName: resolved.name,
                meshName: resolved.meshName,
                colorHex: hex ? `#${hex}` : undefined,
              });
            };
            window.addEventListener('pointermove', onMovePick, true);
            window.addEventListener('pointerup', onUpPick, true);
            window.addEventListener('pointercancel', onUpPick, true);
          }
        }
        return;
      }
      // Empty canvas / surround / floor (no device/prop): orbit on drag; clean tap opens colour dock.
      if (!picked.object) {
        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        const emptyTarget = emptyCanvasColourTarget(hits);
        let moved = false;
        const onMoveEmpty = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
        };
        const onUpEmpty = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          window.removeEventListener('pointermove', onMoveEmpty, true);
          window.removeEventListener('pointerup', onUpEmpty, true);
          window.removeEventListener('pointercancel', onUpEmpty, true);
          if (moved || gizmoDraggingRef.current || draggingRef.current) return;
          onSelectEmptyRef.current?.(emptyTarget);
        };
        window.addEventListener('pointermove', onMoveEmpty, true);
        window.addEventListener('pointerup', onUpEmpty, true);
        window.addEventListener('pointercancel', onUpEmpty, true);
        return;
      }

      const target = picked.object;
      const group = (target.kind === 'device' ? registry : propRegistry).current.get(target.id);
      if (!group) return;

      const rotatePivot = group.userData.rotationPivot as THREE.Object3D | undefined;
      // Rotato-style: plain left-drag orbits even over the device. Shift slides,
      // Alt/Option tumbles. Touch/pen keeps slide-to-reposition.
      const wantOrbitOverBody = !touchLike && !event.shiftKey && !event.altKey;
      const wantFreeRotate = !touchLike && event.altKey && Boolean(rotatePivot);
      const wantTranslate = !wantOrbitOverBody && !wantFreeRotate;

      // Plain mouse drag over the body → camera orbit. Still select on a clean click.
      if (wantOrbitOverBody) {
        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        let moved = false;
        let pendingMaterial: MaterialPickPayload | null = null;
        if (materialEditRef.current && target.kind === 'device') {
          const solidHit = hits.find((hit) => (
            classifyPointerHit(hit.object) === 'solid' && deviceGrabId(hit.object) === target.id
          )) ?? hits.find((hit) => classifyPointerHit(hit.object) === 'solid' && Boolean(deviceGrabId(hit.object)));
          const resolved = solidHit ? materialFromHit(solidHit) : null;
          if (resolved) {
            const standard = resolved.material as THREE.MeshStandardMaterial;
            const hex = standard?.color?.getHexString?.();
            pendingMaterial = {
              deviceInstanceId: target.id,
              materialName: resolved.name,
              meshName: resolved.meshName,
              colorHex: hex ? `#${hex}` : undefined,
            };
          }
        }
        const onMoveBody = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) moved = true;
        };
        const onUpBody = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          window.removeEventListener('pointermove', onMoveBody, true);
          window.removeEventListener('pointerup', onUpBody, true);
          window.removeEventListener('pointercancel', onUpBody, true);
          if (moved || gizmoDraggingRef.current || draggingRef.current) return;
          if (target.kind === 'prop') onSelectPropRef.current?.(target.id);
          else {
            onSelectRef.current?.({
              id: target.id,
              clientX: startX,
              clientY: startY,
              openMenu: false,
            });
            if (pendingMaterial) onPickMaterialRef.current?.(pendingMaterial);
          }
        };
        window.addEventListener('pointermove', onMoveBody, true);
        window.addEventListener('pointerup', onUpBody, true);
        window.addEventListener('pointercancel', onUpBody, true);
        return;
      }

      event.stopImmediatePropagation();
      if (touchLike) event.preventDefault();
      const previousOrbit = orbit?.enabled !== false;
      if (orbit) orbit.enabled = false;

      group.getWorldPosition(world);
      camera.getWorldDirection(normal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
      if (wantTranslate && !raycaster.ray.intersectPlane(plane, hitPoint)) {
        if (orbit) orbit.enabled = previousOrbit;
        return;
      }
      let translateReady = false;
      if (wantTranslate) {
        grabOffset.copy(hitPoint).sub(world);
        translateReady = true;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      let lastX = startX;
      let lastY = startY;
      const pointerId = event.pointerId;
      let moved = false;
      let menuOpened = false;
      let mode: 'translate' | 'rotate' = wantTranslate ? 'translate' : 'rotate';
      draggingRef.current = true;
      const slop = touchLike ? 18 : 4;

      let pendingMaterial: MaterialPickPayload | null = null;
      if (materialEditRef.current && target.kind === 'device') {
        // Prefer the tapped device mesh — floor / backdrop can also read as solid.
        const solidHit = hits.find((hit) => (
          classifyPointerHit(hit.object) === 'solid' && deviceGrabId(hit.object) === target.id
        )) ?? hits.find((hit) => classifyPointerHit(hit.object) === 'solid' && Boolean(deviceGrabId(hit.object)));
        const resolved = solidHit ? materialFromHit(solidHit) : null;
        if (resolved) {
          const standard = resolved.material as THREE.MeshStandardMaterial;
          const hex = standard?.color?.getHexString?.();
          pendingMaterial = {
            deviceInstanceId: target.id,
            materialName: resolved.name,
            meshName: resolved.meshName,
            colorHex: hex ? `#${hex}` : undefined,
          };
        }
      }

      const selectTarget = (openMenu: boolean) => {
        if (target.kind === 'prop') {
          onSelectPropRef.current?.(target.id);
          return;
        }
        onSelectRef.current?.({
          id: target.id,
          clientX: startX,
          clientY: startY,
          openMenu,
        });
      };

      const pressTimer = touchLike && target.kind === 'device'
        ? window.setTimeout(() => {
          if (moved) return;
          menuOpened = true;
        }, 480)
        : 0;

      const finish = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.clearTimeout(pressTimer);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        draggingRef.current = false;
        if (orbit) orbit.enabled = previousOrbit;
        if (moved) gizmoControlRef.current?.setEnabled(true);
        element.style.cursor = '';
        if (!moved) {
          if (touchLike && menuOpened) {
            window.setTimeout(() => selectTarget(true), 0);
          } else if (!menuOpened) {
            // Desktop click selects only — menu stays on right-click / long-press.
            selectTarget(false);
            if (pendingMaterial) onPickMaterialRef.current?.(pendingMaterial);
          }
          return;
        }
        if (mode === 'rotate' && rotatePivot) {
          const next = readObjectRotation(rotatePivot);
          if (target.kind === 'prop') onRotatePropRef.current?.(target.id, next);
          else onRotateRef.current?.(target.id, next, { recordKeys: true });
        } else {
          const position = group.position;
          if (target.kind === 'prop') {
            onMovePropRef.current?.(target.id, { x: position.x, y: position.y, z: position.z });
          } else {
            onMoveRef.current?.(target.id, {
              x: position.x,
              y: position.y,
              z: position.z,
            }, { recordKeys: true });
          }
        }
        gizmoDraggingRef.current = false;
        onDraggingChangeRef.current?.(false);
      };

      const publishMove = (next: Vec3) => {
        if (target.kind === 'prop') onMovePropRef.current?.(target.id, next);
        else onMoveRef.current?.(target.id, next, { recordKeys: false });
      };

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved) {
          if (dx * dx + dy * dy < slop * slop) return;
          moved = true;
          mode = (wantFreeRotate && rotatePivot && !ev.shiftKey) ? 'rotate' : 'translate';
          if (mode === 'translate' && !translateReady) {
            const point = pointerNdc(ev, element);
            raycaster.setFromCamera(point, camera);
            if (raycaster.ray.intersectPlane(plane, hitPoint)) {
              group.getWorldPosition(world);
              grabOffset.copy(hitPoint).sub(world);
              translateReady = true;
            }
          }
          window.clearTimeout(pressTimer);
          gizmoControlRef.current?.setEnabled(false);
          gizmoDraggingRef.current = true;
          onDraggingChangeRef.current?.(true);
          selectTarget(false);
          element.style.cursor = 'grabbing';
          lastX = ev.clientX;
          lastY = ev.clientY;
        }

        if (mode === 'rotate' && rotatePivot) {
          const stepX = ev.clientX - lastX;
          const stepY = ev.clientY - lastY;
          lastX = ev.clientX;
          lastY = ev.clientY;
          applyTrackballDelta(rotatePivot, camera, stepX, stepY);
          const next = readObjectRotation(rotatePivot);
          if (target.kind === 'prop') onRotatePropRef.current?.(target.id, next);
          else onRotateRef.current?.(target.id, next, { recordKeys: false });
          return;
        }

        const point = pointerNdc(ev, element);
        raycaster.setFromCamera(point, camera);
        if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;
        hitPoint.sub(grabOffset);
        group.parent?.worldToLocal(hitPoint);
        clampDevicePosition(hitPoint);
        group.position.copy(hitPoint);
        publishMove({ x: hitPoint.x, y: hitPoint.y, z: hitPoint.z });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    };

    element.addEventListener('pointerdown', onCapture, true);
    return () => {
      element.removeEventListener('pointerdown', onCapture, true);
    };
  }, [camera, gl, scene, controls, registry, propRegistry, selectedIdRef, gizmoControlRef, gizmoDraggingRef, annotateRef]);

  return null;
}

function DeviceModelView({
  instance,
  screenshot,
  liveStream,
  selected,
  onSelect,
  onGizmoTargets,
  gizmoDraggingRef,
  grabRegistry,
  deviceColor,
  clayMode,
  mediaPlaying,
  dropHighlight = false,
  anchorRegistry,
  overlays,
  overlayTime = 0,
  selectedOverlayId = null,
  onSelectOverlay,
  selectedMaterialName = null,
  preserveBrandMarks = false,
}: {
  instance: DeviceInstance;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  selected: boolean;
  onSelect?: (payload: DeviceSelectPayload) => void;
  onGizmoTargets?: (deviceId: string, targets: GizmoTargets | null) => void;
  gizmoDraggingRef: MutableRefObject<boolean>;
  grabRegistry: MutableRefObject<Map<string, THREE.Object3D>>;
  anchorRegistry: MutableRefObject<Map<string, THREE.Object3D>>;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
  overlays?: MockupProject['overlays'];
  overlayTime?: number;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string) => void;
  selectedMaterialName?: string | null;
  preserveBrandMarks?: boolean;
}) {
  const device = getDevice(instance.deviceId);
  const modelUrl = useDeviceModelUrl(device.id, device.url);
  const positionRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<THREE.Group>(null);
  const scaleRef = useRef<THREE.Group>(null);
  const [explosionHost, setExplosionHost] = useState<THREE.Group | null>(null);
  const pointer = useRef({ x: 0, y: 0, moved: false });
  const screenLayers = instance.screenLayers ?? [];
  const layerExplosion = instance.layerExplosion ?? 0;

  const radians = (d: number) => (d * Math.PI) / 180;

  useLayoutEffect(() => {
    const node = scaleRef.current;
    setExplosionHost((current) => (current === node ? current : node));
  });

  useLayoutEffect(() => {
    const positionGroup = positionRef.current;
    const rotationGroup = rotationRef.current;
    const scaleGroup = scaleRef.current;
    if (!positionGroup || !rotationGroup) return;
    // Scale lives on an inner pivot so TransformControls stay centered on the
    // unscaled position/rotation origins (Spline-style gimbal).
    if (scaleGroup) scaleGroup.scale.setScalar(instance.scale ?? 1);
    // Rotate pivot must stay at the translate origin — any residual local
    // offset separates the rings/arrows from the device body.
    rotationGroup.position.set(0, 0, 0);
    rotationGroup.scale.setScalar(1);
    // While the gizmo is dragging, TransformControls owns the pose — don't fight it.
    if (gizmoDraggingRef.current) return;
    const rot = instance.rotation ?? { x: 0, y: 0, z: 0 };
    const pos = instance.position ?? { x: 0, y: 0, z: 0 };
    positionGroup.position.set(pos.x, pos.y, pos.z);
    rotationGroup.rotation.set(radians(rot.x), radians(rot.y), radians(rot.z));
  }, [instance.rotation.x, instance.rotation.y, instance.rotation.z, instance.position?.x, instance.position?.y, instance.position?.z, instance.scale, gizmoDraggingRef]);

  useLayoutEffect(() => {
    const group = positionRef.current;
    const anchor = rotationRef.current;
    if (!group) return undefined;
    group.userData.deviceGrabId = instance.id;
    group.userData.rotationPivot = anchor ?? null;
    grabRegistry.current.set(instance.id, group);
    if (anchor) {
      anchor.userData.annotationAnchorId = instance.id;
      anchorRegistry.current.set(instance.id, anchor);
    }
    return () => {
      if (grabRegistry.current.get(instance.id) === group) grabRegistry.current.delete(instance.id);
      if (anchor && anchorRegistry.current.get(instance.id) === anchor) anchorRegistry.current.delete(instance.id);
      if (group.userData.rotationPivot === anchor) group.userData.rotationPivot = null;
    };
  }, [anchorRegistry, grabRegistry, instance.id]);

  useLayoutEffect(() => {
    if (!selected) return undefined;
    const position = positionRef.current;
    const rotation = rotationRef.current;
    if (position && rotation) onGizmoTargets?.(instance.id, { position, rotation });
    return () => onGizmoTargets?.(instance.id, null);
  }, [selected, onGizmoTargets, instance.id]);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    pointer.current = { x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const dx = event.clientX - pointer.current.x;
    const dy = event.clientY - pointer.current.y;
    if (dx * dx + dy * dy > 25) pointer.current.moved = true;
  };

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (pointer.current.moved) return;
    event.stopPropagation();
    onSelect?.({ id: instance.id, clientX: event.clientX, clientY: event.clientY });
  };

  return (
    <group
      ref={positionRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onClick={onClick}
    >
      <group ref={rotationRef}>
        <group ref={scaleRef}>
          <ReflectionDriveContext.Provider value={{
            style: instance.reflectionStyle ?? 'glossy',
            amount: instance.glassReflection ?? 0.55,
            clay: clayMode,
          }}>
          {device.kind === 'procedural' ? (
            <ProceduralDevice
              device={device}
              screenshot={screenshot}
              liveStream={liveStream}
              finishHex={(DEVICE_COLORS.find((c) => c.id === deviceColor) ?? DEVICE_COLORS[0]).hex}
              clayMode={clayMode}
              mediaPlaying={mediaPlaying}
              dropHighlight={dropHighlight}
              lidOpen={instance.lidOpen ?? 1}
            />
          ) : modelUrl.url ? (
            <GltfLoadBoundary url={modelUrl.url}>
              <GltfDeviceContent
                key={`${modelUrl.url}|${device.screenMat}|${device.rot.join(',')}|${device.uv.mirrorX ? 1 : 0}|${device.uv.flipY ? 1 : 0}|${device.uv.planar ? 1 : 0}|${device.uv.rot ?? 0}|${device.screenSize.width}x${device.screenSize.height}|${device.lid ? 'lid' : 'nolid'}|${device.lockMaterials ? 'lock' : 'tint'}|${device.hasScreen === false ? 'noscreen' : 'screen'}`}
                url={modelUrl.url}
                deviceId={device.id}
                screenshot={screenshot}
                liveStream={liveStream}
                glassReflection={instance.glassReflection ?? 0.55}
                reflectionStyle={instance.reflectionStyle ?? 'glossy'}
                deviceColor={deviceColor}
                clayMode={clayMode}
                mediaPlaying={mediaPlaying}
                lidOpen={instance.lidOpen ?? 1}
                dropHighlight={dropHighlight}
                materialTweaks={instance.materialTweaks}
                hiddenMeshes={instance.hiddenMeshes}
                preserveBrandMarks={preserveBrandMarks}
                selectedMaterialName={selectedMaterialName}
              />
            </GltfLoadBoundary>
          ) : null}
          </ReflectionDriveContext.Provider>
          <ScreenLayerExplosion
            host={explosionHost}
            layers={screenLayers}
            amount={layerExplosion}
          />
          <ModelAnnotationLayer
            deviceId={instance.id}
            overlays={overlays}
            time={overlayTime}
            selectedId={selectedOverlayId}
            onSelect={onSelectOverlay}
          />
        </group>
      </group>
    </group>
  );
}

const STUDIO_SKY_VERT = /* glsl */`
varying vec3 vViewDir;
void main() {
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = viewPos.xyz;
  gl_Position = projectionMatrix * viewPos;
  gl_Position.z = gl_Position.w;
}
`;

const STUDIO_SKY_FRAG = /* glsl */`
uniform vec3 uWall;
uniform vec3 uCove;
uniform vec3 uFloor;
varying vec3 vViewDir;

void main() {
  vec3 d = normalize(vViewDir);
  // Default 38° lens only spans about ±0.33 in view Y. Stretch that across the whole gradient
  // so the frame reads as one soft light pool, the way a Spline backdrop does.
  float y = clamp(d.y / 0.34, -1.0, 1.0);
  vec2 p = d.xy / max(0.28, -d.z);
  // Light pool sits just above the product, then the frame falls off toward the corners.
  vec2 q = p - vec2(0.0, 0.2);
  float glow = exp(-dot(q, q) * 2.8);
  float vig = smoothstep(1.05, 0.02, length(p - vec2(0.0, 0.08)));

  vec3 col = mix(uFloor, uCove, smoothstep(-1.0, 0.45, y));
  col = mix(col, uWall, smoothstep(-0.2, 0.75, y) * 0.7);
  vec3 lit = mix(uWall, vec3(1.0), 0.34);
  col = mix(col, lit, glow * 0.55);
  // Soft corner falloff — keep near-white sets white (0.92 turned #fff into grey).
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float dim = mix(0.97, 1.0, smoothstep(0.85, 0.98, luma));
  col = mix(col * dim, col, vig);

  // Stronger dither — flat charcoal sets otherwise band into steps.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * (1.6 / 255.0);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function StudioSky({
  colors,
  onSelect,
}: {
  colors: GradientColors;
  onSelect?: () => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWall: { value: new THREE.Color(colors.center) },
      uCove: { value: new THREE.Color(colors.mid) },
      uFloor: { value: new THREE.Color(colors.edge) },
    },
    vertexShader: STUDIO_SKY_VERT,
    fragmentShader: STUDIO_SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
  }), []);

  useEffect(() => {
    material.uniforms.uWall.value.set(colors.center);
    material.uniforms.uCove.value.set(colors.mid);
    material.uniforms.uFloor.value.set(colors.edge);
  }, [material, colors.center, colors.mid, colors.edge]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera: viewCamera }) => {
    mesh.current?.position.copy(viewCamera.position);
  });

  return (
    <mesh
      ref={mesh}
      layers={1}
      frustumCulled={false}
      renderOrder={-1}
      userData={{ isStudioSky: true }}
      onClick={(event) => {
        // Devices, props, and the cyclorama wall sit closer and win the ray first.
        // A clean tap on empty surround opens the background colour dock.
        // Do not stop pointerdown — empty-canvas drag still orbits.
        if (event.delta > 8) return;
        event.stopPropagation();
        onSelect?.();
      }}
    >
      <sphereGeometry args={[40, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** Let the layer-1 cyclorama and layer-2 orbit floor receive taps. */
function EnableBackdropPicking() {
  const raycaster = useThree((state) => state.raycaster);
  useEffect(() => {
    raycaster.layers.enable(1);
    raycaster.layers.enable(2);
  }, [raycaster]);
  return null;
}

function Background({
  preset,
  colors,
  onSelectSky,
}: {
  preset: BackgroundPreset;
  colors?: GradientColors | null;
  onSelectSky?: () => void;
}) {
  const { scene, gl } = useThree();
  useEffect(() => {
    scene.background = null;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    if (preset === 'transparent') {
      gl.setClearColor('#16191f', 0);
      return () => {
        gl.setClearColor('#16191f', 1);
      };
    }
    gl.setClearColor(colors?.edge ?? '#26282d', 1);
    return undefined;
  }, [scene, gl, preset, colors?.edge]);
  if (preset === 'transparent' || !colors) return null;
  return <StudioSky colors={colors} onSelect={onSelectSky} />;
}

function SceneEnvironment({
  reflectionMap,
  reflectionMapImage,
  background,
  colors,
  children,
}: {
  reflectionMap: MockupProject['reflectionMap'];
  reflectionMapImage: string | null;
  background: BackgroundPreset;
  colors?: GradientColors | null;
  children?: ReactNode;
}) {
  const { gl } = useThree();
  const colorKey = colors ? `${colors.center}-${colors.mid}-${colors.edge}` : '';
  const [envMap, setEnvMap] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    let rt: THREE.WebGLRenderTarget | null = null;

    const applyFromCanvas = (canvas: HTMLCanvasElement) => {
      if (cancelled) return;
      const source = new THREE.CanvasTexture(canvas);
      source.mapping = THREE.EquirectangularReflectionMapping;
      source.colorSpace = THREE.SRGBColorSpace;
      source.needsUpdate = true;
      rt = pmrem.fromEquirectangular(source);
      setEnvMap(rt.texture);
      source.dispose();
    };

    const run = async () => {
      const { createReflectionEquirect } = await import('../lib/reflectionMaps');
      if (cancelled) return;
      if (reflectionMap === 'custom' && reflectionMapImage) {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = reflectionMapImage;
        });
        if (cancelled) return;
        applyFromCanvas(createReflectionEquirect('custom', { customImage: img }));
        return;
      }
      const mapId = reflectionMap === 'custom' ? 'match_background' : reflectionMap;
      applyFromCanvas(createReflectionEquirect(mapId, {
        background,
        colors: background === 'transparent' ? null : colors,
      }));
    };

    void run().catch(() => {
      if (cancelled) return;
      void import('../lib/reflectionMaps').then(({ createReflectionEquirect }) => {
        applyFromCanvas(createReflectionEquirect('studio'));
      });
    });

    return () => {
      cancelled = true;
      setEnvMap(null);
      rt?.dispose();
      pmrem.dispose();
    };
  }, [gl, reflectionMap, reflectionMapImage, background, colorKey, colors]);

  return (
    <SceneEnvMapContext.Provider value={envMap}>
      {children}
    </SceneEnvMapContext.Provider>
  );
}

/** Follows the brand accent: purple and green stay cool, warm accents go warm. */
function RenderGradeSync() {
  const gl = useThree((state) => state.gl);
  const [theme, , color] = useAccentTheme();
  useEffect(() => {
    setRenderGradeGain(gl, renderOutputGain(accentPair(theme, color).accent));
  }, [gl, theme, color]);
  return null;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function viewOffset(view: CameraView, split: boolean): Vec3 {
  const dist = split ? EYE_SPLIT_CAMERA_DISTANCE : EYE_CAMERA_DISTANCE;
  const positions: Record<CameraView, Vec3> = {
    front: { x: 0, y: 0, z: dist },
    left: { x: -dist, y: 0, z: 0 },
    right: { x: dist, y: 0, z: 0 },
    top: { x: 0, y: dist, z: 0.001 },
  };
  return positions[view];
}

/** Key directional light with optional drag handle; aims at the scene focus. */
function KeyLightRig({
  position,
  color,
  intensity,
  castShadow,
  shadowSoftness,
  shadowOpacity,
  shadowDistance = 3.6,
  shadowQuality = 'auto',
  shadowExportBoost = false,
  gizmoActive,
  target,
  onPositionChange,
  onDraggingChange,
  onSelect,
}: {
  position: Vec3;
  color: string;
  intensity: number;
  castShadow: boolean;
  shadowSoftness: number;
  shadowOpacity: number;
  shadowDistance?: number;
  shadowQuality?: ShadowQuality;
  shadowExportBoost?: boolean;
  gizmoActive: boolean;
  target: Vec3;
  onPositionChange?: (position: Vec3) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onSelect?: () => void;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const { scene, gl } = useThree();
  const interaction = useStudioShadowInteraction();
  const mode = shadowExportBoost ? 'studio' : (interaction?.mode ?? 'studio');
  const boundsRef = useRef(new THREE.Box3());
  const lastFitKey = useRef('');
  const fitFrame = useRef(0);
  const pcssProfile: ProgressiveShadowProfile = mode === 'interactive' && !shadowExportBoost
    ? 'interactive'
    : 'studio';

  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.position.set(position.x, position.y, position.z);
    light.target.position.set(target.x, target.y, target.z);
    light.target.updateMatrixWorld();
    // Layer 1 = cyclorama paper. Key must reach it so PCSS darkens devices/shapes on the set.
    light.layers.enable(1);
  }, [position.x, position.y, position.z, target.x, target.y, target.z]);

  useEffect(() => {
    // Lighter PCSS while orbiting; full filter once every canvas idles into studio.
    // Ref-counted so split view does not thrash the shared ShaderChunk.
    const changed = retainProgressiveShadowProfile(pcssProfile);
    if (changed) refreshShadowMaterials(scene);
    return () => {
      if (releaseProgressiveShadowProfile(pcssProfile)) {
        refreshShadowMaterials(scene);
      }
    };
  }, [pcssProfile, scene]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.castShadow = castShadow;
    const maxTex = gl.capabilities.maxTextureSize || 4096;
    const size = resolveKeyShadowMapSize(shadowQuality, mode, shadowExportBoost, maxTex);
    const penumbra = softnessToPenumbra(shadowSoftness);
    light.shadow.mapSize.set(size, size);
    // The PCSS shader treats shadow radius as emitter size (texels), so Softness
    // produces a contact-hardening penumbra. Scale with map size so the
    // world-space penumbra stays the same at 2048 and 4096.
    light.shadow.radius = penumbra.emitterSize * (size / 2048);
    // Slightly stronger normal bias as the emitter grows — kills acne without peter-panning.
    const softnessT = THREE.MathUtils.smoothstep(0.2, 14, shadowSoftness);
    light.shadow.bias = -0.00018;
    light.shadow.normalBias = THREE.MathUtils.lerp(0.022, 0.05, softnessT);
    light.shadow.blurSamples = size >= 2048 ? 16 : 8;
    // 0 fades the cast out; 1 is the soft default core; above 1 crushes soft
    // penumbras that never fully occlude (shader clamps the darkened result).
    light.shadow.intensity = Math.max(0, shadowIntensityCurve(shadowOpacity, 1, 2.6));
    light.shadow.needsUpdate = true;
    // Dispose stale map when resolution changes so GPU memory stays bounded.
    if (light.shadow.map && (light.shadow.map.width !== size || light.shadow.map.height !== size)) {
      light.shadow.map.dispose();
      // three.js recreates the map on the next shadow pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (light.shadow as any).map = null;
    }
  }, [castShadow, shadowSoftness, shadowOpacity, shadowQuality, shadowExportBoost, mode, gl]);

  // Adaptive ortho frustum — tight around casters so 2048/4096 texels aren't wasted.
  // Also re-assert intensity each frame so a failed shadow bake can never leave the key at 0.
  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    if (Math.abs(light.intensity - intensity) > 1e-6) light.intensity = intensity;
    if (!castShadow) return;
    fitFrame.current += 1;
    // While interacting, refit often so rotation never loses the shadow.
    // When idle, refit every few frames to avoid thrashing projection matrices.
    const interval = mode === 'interactive' ? 1 : 4;
    if (fitFrame.current % interval !== 0) return;

    collectCasterBounds(scene, boundsRef.current);
    if (boundsRef.current.isEmpty()) return;
    const fitted = fitDirectionalShadowCamera(
      position,
      target,
      boundsRef.current,
      STUDIO_FLOOR_Y,
      {
        padding: 1.35 + Math.min(0.45, shadowDistance * 0.04),
        minExtent: 1.6,
        // Wide enough that cove / wall projections of a standing phone stay in-map.
        maxExtent: THREE.MathUtils.clamp(16 + shadowDistance * 0.85, 16, 24),
      },
    );
    if (!fitted) return;
    const key = [
      fitted.left.toFixed(2), fitted.right.toFixed(2),
      fitted.top.toFixed(2), fitted.bottom.toFixed(2),
      fitted.near.toFixed(2), fitted.far.toFixed(2),
    ].join('|');
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const cam = light.shadow.camera;
    cam.left = fitted.left;
    cam.right = fitted.right;
    cam.top = fitted.top;
    cam.bottom = fitted.bottom;
    cam.near = fitted.near;
    cam.far = fitted.far;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  });

  return (
    <>
      <directionalLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        castShadow={castShadow}
        position={[position.x, position.y, position.z]}
      />
      <LightTranslateGizmo
        position={position}
        color={color}
        active={gizmoActive}
        size={0.16}
        onSelect={onSelect}
        onDraggingChange={onDraggingChange}
        onLiveChange={(next) => {
          if (!lightRef.current) return;
          lightRef.current.position.set(next.x, next.y, next.z);
          lightRef.current.target.position.set(target.x, target.y, target.z);
          lightRef.current.target.updateMatrixWorld();
        }}
        onPositionChange={onPositionChange}
      />
    </>
  );
}

/** OrbitControls keeps pending rotate/pan deltas on these fields. */
type OrbitControlsLike = {
  enableDamping?: boolean;
  target: THREE.Vector3;
  update: () => void;
  _sphericalDelta?: { set: (radius: number, phi: number, theta: number) => void };
  _panOffset?: THREE.Vector3;
  _scale?: number;
};

/** Drop leftover inertia when the controls expose it (three.js native OrbitControls). */
function clearOrbitInertia(controls: OrbitControlsLike | null | undefined) {
  if (!controls) return;
  controls._sphericalDelta?.set(0, 0, 0);
  controls._panOffset?.set(0, 0, 0);
  if (typeof controls._scale === 'number') controls._scale = 1;
}

/**
 * Put the camera back where a gesture started.
 * drei/three-stdlib keeps rotate deltas in a closure, so one damping-off update()
 * applies+clears them (leaving a wrong pose). Re-stamp the start pose after that
 * so empty-canvas taps do not jump.
 */
function restoreCameraPose(
  camera: THREE.Camera,
  controls: OrbitControlsLike | null | undefined,
  position: THREE.Vector3,
  target: THREE.Vector3,
) {
  if (!controls) {
    camera.position.copy(position);
    return;
  }
  clearOrbitInertia(controls);
  const wasDamping = controls.enableDamping;
  controls.enableDamping = false;
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
  // Deltas are zero now — write the intended pose again so it sticks.
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
  controls.enableDamping = wasDamping ?? true;
}

/** Instant pose write — damping off so format/device re-centers never ease. */
function snapCameraPose(
  camera: THREE.Camera,
  controls: OrbitControlsLike | null | undefined,
  position: Vec3,
  focus: Vec3,
) {
  const wasDamping = controls?.enableDamping;
  if (controls) {
    clearOrbitInertia(controls);
    controls.enableDamping = false;
  }
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(focus.x, focus.y, focus.z);
  if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();
  if (controls) {
    controls.target.set(focus.x, focus.y, focus.z);
    controls.update();
    controls.enableDamping = wasDamping ?? true;
  }
}

function CameraRig({
  view,
  lens,
  split,
  animatedPosition,
  sharedOrbit = null,
  onSharedOrbitChange,
  onCameraCommit,
  onOrbitStart,
  focusPoint = null,
  recenterToken = 0,
  onSpacePanDrag,
  viewGesture = 'rotate',
  onSwipe,
  onLongPress,
  annotate = null,
  freezeFraming = false,
}: {
  view: CameraView;
  lens: CameraLens;
  split: boolean;
  animatedPosition?: Vec3 | null;
  sharedOrbit?: { offset: Vec3; lookOffset?: Vec3 } | null;
  onSharedOrbitChange?: (orbit: { offset: Vec3; lookOffset?: Vec3 }) => void;
  onCameraCommit?: (
    position: Vec3,
    orbit: { offset: Vec3; lookOffset?: Vec3 },
  ) => void;
  onOrbitStart?: () => void;
  focusPoint?: Vec3 | null;
  recenterToken?: number;
  onSpacePanDrag?: () => void;
  viewGesture?: ViewGesture;
  onSwipe?: (direction: 'left' | 'right') => void;
  onLongPress?: (point: { clientX: number; clientY: number }) => void;
  annotate?: 'pen' | 'comment' | null;
  /** While true, ignore focus-point chase so translating a device does not drag the camera. */
  freezeFraming?: boolean;
}) {
  const { camera, gl } = useThree();
  const shadowInteraction = useStudioShadowInteraction();
  const shadowBusyRef = useRef(shadowInteraction);
  shadowBusyRef.current = shadowInteraction;
  const controls = useRef<any>(null);
  const [spacePan, setSpacePan] = useState(false);
  const freezeFramingRef = useRef(freezeFraming);
  freezeFramingRef.current = freezeFraming;
  const fov = cameraLensFov(lens);
  const applyingSharedRef = useRef(false);
  const onSharedOrbitChangeRef = useRef(onSharedOrbitChange);
  onSharedOrbitChangeRef.current = onSharedOrbitChange;
  const onCameraCommitRef = useRef(onCameraCommit);
  onCameraCommitRef.current = onCameraCommit;
  const onOrbitStartRef = useRef(onOrbitStart);
  onOrbitStartRef.current = onOrbitStart;
  const onSpacePanDragRef = useRef(onSpacePanDrag);
  onSpacePanDragRef.current = onSpacePanDrag;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const passiveGesture = (viewGesture === 'longpress' || viewGesture === 'swipe') && !spacePan;
  const dragPan = viewGesture === 'pan' || spacePan;
  const dragZoom = viewGesture === 'zoom' && !spacePan;
  const dragPanRef = useRef(dragPan);
  dragPanRef.current = dragPan;
  const dragZoomRef = useRef(dragZoom);
  dragZoomRef.current = dragZoom;
  const viewGestureRef = useRef(viewGesture);
  viewGestureRef.current = viewGesture;
  const gesturePanRef = useRef(false);
  /** True while a wheel / middle-button / zoom-gesture dolly is active. */
  const gestureZoomRef = useRef(false);
  /** Last orbit pointer button — right-drag is always pan (Rotato-style). */
  const orbitPointerButtonRef = useRef(0);
  const userOrbitingRef = useRef(false);
  const settlingRef = useRef(false);
  const orbitStartPos = useRef(new THREE.Vector3());
  const orbitStartTarget = useRef(new THREE.Vector3());
  /** True only after the pointer moves past tap-slop — ignores click/tap jitter. */
  const orbitDragCommittedRef = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const sharedLookOffsetRef = useRef<Vec3 | null>(null);
  sharedLookOffsetRef.current = sharedOrbit?.lookOffset ?? null;
  const focus = focusPoint ?? { x: 0, y: 0, z: 0 };
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    // Layer 1 is the backdrop. ContactShadows only renders layer 0, so the
    // sky sphere cannot fill the shadow map and leave a square under the device.
    camera.layers.enable(1);
  }, [camera]);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, fov]);

  // Instant re-center on format / device / view changes (recenterToken or cleared shared orbit).
  useLayoutEffect(() => {
    if (userOrbitingRef.current || spacePan || freezeFraming) return;
    if (sharedOrbit?.lookOffset) return;
    if (animatedPosition) {
      snapCameraPose(camera, controls.current, animatedPosition, focus);
      return;
    }
    if (sharedOrbit) return;
    const offset = viewOffset(view, split);
    applyingSharedRef.current = true;
    snapCameraPose(
      camera,
      controls.current,
      { x: focus.x + offset.x, y: focus.y + offset.y, z: focus.z + offset.z },
      focus,
    );
    requestAnimationFrame(() => { applyingSharedRef.current = false; });
  }, [
    view, camera, split, recenterToken, spacePan, freezeFraming,
    animatedPosition?.x, animatedPosition?.y, animatedPosition?.z,
    sharedOrbit, focus.x, focus.y, focus.z,
  ]);

  // Apply linked dual-pane orbit (same angle, each pane's own device focus) — also instant.
  useLayoutEffect(() => {
    if (userOrbitingRef.current || spacePan || freezeFraming) return;
    if (!sharedOrbit) return;
    if (animatedPosition && !sharedOrbit.lookOffset) return;
    const { offset, lookOffset } = sharedOrbit;
    const nextPos = {
      x: focus.x + offset.x,
      y: focus.y + offset.y,
      z: focus.z + offset.z,
    };
    const look = lookOffset
      ? { x: focus.x + lookOffset.x, y: focus.y + lookOffset.y, z: focus.z + lookOffset.z }
      : focus;
    const dx = camera.position.x - nextPos.x;
    const dy = camera.position.y - nextPos.y;
    const dz = camera.position.z - nextPos.z;
    const target = controls.current?.target;
    const targetMatches = !target || (
      Math.abs(target.x - look.x) < 1e-6
      && Math.abs(target.y - look.y) < 1e-6
      && Math.abs(target.z - look.z) < 1e-6
    );
    if ((dx * dx + dy * dy + dz * dz) < 1e-8 && targetMatches) return;
    applyingSharedRef.current = true;
    snapCameraPose(camera, controls.current, nextPos, look);
    requestAnimationFrame(() => { applyingSharedRef.current = false; });
  }, [
    sharedOrbit?.offset.x, sharedOrbit?.offset.y, sharedOrbit?.offset.z,
    sharedOrbit?.lookOffset?.x, sharedOrbit?.lookOffset?.y, sharedOrbit?.lookOffset?.z,
    focus.x, focus.y, focus.z, camera, animatedPosition, spacePan, freezeFraming,
  ]);
  useEffect(() => {
    if (freezeFraming) {
      setSpacePan(false);
      const orbit = controls.current;
      if (orbit) {
        orbit.enabled = false;
        orbit.enablePan = false;
        orbit.enableRotate = false;
        orbit.enableZoom = false;
      }
      return undefined;
    }
    const applyMouseMode = (pan: boolean) => {
      const orbit = controls.current;
      if (!orbit) return;
      const gesture = viewGestureRef.current;
      const zooming = gesture === 'zoom' && !pan;
      const passive = (gesture === 'longpress' || gesture === 'swipe') && !pan;
      const panning = gesture === 'pan' || pan;
      orbit.enabled = !passive;
      // Keep pan on so right-drag always works (Rotato-style); Space only remaps LEFT.
      orbit.enablePan = !passive;
      orbit.enableRotate = !panning && !zooming && !passive;
      orbit.mouseButtons.LEFT = panning
        ? THREE.MOUSE.PAN
        : zooming
          ? THREE.MOUSE.DOLLY
          : THREE.MOUSE.ROTATE;
      orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      orbit.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      applyMouseMode(true);
      setSpacePan(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (!isTypingTarget(event.target)) event.preventDefault();
      applyMouseMode(false);
      setSpacePan(false);
    };
    const onBlur = () => {
      applyMouseMode(false);
      setSpacePan(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [freezeFraming]);

  useEffect(() => {
    const el = gl.domElement;
    const idleCursor = annotate === 'pen'
      ? 'crosshair'
      : annotate === 'comment'
        ? 'copy'
        : spacePan || viewGesture === 'pan'
          ? 'grab'
          : viewGesture === 'zoom'
            ? 'zoom-in'
            : viewGesture === 'swipe'
              ? 'ew-resize'
              : '';
    el.style.cursor = idleCursor;
    const onPointerDown = () => {
      if (!spacePan && viewGesture !== 'pan') return;
      el.style.cursor = 'grabbing';
      if (spacePan) onSpacePanDragRef.current?.();
    };
    const onPointerUp = () => { el.style.cursor = idleCursor; };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl, spacePan, viewGesture, annotate]);

  useEffect(() => {
    if (viewGesture !== 'longpress' && viewGesture !== 'swipe') return undefined;
    const el = gl.domElement;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      tracking = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
      if (viewGesture === 'longpress') {
        timer = window.setTimeout(() => {
          tracking = false;
          onLongPressRef.current?.({ clientX: startX, clientY: startY });
        }, 480);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10 && timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (viewGesture === 'swipe' && tracking && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        onSwipeRef.current?.(dx > 0 ? 'right' : 'left');
      }
      clear();
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', clear);
    return () => {
      clear();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', clear);
    };
  }, [gl, viewGesture]);

  // Ignore click/tap jitter on empty canvas — only real drags may orbit the view.
  useEffect(() => {
    const el = gl.domElement;
    let tracking = false;
    let startX = 0;
    let startY = 0;
    let pointerType = 'mouse';
    const tapSlop = () => (pointerType === 'touch' || pointerType === 'pen' ? 14 : 6);

    const restoreTapPose = () => {
      restoreCameraPose(camera, controls.current, orbitStartPos.current, orbitStartTarget.current);
    };

    const commitOrbitDrag = () => {
      if (orbitDragCommittedRef.current) return;
      orbitDragCommittedRef.current = true;
      // Rotate pivots around the device when the view is centered. If the user
      // already panned (common when zoomed into a detail), keep that look-at so
      // orbiting doesn't yank the framing back to the device center.
      const zooming = gestureZoomRef.current || dragZoomRef.current;
      const panning = dragPanRef.current || gesturePanRef.current;
      if (!panning && !zooming && controls.current && userOrbitingRef.current) {
        const look = sharedLookOffsetRef.current;
        const hasLook = Boolean(
          look
          && (Math.abs(look.x) + Math.abs(look.y) + Math.abs(look.z)) > 1e-4,
        );
        if (!hasLook) {
          const f = focusRef.current;
          controls.current.target.set(f.x, f.y, f.z);
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      orbitPointerButtonRef.current = event.button;
      // Right-drag is always pan; Space / pan-mode remap LEFT. Clear on plain
      // left-drag so a leftover pan flag can't swallow the next orbit.
      if (event.button === 2 || (event.button === 0 && dragPanRef.current)) {
        gesturePanRef.current = true;
      } else if (event.button === 0) {
        gesturePanRef.current = false;
      }
      orbitStartPos.current.copy(camera.position);
      if (controls.current) orbitStartTarget.current.copy(controls.current.target);
      // Wheel / middle / right are intentional camera moves — never treat as taps.
      if (event.pointerType === 'mouse' && event.button !== 0) {
        orbitDragCommittedRef.current = true;
        return;
      }
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
      pointerType = event.pointerType;
      orbitDragCommittedRef.current = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!tracking || orbitDragCommittedRef.current) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < tapSlop()) {
        // Run after OrbitControls' document listener so its rotate delta is cleared.
        requestAnimationFrame(() => {
          if (!tracking || orbitDragCommittedRef.current) return;
          restoreTapPose();
        });
        return;
      }
      commitOrbitDrag();
    };
    const onPointerUp = () => {
      if (!tracking) return;
      tracking = false;
      if (orbitDragCommittedRef.current) return;
      // Tap with no real drag — put the camera back and drop any damping spin.
      restoreTapPose();
      requestAnimationFrame(() => {
        if (orbitDragCommittedRef.current) return;
        restoreTapPose();
      });
    };
    const onWheel = () => {
      orbitDragCommittedRef.current = true;
      // Mark before OrbitControls dolly so onStart/onChange never recenter the target.
      gestureZoomRef.current = true;
    };
    const onPointerDownZoom = (event: PointerEvent) => {
      // Middle mouse is always dolly; left is dolly only in zoom gesture mode.
      if (event.button === 1 || (event.button === 0 && dragZoomRef.current)) {
        gestureZoomRef.current = true;
      }
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerdown', onPointerDownZoom);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    // Capture phase so we flag zoom before OrbitControls handles the wheel.
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerdown', onPointerDownZoom);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel, true);
    };
  }, [gl, camera]);

  const publishOrbit = () => {
    if (!onSharedOrbitChangeRef.current || applyingSharedRef.current) return;
    if (animatedPosition && !userOrbitingRef.current) return;
    // OrbitControls reports its starting pose on load. That is not a user
    // rotate — saving it is what put the default angle back after a reload.
    const userGesture = userOrbitingRef.current || settlingRef.current
      || gestureZoomRef.current || dragZoomRef.current;
    if (!userGesture) return;
    // Don't write orbit state for an uncommitted tap — that is what made the
    // background "jump" when clicking empty canvas.
    if (userOrbitingRef.current && !orbitDragCommittedRef.current && !gestureZoomRef.current && !dragZoomRef.current) return;
    if (freezeFramingRef.current) return;
    const f = focusRef.current;
    const panning = userOrbitingRef.current ? gesturePanRef.current : dragPanRef.current;
    // Screen-space pan moves the look-at. Resetting it here pins the device
    // to the center and makes Space-drag look like it did nothing.
    if (panning) return;
    // Zoom must keep the current look-at. Forcing target back to the device
    // mid-dolly redirects the camera and feels like a jump to a random place.
    const zooming = gestureZoomRef.current || dragZoomRef.current;
    if (zooming) {
      const target = controls.current?.target;
      const look = target
        ? {
          x: Number((target.x - f.x).toFixed(4)),
          y: Number((target.y - f.y).toFixed(4)),
          z: Number((target.z - f.z).toFixed(4)),
        }
        : sharedLookOffsetRef.current;
      const hasLook = look
        && (Math.abs(look.x) + Math.abs(look.y) + Math.abs(look.z)) > 1e-4;
      onSharedOrbitChangeRef.current({
        offset: {
          x: Number((camera.position.x - f.x).toFixed(4)),
          y: Number((camera.position.y - f.y).toFixed(4)),
          z: Number((camera.position.z - f.z).toFixed(4)),
        },
        ...(hasLook && look ? { lookOffset: look } : {}),
      });
      return;
    }
    // Rotate usually aims at the device. If the user panned first (zoomed-in
    // detail), keep that look-at so the framing survives the orbit.
    const target = controls.current?.target;
    const look = target
      ? {
        x: Number((target.x - f.x).toFixed(4)),
        y: Number((target.y - f.y).toFixed(4)),
        z: Number((target.z - f.z).toFixed(4)),
      }
      : sharedLookOffsetRef.current;
    const hasLook = Boolean(
      look
      && (Math.abs(look.x) + Math.abs(look.y) + Math.abs(look.z)) > 1e-4,
    );
    onSharedOrbitChangeRef.current({
      offset: {
        x: Number((camera.position.x - f.x).toFixed(4)),
        y: Number((camera.position.y - f.y).toFixed(4)),
        z: Number((camera.position.z - f.z).toFixed(4)),
      },
      ...(hasLook && look ? { lookOffset: look } : {}),
    });
  };

  const readLiveOrbit = () => {
    const f = focusRef.current;
    const target = controls.current?.target;
    const offset = {
      x: Number((camera.position.x - f.x).toFixed(4)),
      y: Number((camera.position.y - f.y).toFixed(4)),
      z: Number((camera.position.z - f.z).toFixed(4)),
    };
    const look = target
      ? {
        x: Number((target.x - f.x).toFixed(4)),
        y: Number((target.y - f.y).toFixed(4)),
        z: Number((target.z - f.z).toFixed(4)),
      }
      : sharedLookOffsetRef.current;
    const hasLook = Boolean(
      look
      && (Math.abs(look.x) + Math.abs(look.y) + Math.abs(look.z)) > 1e-4,
    );
    return {
      offset,
      ...(hasLook && look ? { lookOffset: look } : {}),
    };
  };

  const finishOrbit = () => {
    settleTimer.current = null;
    if (!userOrbitingRef.current) return;
    const committed = orbitDragCommittedRef.current;
    if (!committed) {
      restoreCameraPose(camera, controls.current, orbitStartPos.current, orbitStartTarget.current);
      userOrbitingRef.current = false;
      settlingRef.current = false;
      gesturePanRef.current = false;
      shadowBusyRef.current?.setBusy(false);
      return;
    }
    const moved = camera.position.distanceToSquared(orbitStartPos.current) > 1e-6;
    // Always read the live camera. publishOrbit is gated for mid-drag UI sync and
    // can no-op on pan/apply races — that is what dropped mouse-orbit saves while
    // typed Rotate X/Y/Z (direct setProject) kept working.
    const orbit = readLiveOrbit();
    onSharedOrbitChangeRef.current?.(orbit);
    userOrbitingRef.current = false;
    settlingRef.current = false;
    gesturePanRef.current = false;
    shadowBusyRef.current?.setBusy(false);
    if (!moved) return;
    onCameraCommitRef.current?.(
      {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      orbit,
    );
  };

  const armSettle = () => {
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(finishOrbit, 90);
  };

  useEffect(() => () => {
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
  }, []);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!passiveGesture && !freezeFraming}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={0.72}
      zoomSpeed={0.9}
      panSpeed={0.85}
      enablePan={!passiveGesture && !freezeFraming}
      enableRotate={!dragPan && !dragZoom && !passiveGesture && !freezeFraming}
      enableZoom={!freezeFraming}
      screenSpacePanning
      mouseButtons={{
        LEFT: dragPan ? THREE.MOUSE.PAN : dragZoom ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      minDistance={split ? 1.8 : 1.2}
      maxDistance={48}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI - 0.12}
      onStart={() => {
        // Gizmo arrows can still race a frame ahead of freezeFraming — bail out.
        if (freezeFramingRef.current) {
          if (controls.current) controls.current.enabled = false;
          return;
        }
        userOrbitingRef.current = true;
        // Keep right-drag pan (button 2) even when LEFT is still rotate mode.
        // Without this, zoomed-in right-pan lost lookOffset and snapped back.
        gesturePanRef.current = dragPanRef.current || orbitPointerButtonRef.current === 2 || gesturePanRef.current;
        if (dragZoomRef.current) gestureZoomRef.current = true;
        settlingRef.current = false;
        shadowBusyRef.current?.setBusy(true);
        if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
        // Do not snap the look-at here. Empty-canvas taps fire onStart before
        // tap-slop commits; recentering the target made the camera jump.
        // Real rotate drags snap the target once movement passes tap-slop.
        onOrbitStartRef.current?.();
      }}
      onChange={() => {
        if (freezeFramingRef.current) return;
        publishOrbit();
        if (settlingRef.current) armSettle();
      }}
      onEnd={() => {
        if (!userOrbitingRef.current) return;
        settlingRef.current = true;
        armSettle();
        // Clear after settle arms — publishOrbit may still run on damping frames.
        // Keep gesturePanRef until finishOrbit reads it (damping can outlast 120ms).
        window.setTimeout(() => {
          gestureZoomRef.current = false;
        }, 120);
      }}
    />
  );
}

/** Hide editor-only helpers (gizmo rings/arrows) so they don't appear in exports. */
function hideEditorHelpers(scene: THREE.Scene) {
  const restored: { object: THREE.Object3D; visible: boolean }[] = [];
  scene.traverse((object) => {
    const marker = object as THREE.Object3D & {
      isTransformControls?: boolean;
      isTransformControlsGizmo?: boolean;
      isTransformControlsPlane?: boolean;
    };
    const isHelper = Boolean(
      marker.isTransformControls
      || marker.isTransformControlsGizmo
      || marker.isTransformControlsPlane
      || object.type === 'TransformControlsPlane'
      || object.name?.includes('TransformControls')
      || object.userData?.exportHide
    );
    if (!isHelper || !object.visible) return;
    restored.push({ object, visible: true });
    object.visible = false;
  });
  return () => {
    for (const entry of restored) entry.object.visible = entry.visible;
  };
}

/** Render targets store linear light. Card images are shown as sRGB. */
function linearByteToSrgb(value: number): number {
  const c = value / 255;
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

/** Flat buffers are failed readbacks (or an empty clear), not a finished product shot. */
function pixelBufferStats(pixels: Uint8Array): { ok: boolean; mean: number; stdev: number } {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const step = 16;
  for (let i = 0; i + 2 < pixels.length; i += step) {
    const y = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += y;
    sum2 += y * y;
    n += 1;
  }
  if (!n) return { ok: false, mean: 0, stdev: 0 };
  const mean = sum / n;
  const stdev = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { ok: stdev > 6 && mean > 4, mean, stdev };
}

function CaptureBridge({
  captureRef,
  edgeBlurTop,
  edgeBlurBottom,
  edgeBlurAmount,
}: {
  captureRef: MutableRefObject<CaptureApi | null>;
  edgeBlurTop: boolean;
  edgeBlurBottom: boolean;
  edgeBlurAmount: number;
}) {
  const { gl, scene, camera } = useThree();
  const shadowInteraction = useStudioShadowInteraction();
  const shadowApiRef = useRef(shadowInteraction);
  shadowApiRef.current = shadowInteraction;
  const edgeBlurActive = (edgeBlurTop || edgeBlurBottom) && edgeBlurAmount > 0;
  useEffect(() => {
    const blitWithBlur = (width: number, height: number) => {
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const c2d = out.getContext('2d', { alpha: true });
      if (!c2d) throw new Error('Could not create export canvas');
      c2d.drawImage(gl.domElement, 0, 0, width, height);
      if (edgeBlurActive) {
        applyProgressiveEdgeBlur(c2d, width, height, edgeBlurAmount, {
          top: edgeBlurTop,
          bottom: edgeBlurBottom,
        });
      }
      return out;
    };

    /** Resolve soft floor shadows before the capture readback. */
    const settleShadows = () => {
      const api = shadowApiRef.current?.apiRef.current;
      if (!api) return;
      // Update world matrices so adaptive shadow cameras see the posed frame.
      scene.updateMatrixWorld(true);
      api.settle();
    };

    const withSizedRender = <T,>(width: number, height: number, use: () => T): T => {
      if (!(camera instanceof THREE.PerspectiveCamera)) throw new Error('Unsupported camera');
      if (width > gl.capabilities.maxTextureSize || height > gl.capabilities.maxTextureSize) {
        throw new Error('Export size exceeds this computer’s GPU limit');
      }
      const originalSize = gl.getSize(new THREE.Vector2());
      const originalDpr = gl.getPixelRatio();
      const originalAspect = camera.aspect;
      const restoreHelpers = hideEditorHelpers(scene);
      try {
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        scene.updateMatrixWorld(true);
        settleShadows();
        gl.render(scene, camera);
        return use();
      } finally {
        restoreHelpers();
        gl.setPixelRatio(originalDpr);
        gl.setSize(originalSize.x, originalSize.y, false);
        camera.aspect = originalAspect;
        camera.updateProjectionMatrix();
        gl.render(scene, camera);
      }
    };

    const snapshotUrl = (width: number, height: number) => {
      const previous = gl.getRenderTarget();
      const previousOutput = gl.outputColorSpace;
      const previousClear = gl.getClearColor(new THREE.Color());
      const previousAlpha = gl.getClearAlpha();
      // An sRGB render target makes readPixels return an empty buffer in Electron.
      // Read a linear target, then encode that buffer ourselves.
      const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
      });
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      target.texture.type = THREE.UnsignedByteType;
      try {
        gl.outputColorSpace = THREE.LinearSRGBColorSpace;
        gl.setRenderTarget(target);
        // Match the live canvas clear so transparent / dark card thumbs stay clear.
        const clearHex = `#${previousClear.getHexString()}`;
        gl.setClearColor(clearHex, previousAlpha);
        gl.clear(true, true, true);
        gl.render(scene, camera);
        gl.render(scene, camera);
        const pixels = new Uint8Array(width * height * 4);
        gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        const subject = pixelBufferStats(pixels);
        const glError = gl.getContext().getError();
        if (!subject.ok) {
          console.error(
            '[thumb] empty render target',
            `mean=${subject.mean.toFixed(1)}`,
            `stdev=${subject.stdev.toFixed(1)}`,
            `gl=${glError}`,
            `buffer=${gl.domElement.width}x${gl.domElement.height}`,
          );
          throw new Error('Thumbnail render target was empty');
        }
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create export canvas');
        const image = ctx.createImageData(width, height);
        const row = width * 4;
        for (let y = 0; y < height; y += 1) {
          const src = (height - 1 - y) * row;
          const dst = y * row;
          for (let x = 0; x < row; x += 4) {
            image.data[dst + x] = linearByteToSrgb(pixels[src + x]);
            image.data[dst + x + 1] = linearByteToSrgb(pixels[src + x + 1]);
            image.data[dst + x + 2] = linearByteToSrgb(pixels[src + x + 2]);
            image.data[dst + x + 3] = pixels[src + x + 3];
          }
        }
        ctx.putImageData(image, 0, 0);
        const webp = out.toDataURL('image/webp', 0.82);
        return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
      } finally {
        gl.outputColorSpace = previousOutput;
        gl.setClearColor(previousClear, previousAlpha);
        gl.setRenderTarget(previous);
        target.dispose();
      }
    };

    const presentedImage = async () => {
      // preserveDrawingBuffer is off for live preview — force a render and read
      // synchronously before the browser clears the drawing buffer.
      scene.updateMatrixWorld(true);
      gl.render(scene, camera);
      const src = gl.domElement;
      if (src.width < 2 || src.height < 2) throw new Error('Thumbnail canvas has no pixels');
      const out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      const c2d = out.getContext('2d', { willReadFrequently: true });
      if (!c2d) throw new Error('Could not create export canvas');
      c2d.drawImage(src, 0, 0);
      const probe = c2d.getImageData(0, 0, Math.min(48, out.width), Math.min(28, out.height)).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < probe.length; i += 4) {
        sum += (probe[i] + probe[i + 1] + probe[i + 2]) / 3;
        n += 1;
      }
      const mean = n ? sum / n : 0;
      if (mean < 24) throw new Error('Presented thumbnail was blank');
      const url = out.toDataURL('image/webp', 0.82);
      return url.startsWith('data:image/webp') ? url : out.toDataURL('image/png');
    };

    captureRef.current = {
      toPresentedImage: presentedImage,
      toSnapshot: async (width, height) => withSizedRender(width, height, () => snapshotUrl(width, height)),
      toPng: async (width, height) => withSizedRender(width, height, () => {
        if (!edgeBlurActive) {
          return gl.domElement.toDataURL('image/png');
        }
        return blitWithBlur(width, height).toDataURL('image/png');
      }),
      toImage: async (width, height, mime = 'image/png', quality = 0.92) => withSizedRender(
        width,
        height,
        () => {
          const needsBlit = mime === 'image/webp' || edgeBlurActive;
          if (!needsBlit) {
            return gl.domElement.toDataURL('image/png');
          }
          // WebGL canvases often can't encode WebP directly — blit to a 2D canvas first.
          const out = blitWithBlur(width, height);
          if (mime !== 'image/webp') {
            return out.toDataURL('image/png');
          }
          const url = out.toDataURL('image/webp', quality);
          if (!url.startsWith('data:image/webp')) {
            throw new Error('WebP export is not supported in this browser. Try PNG instead.');
          }
          return url;
        },
      ),
      drawFrame: (width, height, dest) => {
        withSizedRender(width, height, () => {
          dest.clearRect(0, 0, width, height);
          dest.drawImage(gl.domElement, 0, 0, width, height);
          if (edgeBlurActive) {
            applyProgressiveEdgeBlur(dest, width, height, edgeBlurAmount, {
              top: edgeBlurTop,
              bottom: edgeBlurBottom,
            });
          }
        });
      },
    };
    return () => { captureRef.current = null; };
  }, [captureRef, camera, gl, scene, edgeBlurActive, edgeBlurTop, edgeBlurBottom, edgeBlurAmount]);
  return null;
}

function SceneReady({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return null;
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.6, 1.2, 0.08]} />
      <meshStandardMaterial color="#2a2e34" wireframe />
    </mesh>
  );
}

function SceneDevices({
  project,
  gizmoMode,
  mediaPlaying,
  liveStream,
  liveStreamDeviceId,
  gizmoActive = true,
  onSelectDevice,
  onHoverDevice,
  onDragTargetDevice,
  onDeviceContextMenu,
  onRotateDevice,
  onMoveDevice,
  onSelectProp,
  onMoveProp,
  onRotateProp,
  onSelectEmpty,
  selectedPropId = null,
  propGizmoTargets = null,
  propGrabRegistry,
  gizmoDraggingRef: sharedGizmoDraggingRef,
  onGizmoDraggingChange,
  screenDropDeviceId = null,
  annotate = null,
  annotateInk,
  onAnnotation,
  overlayTime = 0,
  selectedOverlayId = null,
  onSelectOverlay,
  materialEditEnabled = false,
  selectedMaterialName = null,
  selectedMaterialDeviceId = null,
  onPickMaterial,
}: {
  project: MockupProject;
  gizmoMode: GizmoMode;
  mediaPlaying?: boolean;
  liveStream?: MediaStream | null;
  liveStreamDeviceId?: string | null;
  gizmoActive?: boolean;
  onSelectDevice?: (payload: DeviceSelectPayload) => void;
  onHoverDevice?: (id: string | null) => void;
  onDragTargetDevice?: (id: string | null) => void;
  onDeviceContextMenu?: (payload: DeviceSelectPayload) => void;
  onRotateDevice?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveDevice?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onSelectProp?: (id: string) => void;
  onMoveProp?: (id: string, position: Vec3) => void;
  onRotateProp?: (id: string, rotation: Vec3) => void;
  onSelectEmpty?: (target: 'sky' | 'floor' | 'backdrop') => void;
  selectedPropId?: string | null;
  propGizmoTargets?: GizmoTargets | null;
  propGrabRegistry: MutableRefObject<Map<string, THREE.Object3D>>;
  gizmoDraggingRef?: MutableRefObject<boolean>;
  onGizmoDraggingChange?: (dragging: boolean) => void;
  screenDropDeviceId?: string | null;
  annotate?: 'pen' | 'comment' | null;
  annotateInk?: string;
  onAnnotation?: (mark: AnnotationMark) => void;
  overlayTime?: number;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string) => void;
  materialEditEnabled?: boolean;
  selectedMaterialName?: string | null;
  selectedMaterialDeviceId?: string | null;
  onPickMaterial?: (payload: MaterialPickPayload) => void;
}) {
  const [deviceGizmoTargets, setDeviceGizmoTargets] = useState<GizmoTargets | null>(null);
  const localGizmoDraggingRef = useRef(false);
  const gizmoDraggingRef = sharedGizmoDraggingRef ?? localGizmoDraggingRef;
  const grabRegistry = useRef(new Map<string, THREE.Object3D>());
  const anchorRegistry = useRef(new Map<string, THREE.Object3D>());
  const annotateRef = useRef(false);
  annotateRef.current = annotate != null;
  const gizmoControlRef = useRef<GizmoControl | null>(null);
  const propSelected = Boolean(selectedPropId);
  const selectedId = project.selectedDeviceId;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const gizmoTargets = propSelected ? propGizmoTargets : deviceGizmoTargets;
  const gizmoSubjectId = propSelected ? selectedPropId : selectedId;

  // Stable callback — only the selected device may publish/clear the gizmo targets.
  // (Inline per-device callbacks were clearing the gizmo when sibling devices updated.)
  const bindGizmoTargets = useCallback((deviceId: string, targets: GizmoTargets | null) => {
    if (propSelected) return;
    if (deviceId !== selectedIdRef.current) return;
    setDeviceGizmoTargets(targets);
  }, [propSelected]);

  return (
    <>
      {project.devices.map((instance) => {
        const screenshot = instance.screenshot !== undefined ? instance.screenshot : project.screenshot;
        const deviceColor = instance.deviceColor ?? project.deviceColor;
        const clayMode = instance.clayMode ?? project.clayMode ?? deviceColor === 'clay';
        const streamForDevice = liveStream && (
          liveStreamDeviceId
            ? instance.id === liveStreamDeviceId
            : instance.id === selectedId
        )
          ? liveStream
          : null;
        return (
          <DeviceModelView
            key={`${instance.id}-${instance.deviceId}`}
            instance={instance}
            screenshot={screenshot}
            liveStream={streamForDevice}
            selected={instance.id === selectedId}
            onSelect={onSelectDevice}
            gizmoDraggingRef={gizmoDraggingRef}
            grabRegistry={grabRegistry}
            onGizmoTargets={bindGizmoTargets}
            deviceColor={deviceColor}
            clayMode={clayMode}
            mediaPlaying={mediaPlaying}
            dropHighlight={instance.id === screenDropDeviceId}
            anchorRegistry={anchorRegistry}
            overlays={project.overlays}
            overlayTime={overlayTime}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={onSelectOverlay}
            selectedMaterialName={
              selectedMaterialDeviceId === instance.id ? selectedMaterialName : null
            }
            preserveBrandMarks={materialEditEnabled}
          />
        );
      })}
      <DevicePointerBridge
        onHoverDevice={onHoverDevice}
        onDragTargetDevice={onDragTargetDevice}
        onContextMenuDevice={onDeviceContextMenu}
      />
      <DeviceGrabController
        registry={grabRegistry}
        propRegistry={propGrabRegistry}
        selectedIdRef={selectedIdRef}
        gizmoControlRef={gizmoControlRef}
        gizmoDraggingRef={gizmoDraggingRef}
        annotateRef={annotateRef}
        onSelect={onSelectDevice}
        onMove={onMoveDevice}
        onRotate={onRotateDevice}
        onSelectProp={onSelectProp}
        onMoveProp={onMoveProp}
        onRotateProp={onRotateProp}
        onSelectEmpty={onSelectEmpty}
        onDraggingChange={onGizmoDraggingChange}
        materialEditEnabled={materialEditEnabled}
        onPickMaterial={onPickMaterial}
      />
      <AnnotationDrawController
        mode={annotate ?? null}
        ink={annotateInk}
        registry={anchorRegistry}
        onCommit={onAnnotation}
        onSelect={onSelectOverlay}
      />
      <RotationBall
        key={`gizmo-v3-${gizmoSubjectId ?? 'none'}-${propSelected ? 'prop' : 'device'}-${gizmoActive ? 'on' : 'off'}`}
        targets={gizmoTargets}
        active={Boolean(gizmoActive && gizmoSubjectId && gizmoTargets)}
        mode={gizmoMode}
        controlRef={gizmoControlRef}
        onDraggingChange={(dragging) => {
          gizmoDraggingRef.current = dragging;
          onGizmoDraggingChange?.(dragging);
        }}
        onRotate={(rotation, opts) => {
          if (propSelected) {
            if (!selectedPropId) return;
            onRotateProp?.(selectedPropId, rotation);
            return;
          }
          if (!selectedId) return;
          onRotateDevice?.(selectedId, rotation, opts);
        }}
        onMove={(position, opts) => {
          if (propSelected) {
            if (!selectedPropId) return;
            onMoveProp?.(selectedPropId, position);
            return;
          }
          if (!selectedId) return;
          onMoveDevice?.(selectedId, position, opts);
        }}
      />
    </>
  );
}

function DeviceCanvasImpl({
  project,
  captureRef,
  gizmoMode = 'rotate',
  mediaPlaying = false,
  liveStream = null,
  liveStreamDeviceId = null,
  cameraPosition = null,
  canvasId = 'main',
  gizmoActive = true,
  sharedOrbit = null,
  onSharedOrbitChange,
  onCameraCommit,
  onOrbitStart,
  focusPoint = null,
  recenterToken = 0,
  onSelectDevice,
  overlayTime = 0,
  selectedPropId = null,
  onSelectProp,
  backdropSelected = false,
  onSelectBackdrop,
  onSelectSky,
  onSelectFloor,
  onSelectOverlay,
  selectedOverlayId = null,
  onHoverDevice,
  onDragTargetDevice,
  onDeviceContextMenu,
  onClearSelection,
  onRotateDevice,
  onMoveDevice,
  onMoveProp,
  onRotateProp,
  onSelectEmpty,
  onGizmoDraggingChange,
  gizmoDragging = false,
  screenDropDeviceId = null,
  lightGizmoActive = false,
  onLightPositionChange,
  selectedSceneLightId = null,
  onSceneLightPositionChange,
  onSelectSceneLight,
  onSelectKeyLight,
  onSpacePanDrag,
  viewGesture = 'rotate',
  onSwipe,
  onLongPress,
  annotate = null,
  annotateInk,
  onAnnotation,
  pixelRatio,
  freezeFraming = false,
  onSceneReady,
  shadowExportBoost = false,
  materialEditEnabled = false,
  selectedMaterialName = null,
  selectedMaterialDeviceId = null,
  onPickMaterial,
}: Props) {
  const propGrabRegistry = useRef(new Map<string, THREE.Object3D>());
  const sharedGizmoDraggingRef = useRef(false);
  const [propGizmoTargets, setPropGizmoTargets] = useState<GizmoTargets | null>(null);
  const selectedPropIdRef = useRef(selectedPropId);
  selectedPropIdRef.current = selectedPropId;
  const bindPropGizmoTargets = useCallback((propId: string, targets: GizmoTargets | null) => {
    if (propId !== selectedPropIdRef.current) {
      if (targets == null) return;
      return;
    }
    setPropGizmoTargets((prev) => {
      if (targets == null) return prev == null ? prev : null;
      if (prev && prev.position === targets.position && prev.rotation === targets.rotation) return prev;
      return targets;
    });
  }, []);
  useEffect(() => {
    if (!selectedPropId) {
      setPropGizmoTargets((prev) => (prev == null ? prev : null));
    }
  }, [selectedPropId]);
  const selected = project.devices.find((d) => d.id === project.selectedDeviceId) ?? project.devices[0];
  const resolvedFocus = focusPoint ?? selected?.position ?? { x: 0, y: 0, z: 0 };
  const studioPreset = useStudioPreset(
    project.background,
    project.background === 'transparent' ? null : project.gradientColors,
  );
  const hasStudioBackdrop = Boolean(project.sceneProps?.some((p) => p.kind === 'studio_backdrop'));
  const blocksGround = (project.sceneProps ?? []).some((p) => (
    p.kind === 'concrete_slab' || p.kind === 'pedestal' || p.kind === 'stone_plinth'
    || p.kind === 'metal_disc' || p.kind === 'studio_backdrop'
    || p.kind === 'stage' || p.kind === 'rock'
  ));
  const showGroundBase = project.showGroundBase !== false && !blocksGround;
  const hasShadowReceiverProp = (project.sceneProps ?? []).some((p) => (
    p.kind === 'concrete_slab' || p.kind === 'pedestal' || p.kind === 'stone_plinth'
    || p.kind === 'metal_disc' || p.kind === 'stage' || p.kind === 'studio_backdrop'
  ));
  const lightPosition = project.lightPosition ?? DEFAULT_PROJECT.lightPosition;
  const lightColor = project.lightColor ?? DEFAULT_PROJECT.lightColor;
  const fill = project.fillIntensity ?? DEFAULT_PROJECT.fillIntensity;
  const keyIntensity = Math.max(0, project.lightIntensity);
  const toneMappingExposure = project.toneMappingExposure ?? studioPreset.toneMappingExposure;
  const movingLight = lightGizmoActive || Boolean(selectedSceneLightId);
  const shadowBusy = gizmoDragging || movingLight || Boolean(mediaPlaying);
  return (
    <Canvas
      key={canvasId}
      // Idle scenes should not burn GPU — orbit / gizmos / playback call invalidate().
      frameloop="demand"
      dpr={pixelRatio ?? LIVE_CANVAS_DPR}
      shadows
      // preserveDrawingBuffer off for live fill-rate; CaptureBridge renders then reads sync.
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, EYE_CAMERA_DISTANCE], fov: EYE_PERSPECTIVE_FOV, near: 0.1, far: 100 }}
      style={{ width: '100%', height: '100%', background: studioPreset.clearColor, display: 'block' }}
      onCreated={({ gl }) => {
        gl.setClearColor(studioPreset.clearColor, project.background === 'transparent' ? 0 : 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = toneMappingExposure;
        // Rebuilds the shared shadow chunk from stock + PCSS so every canvas
        // (split view, thumbnails, exports) and HMR cycle lands on the same shader.
        installProgressiveShadowShader('studio');
        gl.shadowMap.enabled = true;
        // PCSS (contact-hardening) for mesh-to-mesh and floor cast; ContactShadows adds a light foot kiss.
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        installRenderGrade(gl);
      }}
      onPointerMissed={() => onClearSelection?.()}
    >
      <StudioShadowInteractionProvider exportBoost={shadowExportBoost} busyExternal={shadowBusy}>
        <DemandKeepAlive active={shadowBusy} />
        <Background
          preset={project.background}
          colors={project.background === 'transparent' ? null : project.gradientColors}
          onSelectSky={onSelectSky}
        />
        <StudioHdri
          intensity={project.environmentIntensity ?? studioPreset.environmentIntensity}
        />
        <StudioExposure exposure={toneMappingExposure} />
        <RenderGradeSync />
        <StudioDepthOfField
          amount={project.depthOfField ? (project.depthOfFieldAmount ?? DEFAULT_PROJECT.depthOfFieldAmount) : 0}
          focus={resolvedFocus}
        />
        <StudioAmbientOcclusion
          amount={project.ambientOcclusion ?? DEFAULT_PROJECT.ambientOcclusion}
        />
        <EnableBackdropPicking />
        <StudioLighting
          preset={studioPreset}
          keyPosition={lightPosition}
          keyColor={lightColor}
          keyIntensity={keyIntensity}
          fillIntensity={fill}
          shadowSoftness={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
          shadowOpacity={project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity}
          shadowType={project.shadowType ?? DEFAULT_PROJECT.shadowType}
          shadowContact={project.shadowContact ?? DEFAULT_PROJECT.shadowContact}
          shadowContactEnabled={project.shadowContactEnabled !== false}
          shadowDistance={project.shadowDistance ?? DEFAULT_PROJECT.shadowDistance}
          shadowColor={project.shadowColor ?? studioPreset.shadow.color ?? DEFAULT_SHADOW_COLOR}
          shadowQuality={project.shadowQuality ?? DEFAULT_PROJECT.shadowQuality}
          shadowExportBoost={shadowExportBoost}
          showGroundBase={showGroundBase}
          hasStudioBackdropProp={hasStudioBackdrop}
          hasShadowReceiverProp={hasShadowReceiverProp}
          background={project.background}
          gradientColors={project.background === 'transparent' ? null : project.gradientColors}
          focus={resolvedFocus}
          canvasId={canvasId ?? 'main'}
          backdropSelected={backdropSelected}
          onSelectBackdrop={onSelectBackdrop}
          onSelectFloor={onSelectFloor}
          backdropYaw={
            project.cameraView === 'left' ? -90
              : project.cameraView === 'right' ? 90
                : 0
          }
        >
          <KeyLightRig
            position={lightPosition}
            color={lightColor}
            intensity={keyIntensity * studioPreset.key.intensity * 0.95}
            castShadow={
              keyIntensity > 0.001
              && (project.shadowType ?? DEFAULT_PROJECT.shadowType) !== 'off'
              && (project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity) > 0.01
            }
            shadowSoftness={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
            shadowOpacity={project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity}
            shadowDistance={project.shadowDistance ?? DEFAULT_PROJECT.shadowDistance}
            shadowQuality={project.shadowQuality ?? DEFAULT_PROJECT.shadowQuality}
            shadowExportBoost={shadowExportBoost}
            gizmoActive={lightGizmoActive && gizmoActive && keyIntensity > 0.001}
            target={resolvedFocus}
            onPositionChange={onLightPositionChange}
            onDraggingChange={onGizmoDraggingChange}
            onSelect={onSelectKeyLight}
          />
          <SceneLights
            lights={project.sceneLights ?? []}
            selectedId={selectedSceneLightId}
            gizmoActive={gizmoActive && !lightGizmoActive}
            onSelect={onSelectSceneLight}
            onPositionChange={onSceneLightPositionChange}
            onDraggingChange={onGizmoDraggingChange}
          />
        </StudioLighting>
        <SceneEnvironment
          reflectionMap={project.reflectionMap ?? DEFAULT_PROJECT.reflectionMap}
          reflectionMapImage={project.reflectionMapImage ?? null}
          background={project.background}
          colors={project.background === 'transparent' ? null : project.gradientColors}
        >
          <Suspense fallback={<LoadingFallback />}>
            <SceneProps
              props={project.sceneProps ?? []}
              selectedId={selectedPropId}
              onSelect={onSelectProp}
              grabRegistry={propGrabRegistry}
              onGizmoTargets={bindPropGizmoTargets}
              gizmoDraggingRef={sharedGizmoDraggingRef}
              backdropFloor={project.gradientColors.edge}
              backdropShadowOpacity={(
                (project.shadowType ?? DEFAULT_PROJECT.shadowType) === 'off'
                || (project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity) <= 0.01
              )
                ? 0
                : THREE.MathUtils.clamp(
                  opacityToShadowStrength(
                    (project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity)
                      * studioPreset.shadow.opacityScale
                      * 1.12,
                    1,
                  ).catcher * 1.3,
                  0,
                  0.86,
                )}
              backdropShadowSoftness={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
              backdropLightPosition={lightPosition}
              backdropLightTarget={resolvedFocus}
              backdropShadowColor={project.shadowColor ?? studioPreset.shadow.color}
            />
            <ExtrudedText
              overlays={project.overlays}
              time={overlayTime}
              onSelect={onSelectOverlay}
            />
            <ExtrudedShape
              overlays={project.overlays}
              time={overlayTime}
              onSelect={onSelectOverlay}
            />
            <SceneDevices
              project={project}
              gizmoMode={gizmoMode}
              mediaPlaying={mediaPlaying}
              liveStream={liveStream}
              liveStreamDeviceId={liveStreamDeviceId}
              gizmoActive={gizmoActive && !movingLight}
              onSelectDevice={onSelectDevice}
              onHoverDevice={onHoverDevice}
              onDragTargetDevice={onDragTargetDevice}
              onDeviceContextMenu={onDeviceContextMenu}
              onRotateDevice={onRotateDevice}
              onMoveDevice={onMoveDevice}
              onSelectProp={onSelectProp}
              onMoveProp={onMoveProp}
              onRotateProp={onRotateProp}
              onSelectEmpty={onSelectEmpty}
              selectedPropId={selectedPropId}
              propGizmoTargets={propGizmoTargets}
              propGrabRegistry={propGrabRegistry}
              gizmoDraggingRef={sharedGizmoDraggingRef}
              onGizmoDraggingChange={onGizmoDraggingChange}
              screenDropDeviceId={screenDropDeviceId}
              annotate={annotate}
              annotateInk={annotateInk}
              onAnnotation={onAnnotation}
              overlayTime={overlayTime}
              selectedOverlayId={selectedOverlayId}
              onSelectOverlay={onSelectOverlay}
              materialEditEnabled={materialEditEnabled}
              selectedMaterialName={selectedMaterialName}
              selectedMaterialDeviceId={selectedMaterialDeviceId}
              onPickMaterial={onPickMaterial}
            />
            <SceneReady onReady={onSceneReady} />
          </Suspense>
        </SceneEnvironment>
        <CameraRig
          view={project.cameraView}
          lens={project.cameraLens ?? 'standard'}
          split={project.compositionMode === 'split'}
          animatedPosition={cameraPosition}
          sharedOrbit={sharedOrbit}
          onSharedOrbitChange={onSharedOrbitChange}
          onCameraCommit={onCameraCommit}
          onOrbitStart={onOrbitStart}
          focusPoint={resolvedFocus}
          recenterToken={recenterToken}
          onSpacePanDrag={onSpacePanDrag}
          viewGesture={viewGesture}
          onSwipe={onSwipe}
          onLongPress={onLongPress}
          annotate={annotate}
          freezeFraming={freezeFraming || gizmoDragging}
        />
        <CaptureBridge
          captureRef={captureRef}
          edgeBlurTop={project.edgeBlurTop ?? false}
          edgeBlurBottom={project.edgeBlurBottom ?? false}
          edgeBlurAmount={project.edgeBlurAmount ?? 24}
        />
      </StudioShadowInteractionProvider>
    </Canvas>
  );
}

/** Ignore callback identity — App recreates lambdas often for UI-only state. */
function canvasDataEqual(prev: Props, next: Props): boolean {
  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]) as Set<keyof Props>;
  for (const key of keys) {
    if (typeof prev[key] === 'function' || typeof next[key] === 'function') continue;
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

const MemoDeviceCanvas = memo(DeviceCanvasImpl, canvasDataEqual);

/**
 * Always update a props ref so memoized callbacks stay fresh, while the heavy
 * canvas tree only re-renders when data props change (project, playhead, etc.).
 */
export default function DeviceCanvas(props: Props) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const stableCallbacks = useMemo(() => ({
    onSharedOrbitChange: (orbit: NonNullable<Props['sharedOrbit']>) => {
      propsRef.current.onSharedOrbitChange?.(orbit);
    },
    onCameraCommit: (
      position: Vec3,
      orbit: { offset: Vec3; lookOffset?: Vec3 },
    ) => {
      propsRef.current.onCameraCommit?.(position, orbit);
    },
    onOrbitStart: () => {
      propsRef.current.onOrbitStart?.();
    },
    onSelectDevice: (payload: DeviceSelectPayload) => {
      propsRef.current.onSelectDevice?.(payload);
    },
    onSelectProp: (id: string) => {
      propsRef.current.onSelectProp?.(id);
    },
    onSelectBackdrop: () => {
      propsRef.current.onSelectBackdrop?.();
    },
    onSelectSky: () => {
      propsRef.current.onSelectSky?.();
    },
    onSelectFloor: () => {
      propsRef.current.onSelectFloor?.();
    },
    onSelectOverlay: (id: string) => {
      propsRef.current.onSelectOverlay?.(id);
    },
    onHoverDevice: (id: string | null) => {
      propsRef.current.onHoverDevice?.(id);
    },
    onDragTargetDevice: (id: string | null) => {
      propsRef.current.onDragTargetDevice?.(id);
    },
    onDeviceContextMenu: (payload: DeviceSelectPayload) => {
      propsRef.current.onDeviceContextMenu?.(payload);
    },
    onClearSelection: () => {
      propsRef.current.onClearSelection?.();
    },
    onRotateDevice: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => {
      propsRef.current.onRotateDevice?.(id, rotation, opts);
    },
    onMoveDevice: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => {
      propsRef.current.onMoveDevice?.(id, position, opts);
    },
    onMoveProp: (id: string, position: Vec3) => {
      propsRef.current.onMoveProp?.(id, position);
    },
    onRotateProp: (id: string, rotation: Vec3) => {
      propsRef.current.onRotateProp?.(id, rotation);
    },
    onSelectEmpty: (target: 'sky' | 'floor' | 'backdrop') => {
      propsRef.current.onSelectEmpty?.(target);
    },
    onGizmoDraggingChange: (dragging: boolean) => {
      propsRef.current.onGizmoDraggingChange?.(dragging);
    },
    onLightPositionChange: (position: Vec3) => {
      propsRef.current.onLightPositionChange?.(position);
    },
    onSceneLightPositionChange: (id: string, position: Vec3) => {
      propsRef.current.onSceneLightPositionChange?.(id, position);
    },
    onSelectSceneLight: (id: string) => {
      propsRef.current.onSelectSceneLight?.(id);
    },
    onSelectKeyLight: () => {
      propsRef.current.onSelectKeyLight?.();
    },
    onSpacePanDrag: () => {
      propsRef.current.onSpacePanDrag?.();
    },
    onSwipe: (direction: 'left' | 'right') => {
      propsRef.current.onSwipe?.(direction);
    },
    onLongPress: (point: { clientX: number; clientY: number }) => {
      propsRef.current.onLongPress?.(point);
    },
    onAnnotation: (mark: AnnotationMark) => {
      propsRef.current.onAnnotation?.(mark);
    },
    onSceneReady: () => {
      propsRef.current.onSceneReady?.();
    },
    onPickMaterial: (payload: MaterialPickPayload) => {
      propsRef.current.onPickMaterial?.(payload);
    },
  }), []);

  return <MemoDeviceCanvas {...props} {...stableCallbacks} />;
}

// Device GLBs are fetched on demand from private Supabase Storage and cached
// encrypted — do not preload bundled ./models paths.
