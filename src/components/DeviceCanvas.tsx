import {
  Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls, TransformControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getDevice, type DeviceUv } from '../lib/devices';
import { applyLidOpen, setupLidRig, type LidRig } from '../lib/deviceLid';
import { applyProgressiveEdgeBlur } from '../lib/edgeBlur';
import { useScreenEmissiveMap } from '../lib/useScreenTexture';
import ProceduralDevice from './ProceduralDevice';
import RotationBall, { type GizmoControl, type GizmoMode, type GizmoTargets } from './RotationBall';
import SceneProps, { CycloramaBackdrop } from './SceneProps';
import {
  DEVICE_COLORS, DEFAULT_PROJECT, cameraLensFov,
  type BackgroundPreset, type CameraLens, type CameraView, type DeviceColor, type DeviceInstance,
  type GradientColors, type MockupProject, type Vec3,
} from '../types';

const SceneEnvMapContext = createContext<THREE.Texture | null>(null);

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
   */
  sharedOrbit?: { offset: Vec3 } | null;
  onSharedOrbitChange?: (orbit: { offset: Vec3 }) => void;
  /** Device center to frame — camera always looks here. */
  focusPoint?: Vec3 | null;
  /** Bump to force an instant centered snap (no damping / easing). */
  recenterToken?: number;
  onSelectDevice?: (payload: DeviceSelectPayload) => void;
  /** Device under the pointer, or null when the pointer leaves the canvas. */
  onHoverDevice?: (id: string | null) => void;
  /** Device under a dragged file, or null when the drag leaves the canvas. */
  onDragTargetDevice?: (id: string | null) => void;
  /** Right-click on a device — open the action menu so Paste can target that screen. */
  onDeviceContextMenu?: (payload: DeviceSelectPayload) => void;
  onClearSelection?: () => void;
  onRotateDevice?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveDevice?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onGizmoDraggingChange?: (dragging: boolean) => void;
  /** While a screenshot file is dragged over the canvas, glow this device's screen. */
  screenDropDeviceId?: string | null;
  /** Show translate gizmo for the key directional light */
  lightGizmoActive?: boolean;
  onLightPositionChange?: (position: Vec3) => void;
  /** Fired once the user actually pans: Space held and the canvas dragged. */
  onSpacePanDrag?: () => void;
  /** Pixel ratio override. Thumbnails pass 1 to stay light. */
  pixelRatio?: [number, number];
  /** Fires after the device meshes have mounted — thumbnails wait on this. */
  onSceneReady?: () => void;
}

function applyDeviceFinish(
  root: THREE.Object3D,
  screenMatName: string,
  deviceColor: DeviceColor,
  clayMode: boolean,
) {
  const finish = DEVICE_COLORS.find((c) => c.id === deviceColor) ?? DEVICE_COLORS[0];
  const clay = clayMode || deviceColor === 'clay';
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || '').toLowerCase();
      if (mat.name === screenMatName || name.includes('screen') || name.includes('display')) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      if (!('color' in standard) || !standard.color) continue;
      // Skip pure glass / lens materials
      if (name.includes('glass') || name.includes('lens') || name.includes('camera_glass')) {
        if (clay) {
          standard.metalness = 0;
          standard.roughness = 0.85;
          standard.envMapIntensity = 0.15;
          standard.transparent = false;
          standard.opacity = 1;
        }
        continue;
      }
      standard.color = new THREE.Color(finish.hex);
      if (clay) {
        standard.metalness = 0;
        standard.roughness = 0.92;
        standard.envMapIntensity = 0.08;
        if ('clearcoat' in standard) (standard as THREE.MeshPhysicalMaterial).clearcoat = 0;
      } else {
        // Keep some metal sheen but leave enough diffuse response so studio light reads on the body
        standard.metalness = Math.min(0.72, Math.max(0.35, standard.metalness ?? 0.55));
        standard.roughness = Math.min(0.5, Math.max(0.28, standard.roughness ?? 0.38));
        standard.envMapIntensity = Math.max(1.15, standard.envMapIntensity ?? 1.25);
      }
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
    tex.center.set(0, 0);
    tex.rotation = 0;
    tex.repeat.set(uv.repeat[0], uv.repeat[1]);
  }
  if (uv.offset) tex.offset.set(uv.offset[0], uv.offset[1]);
  if (uv.clamp) {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
}

function applyMaterialTweaks(material: THREE.MeshStandardMaterial, tweak: Record<string, number | boolean | string>) {
  for (const [key, value] of Object.entries(tweak)) {
    if (key === 'color' || key === 'emissive') {
      (material as any)[key] = new THREE.Color(value as number);
    } else if (key === 'toneMapped') {
      material.toneMapped = Boolean(value);
    } else if (key === 'transparent') {
      material.transparent = Boolean(value);
    } else if (typeof value === 'number' && key in material) {
      (material as any)[key] = value;
    }
  }
  material.needsUpdate = true;
}

function fitDeviceRoot(root: THREE.Object3D, rot: [number, number, number]) {
  root.rotation.set(rot[0], rot[1], rot[2]);
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) root.scale.setScalar(3.0 / size.y);
  root.updateMatrixWorld(true);

  const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.position.sub(center);
}

function findScreenMaterial(root: THREE.Object3D, preferredName: string): THREE.MeshStandardMaterial | null {
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
      const lower = (mat.name || '').toLowerCase();
      // Prefer real display materials — don't treat glass overlays as the screen
      if (!fallback && /screen|display|oled|lcd/.test(lower) && !/glass/.test(lower)) fallback = standard;
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
  if (/screen|display|oled|lcd/.test(lower) && !/glass/.test(lower)) return false;
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

  // Do NOT use MeshPhysicalMaterial.copy(standard) — Three copies
  // clearcoatNormalScale from the source and crashes when it's undefined.
  const src = mat as THREE.MeshStandardMaterial;
  const phys = new THREE.MeshPhysicalMaterial({
    name: mat.name,
    color: src.color?.clone?.() ?? new THREE.Color(0xffffff),
    map: src.map ?? null,
    metalness: src.metalness ?? 0,
    roughness: typeof src.roughness === 'number' ? src.roughness : 0.5,
    metalnessMap: src.metalnessMap ?? null,
    roughnessMap: src.roughnessMap ?? null,
    normalMap: src.normalMap ?? null,
    normalScale: src.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    emissive: src.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveMap: src.emissiveMap ?? null,
    emissiveIntensity: src.emissiveIntensity ?? 1,
    envMap: src.envMap ?? null,
    envMapIntensity: src.envMapIntensity ?? 1,
    transparent: mat.transparent,
    opacity: mat.opacity,
    side: mat.side,
    depthWrite: mat.depthWrite,
    toneMapped: src.toneMapped ?? true,
  });
  phys.userData = { ...mat.userData, glassUpgraded: true };
  replaceMaterialEverywhere(root, mat, phys);
  return phys;
}

/** Glossy clearcoat on the screen itself — reflections sit on top of the screenshot. */
function applyScreenClearcoat(
  screenMaterial: THREE.MeshStandardMaterial,
  amount: number,
  envMap?: THREE.Texture | null,
) {
  const t = Math.min(1, Math.max(0, amount));
  const physical = (screenMaterial as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
    ? screenMaterial as THREE.MeshPhysicalMaterial
    : null;
  if (!physical) return;
  if (envMap) physical.envMap = envMap;
  // Base stays matte/emissive so the screenshot reads cleanly
  physical.metalness = 0;
  physical.roughness = 1;
  physical.envMapIntensity = 0;
  physical.transmission = 0;
  // Clearcoat layer = front glass reflection over the image
  physical.clearcoat = t;
  physical.clearcoatRoughness = Math.max(0.02, 0.22 - t * 0.18);
  physical.specularIntensity = 1;
  physical.needsUpdate = true;
}

function applyGlassReflection(
  root: THREE.Object3D,
  screenMat: string,
  amount: number,
  glassMats: string[] = [],
  tweaks?: Record<string, Record<string, number | boolean | string>>,
  envMap?: THREE.Texture | null,
  screenMaterial?: THREE.MeshStandardMaterial | null,
) {
  const t = Math.min(1, Math.max(0, amount));
  if (screenMaterial) applyScreenClearcoat(screenMaterial, amount, envMap);

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

      if (envMap) physical.envMap = envMap;
      physical.transmission = 0;
      physical.metalness = 0;
      physical.specularIntensity = 1;
      physical.specularColor = new THREE.Color(0xffffff);

      if (thinCover) {
        // Additive glass sheet over the display — env highlights without hiding the image
        physical.color = new THREE.Color(0xffffff);
        physical.transparent = true;
        physical.depthWrite = false;
        physical.blending = THREE.AdditiveBlending;
        physical.opacity = 0.2 + t * 0.65;
        physical.roughness = Math.max(0.02, 0.28 - t * 0.24);
        physical.envMapIntensity = 1.2 + t * 2.8;
        physical.clearcoat = 0.4 + t * 0.6;
        physical.clearcoatRoughness = Math.max(0.02, 0.2 - t * 0.16);
        mesh.renderOrder = 2;
      } else {
        // Body / back / camera glass — glossy opaque or lightly tinted
        physical.blending = THREE.NormalBlending;
        physical.envMapIntensity = 0.7 + t * 2.4;
        physical.roughness = Math.max(0.04, 0.45 - t * 0.38);
        physical.clearcoat = 0.3 + t * 0.7;
        physical.clearcoatRoughness = Math.max(0.03, 0.28 - t * 0.22);
        if (physical.transparent || (physical.opacity ?? 1) < 0.55) {
          physical.transparent = true;
          physical.depthWrite = false;
          physical.opacity = Math.min(0.55, Math.max(0.12, 0.14 + t * 0.35));
        } else {
          physical.depthWrite = true;
        }
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

  useFrame(({ clock }) => {
    const pulse = 0.5 + Math.sin(clock.elapsedTime * 5.5) * 0.18;
    for (const mat of matsRef.current) mat.opacity = pulse;
    const screenMat = screenMatRef.current;
    if (screenMat) screenMat.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 5.5) * 0.35;
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

function GltfDeviceContent({
  url,
  deviceId,
  screenshot,
  liveStream,
  glassReflection,
  deviceColor,
  clayMode,
  mediaPlaying,
  lidOpen = 1,
  dropHighlight = false,
}: {
  url: string;
  deviceId: string;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  glassReflection: number;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
  lidOpen?: number;
  dropHighlight?: boolean;
}) {
  const device = getDevice(deviceId);
  const { scene, animations } = useGLTF(url);
  const lidRigRef = useRef<LidRig | null>(null);
  const root = useMemo(() => {
    const hasSkin = Boolean(scene.getObjectByProperty('isSkinnedMesh', true));
    const cloned = (hasSkin ? cloneSkinned(scene) : scene.clone(true)) as THREE.Object3D;
    const map = new Map<THREE.Material, THREE.Material>();
    const hidden = new Set(device.hideNodes ?? []);
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (hidden.has(mesh.name)) mesh.visible = false;
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
  }, [scene, animations, device.lid, device.screenMat]);

  useLayoutEffect(() => {
    if (!lidRigRef.current) return;
    applyLidOpen(lidRigRef.current, lidOpen);
  }, [lidOpen, root]);

  const [screen, setScreen] = useState<{
    material: THREE.MeshPhysicalMaterial;
    originalEmissiveMap: THREE.Texture | null;
  } | null>(null);

  useEffect(() => {
    fitDeviceRoot(root, device.rot);
    const processed = new Set<THREE.Material>();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat || processed.has(mat)) continue;
        processed.add(mat);
        const tweak = device.tweaks?.[mat.name];
        if (tweak) applyMaterialTweaks(mat as THREE.MeshStandardMaterial, tweak);
      }
    });

    const found = findScreenMaterial(root, device.screenMat);
    if (!found) {
      setScreen(null);
      return;
    }
    const originalEmissiveMap = (found.emissiveMap || found.map || null) as THREE.Texture | null;
    const screenMaterial = upgradeToPhysical(root, found);
    screenMaterial.emissive = new THREE.Color(0xffffff);
    screenMaterial.emissiveIntensity = 1;
    screenMaterial.toneMapped = false;
    screenMaterial.metalness = 0;
    screenMaterial.roughness = 1;
    screenMaterial.envMapIntensity = 0;
    screenMaterial.clearcoat = 0;
    screenMaterial.clearcoatRoughness = 0.2;
    screenMaterial.color = new THREE.Color(0x000000);
    screenMaterial.map = null;
    screenMaterial.emissiveMap = originalEmissiveMap;
    screenMaterial.transparent = false;
    screenMaterial.opacity = 1;
    screenMaterial.blending = THREE.NormalBlending;
    screenMaterial.needsUpdate = true;
    setScreen({ material: screenMaterial, originalEmissiveMap });
    applyDeviceFinish(root, device.screenMat, deviceColor, clayMode);
  }, [root, device, deviceColor, clayMode]);

  const envMap = useContext(SceneEnvMapContext);
  useEffect(() => {
    try {
      applyGlassReflection(
        root,
        device.screenMat,
        clayMode ? Math.min(glassReflection, 0.12) : glassReflection,
        device.glassMats,
        device.tweaks,
        envMap,
        screen?.material ?? null,
      );
    } catch (err) {
      console.warn('[glass reflection]', err);
    }
  }, [root, device, glassReflection, envMap, screen, clayMode]);

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

function classifyPointerHit(object: THREE.Object3D): 'skip' | 'gizmo' | 'solid' {
  if ((object as THREE.Object3D & { isTransformControlsPlane?: boolean }).isTransformControlsPlane) return 'skip';
  if (object.userData.isGizmoHandle) return 'gizmo';
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
  gizmoControlRef,
  gizmoDraggingRef,
  onSelect,
  onMove,
  onDraggingChange,
}: {
  registry: MutableRefObject<Map<string, THREE.Object3D>>;
  gizmoControlRef: MutableRefObject<GizmoControl | null>;
  gizmoDraggingRef: MutableRefObject<boolean>;
  onSelect?: (payload: DeviceSelectPayload) => void;
  onMove?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const { camera, gl, scene, controls } = useThree();
  const draggingRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onMoveRef = useRef(onMove);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onSelectRef.current = onSelect;
  onMoveRef.current = onMove;
  onDraggingChangeRef.current = onDraggingChange;

  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();
    const world = new THREE.Vector3();
    const grabOffset = new THREE.Vector3();
    const normal = new THREE.Vector3();

    const onCapture = (event: PointerEvent) => {
      if (event.button !== 0 || draggingRef.current || gizmoDraggingRef.current) return;
      const orbit = controls as { enabled?: boolean; enableRotate?: boolean; enablePan?: boolean } | null;
      if (orbit?.enablePan && orbit.enableRotate === false) return;

      const rect = element.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      let deviceId: string | null = null;
      for (const hit of hits) {
        const kind = classifyPointerHit(hit.object);
        if (kind === 'skip') continue;
        if (kind === 'gizmo') continue;
        const id = deviceGrabId(hit.object);
        if (id) deviceId = id;
        break;
      }
      // Rings overlap the body. Grabbing the device moves it; rings only win
      // where they stick out past the mesh.
      if (!deviceId) return;
      const grabbedId = deviceId;
      const group = registry.current.get(grabbedId);
      if (!group) return;

      event.stopImmediatePropagation();
      const previousOrbit = orbit?.enabled !== false;
      if (orbit) orbit.enabled = false;
      gizmoControlRef.current?.setEnabled(false);

      group.getWorldPosition(world);
      camera.getWorldDirection(normal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
      if (!raycaster.ray.intersectPlane(plane, hitPoint)) {
        if (orbit) orbit.enabled = previousOrbit;
        gizmoControlRef.current?.setEnabled(true);
        return;
      }
      grabOffset.copy(hitPoint).sub(world);

      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let moved = false;
      draggingRef.current = true;

      const finish = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        draggingRef.current = false;
        if (orbit) orbit.enabled = previousOrbit;
        gizmoControlRef.current?.setEnabled(true);
        element.style.cursor = '';
        if (!moved) {
          onSelectRef.current?.({ id: grabbedId, clientX: startX, clientY: startY, openMenu: true });
          return;
        }
        const position = group.position;
        onMoveRef.current?.(grabbedId, {
          x: position.x,
          y: position.y,
          z: position.z,
        }, { recordKeys: true });
        gizmoDraggingRef.current = false;
        onDraggingChangeRef.current?.(false);
      };

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved) {
          if (dx * dx + dy * dy < 16) return;
          moved = true;
          gizmoDraggingRef.current = true;
          onDraggingChangeRef.current?.(true);
          onSelectRef.current?.({ id: grabbedId, clientX: startX, clientY: startY, openMenu: false });
          element.style.cursor = 'grabbing';
        }
        const point = pointerNdc(ev, element);
        raycaster.setFromCamera(point, camera);
        if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;
        hitPoint.sub(grabOffset);
        group.parent?.worldToLocal(hitPoint);
        clampDevicePosition(hitPoint);
        group.position.copy(hitPoint);
        onMoveRef.current?.(grabbedId, {
          x: hitPoint.x,
          y: hitPoint.y,
          z: hitPoint.z,
        }, { recordKeys: false });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    };

    element.addEventListener('pointerdown', onCapture, true);
    return () => {
      element.removeEventListener('pointerdown', onCapture, true);
    };
  }, [camera, gl, scene, controls, registry, gizmoControlRef, gizmoDraggingRef]);

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
}: {
  instance: DeviceInstance;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  selected: boolean;
  onSelect?: (payload: DeviceSelectPayload) => void;
  onGizmoTargets?: (deviceId: string, targets: GizmoTargets | null) => void;
  gizmoDraggingRef: MutableRefObject<boolean>;
  grabRegistry: MutableRefObject<Map<string, THREE.Object3D>>;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
}) {
  const device = getDevice(instance.deviceId);
  const positionRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0, moved: false });

  const radians = (d: number) => (d * Math.PI) / 180;

  useLayoutEffect(() => {
    const positionGroup = positionRef.current;
    const rotationGroup = rotationRef.current;
    if (!positionGroup || !rotationGroup) return;
    // While the gizmo is dragging, TransformControls owns the pose — don't fight it.
    if (gizmoDraggingRef.current) {
      rotationGroup.scale.setScalar(instance.scale ?? 1);
      return;
    }
    const rot = instance.rotation ?? { x: 0, y: 0, z: 0 };
    const pos = instance.position ?? { x: 0, y: 0, z: 0 };
    positionGroup.position.set(pos.x, pos.y, pos.z);
    rotationGroup.rotation.set(radians(rot.x), radians(rot.y), radians(rot.z));
    rotationGroup.scale.setScalar(instance.scale ?? 1);
  }, [instance.rotation.x, instance.rotation.y, instance.rotation.z, instance.position?.x, instance.position?.y, instance.position?.z, instance.scale, gizmoDraggingRef]);

  useLayoutEffect(() => {
    const group = positionRef.current;
    if (!group) return undefined;
    group.userData.deviceGrabId = instance.id;
    grabRegistry.current.set(instance.id, group);
    return () => {
      if (grabRegistry.current.get(instance.id) === group) grabRegistry.current.delete(instance.id);
    };
  }, [grabRegistry, instance.id]);

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
        {device.kind === 'procedural' ? (
          <ProceduralDevice
            device={device}
            screenshot={screenshot}
            liveStream={liveStream}
            finishHex={(DEVICE_COLORS.find((c) => c.id === deviceColor) ?? DEVICE_COLORS[0]).hex}
            clayMode={clayMode}
            mediaPlaying={mediaPlaying}
            dropHighlight={dropHighlight}
          />
        ) : device.url ? (
          <GltfDeviceContent
            key={`${device.url}|${device.screenMat}|${device.rot.join(',')}|${device.uv.mirrorX ? 1 : 0}|${device.uv.flipY ? 1 : 0}|${device.screenSize.width}x${device.screenSize.height}|${device.lid ? 'lid' : 'nolid'}`}
            url={device.url}
            deviceId={device.id}
            screenshot={screenshot}
            liveStream={liveStream}
            glassReflection={instance.glassReflection ?? 0.55}
            deviceColor={deviceColor}
            clayMode={clayMode}
            mediaPlaying={mediaPlaying}
            lidOpen={instance.lidOpen ?? 1}
            dropHighlight={dropHighlight}
          />
        ) : null}
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
  col = mix(col, lit, glow * 0.88);
  col = mix(col * 0.74, col, vig);

  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function StudioSky({ colors }: { colors: GradientColors }) {
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
    <mesh ref={mesh} layers={1} frustumCulled={false} renderOrder={-1} raycast={() => null}>
      <sphereGeometry args={[40, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Background({
  preset,
  colors,
}: {
  preset: BackgroundPreset;
  colors?: GradientColors | null;
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
    gl.setClearColor(colors?.edge ?? '#222836', 1);
    return undefined;
  }, [scene, gl, preset, colors?.edge]);
  if (preset === 'transparent' || !colors) return null;
  return <StudioSky colors={colors} />;
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
  const { gl, scene } = useThree();
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
      scene.environment = rt.texture;
      if ('environmentIntensity' in scene) {
        (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 1.15;
      }
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
      if (rt && scene.environment === rt.texture) scene.environment = null;
      setEnvMap(null);
      rt?.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, reflectionMap, reflectionMapImage, background, colorKey, colors]);

  return (
    <SceneEnvMapContext.Provider value={envMap}>
      {children}
    </SceneEnvMapContext.Provider>
  );
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function viewOffset(view: CameraView, split: boolean): Vec3 {
  const dist = split ? 7.4 : 5.7;
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
  gizmoActive,
  target,
  onPositionChange,
  onDraggingChange,
}: {
  position: Vec3;
  color: string;
  intensity: number;
  castShadow: boolean;
  shadowSoftness: number;
  gizmoActive: boolean;
  target: Vec3;
  onPositionChange?: (position: Vec3) => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [handleObj, setHandleObj] = useState<THREE.Group | null>(null);
  const draggingRef = useRef(false);
  const { gl } = useThree();
  const setHandleRef = useCallback((node: THREE.Group | null) => {
    setHandleObj((prev) => (prev === node ? prev : node));
  }, []);

  useLayoutEffect(() => {
    if (draggingRef.current) return;
    if (handleObj) {
      handleObj.position.set(position.x, position.y, position.z);
    }
    if (lightRef.current) {
      lightRef.current.position.set(position.x, position.y, position.z);
      lightRef.current.target.position.set(target.x, target.y, target.z);
      lightRef.current.target.updateMatrixWorld();
    }
  }, [handleObj, position.x, position.y, position.z, target.x, target.y, target.z]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.castShadow = castShadow;
    // 1024² keeps self-shadow cost reasonable while still reading on glass/metal.
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.radius = Math.max(1, shadowSoftness * 1.35);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.025;
    const cam = light.shadow.camera;
    cam.near = 0.5;
    cam.far = 24;
    cam.left = -5;
    cam.right = 5;
    cam.top = 5;
    cam.bottom = -5;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, [castShadow, shadowSoftness]);

  const syncFromHandle = () => {
    const handle = handleObj;
    const light = lightRef.current;
    if (!handle || !light) return;
    light.position.copy(handle.position);
    light.target.position.set(target.x, target.y, target.z);
    light.target.updateMatrixWorld();
  };

  const commitPosition = () => {
    if (!handleObj || !onPositionChange) return;
    onPositionChange({
      x: Number(handleObj.position.x.toFixed(3)),
      y: Number(handleObj.position.y.toFixed(3)),
      z: Number(handleObj.position.z.toFixed(3)),
    });
  };

  return (
    <>
      <directionalLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        castShadow={castShadow}
      />
      <group
        ref={setHandleRef}
        position={[position.x, position.y, position.z]}
        userData={{ exportHide: true }}
      >
        <mesh visible={gizmoActive} renderOrder={1005} castShadow={false} receiveShadow={false} userData={{ exportHide: true }}>
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
        </mesh>
        {gizmoActive ? (
          <mesh visible renderOrder={1004} castShadow={false} receiveShadow={false} userData={{ exportHide: true }}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.22}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        ) : null}
      </group>
      {gizmoActive && handleObj ? (
        <TransformControls
          object={handleObj}
          mode="translate"
          size={0.85}
          space="world"
          onMouseDown={() => {
            draggingRef.current = true;
            onDraggingChange?.(true);
            gl.domElement.style.cursor = 'grabbing';
          }}
          onObjectChange={() => {
            syncFromHandle();
          }}
          onMouseUp={() => {
            draggingRef.current = false;
            syncFromHandle();
            commitPosition();
            onDraggingChange?.(false);
            gl.domElement.style.cursor = '';
          }}
        />
      ) : null}
    </>
  );
}

/** Instant pose write — damping off so format/device re-centers never ease. */
function snapCameraPose(
  camera: THREE.Camera,
  controls: { enableDamping?: boolean; target: THREE.Vector3; update: () => void } | null | undefined,
  position: Vec3,
  focus: Vec3,
) {
  const wasDamping = controls?.enableDamping;
  if (controls) controls.enableDamping = false;
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
  focusPoint = null,
  recenterToken = 0,
  onSpacePanDrag,
}: {
  view: CameraView;
  lens: CameraLens;
  split: boolean;
  animatedPosition?: Vec3 | null;
  sharedOrbit?: { offset: Vec3 } | null;
  onSharedOrbitChange?: (orbit: { offset: Vec3 }) => void;
  focusPoint?: Vec3 | null;
  recenterToken?: number;
  onSpacePanDrag?: () => void;
}) {
  const { camera, gl } = useThree();
  const controls = useRef<any>(null);
  const [spacePan, setSpacePan] = useState(false);
  const fov = cameraLensFov(lens);
  const applyingSharedRef = useRef(false);
  const onSharedOrbitChangeRef = useRef(onSharedOrbitChange);
  onSharedOrbitChangeRef.current = onSharedOrbitChange;
  const onSpacePanDragRef = useRef(onSpacePanDrag);
  onSpacePanDragRef.current = onSpacePanDrag;
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
    view, camera, split, recenterToken,
    animatedPosition?.x, animatedPosition?.y, animatedPosition?.z,
    sharedOrbit, focus.x, focus.y, focus.z,
  ]);

  // Apply linked dual-pane orbit (same angle, each pane's own device focus) — also instant.
  useLayoutEffect(() => {
    if (!sharedOrbit || animatedPosition) return;
    const { offset } = sharedOrbit;
    const nextPos = {
      x: focus.x + offset.x,
      y: focus.y + offset.y,
      z: focus.z + offset.z,
    };
    const dx = camera.position.x - nextPos.x;
    const dy = camera.position.y - nextPos.y;
    const dz = camera.position.z - nextPos.z;
    if ((dx * dx + dy * dy + dz * dz) < 1e-8) {
      if (controls.current) {
        const t = controls.current.target;
        if (
          Math.abs(t.x - focus.x) < 1e-6
          && Math.abs(t.y - focus.y) < 1e-6
          && Math.abs(t.z - focus.z) < 1e-6
        ) return;
      }
    }
    applyingSharedRef.current = true;
    snapCameraPose(camera, controls.current, nextPos, focus);
    requestAnimationFrame(() => { applyingSharedRef.current = false; });
  }, [
    sharedOrbit?.offset.x, sharedOrbit?.offset.y, sharedOrbit?.offset.z,
    focus.x, focus.y, focus.z, camera, animatedPosition,
  ]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      setSpacePan(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (!isTypingTarget(event.target)) event.preventDefault();
      setSpacePan(false);
    };
    const onBlur = () => setSpacePan(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = spacePan ? 'grab' : '';
    const onPointerDown = () => {
      if (!spacePan) return;
      el.style.cursor = 'grabbing';
      onSpacePanDragRef.current?.();
    };
    const onPointerUp = () => { el.style.cursor = spacePan ? 'grab' : ''; };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl, spacePan]);

  const publishOrbit = () => {
    if (!onSharedOrbitChangeRef.current || applyingSharedRef.current || animatedPosition) return;
    const f = focusRef.current;
    // Keep the look-at locked on the device; only share the viewing offset.
    if (controls.current) {
      controls.current.target.set(f.x, f.y, f.z);
    }
    onSharedOrbitChangeRef.current({
      offset: {
        x: Number((camera.position.x - f.x).toFixed(4)),
        y: Number((camera.position.y - f.y).toFixed(4)),
        z: Number((camera.position.z - f.z).toFixed(4)),
      },
    });
  };

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      enablePan={spacePan}
      enableRotate={!spacePan}
      screenSpacePanning
      mouseButtons={{
        LEFT: spacePan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      minDistance={split ? 4.4 : 3.6}
      maxDistance={12}
      minPolarAngle={0.02}
      maxPolarAngle={Math.PI - 0.2}
      onChange={publishOrbit}
      onEnd={publishOrbit}
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
        gl.setClearColor('#d7d2c8', 1);
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

    const presentedImage = () => new Promise<string>((resolve, reject) => {
      // toDataURL of a WebGL canvas is blank until Chromium copies the presented frame back.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
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
            resolve(url.startsWith('data:image/webp') ? url : out.toDataURL('image/png'));
          } catch (error) {
            reject(error);
          }
        });
      });
    });

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

function SoftGroundDisc({ y, color }: { y: number; color: string }) {
  // Soft floor shade so the device sits in the cyclorama. ContactShadows can miss
  // on a second WebGL canvas, which made one dual pane look base-less.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <circleGeometry args={[3.6, 64]} />
      <meshStandardMaterial
        color={color}
        roughness={1}
        metalness={0}
        transparent
        opacity={0.06}
        depthWrite={false}
      />
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
  onGizmoDraggingChange,
  screenDropDeviceId = null,
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
  onGizmoDraggingChange?: (dragging: boolean) => void;
  screenDropDeviceId?: string | null;
}) {
  const [gizmoTargets, setGizmoTargets] = useState<GizmoTargets | null>(null);
  const gizmoDraggingRef = useRef(false);
  const grabRegistry = useRef(new Map<string, THREE.Object3D>());
  const gizmoControlRef = useRef<GizmoControl | null>(null);
  const selectedId = project.selectedDeviceId;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Stable callback — only the selected device may publish/clear the gizmo targets.
  // (Inline per-device callbacks were clearing the gizmo when sibling devices updated.)
  const bindGizmoTargets = useCallback((deviceId: string, targets: GizmoTargets | null) => {
    if (deviceId !== selectedIdRef.current) return;
    setGizmoTargets(targets);
  }, []);

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
        gizmoControlRef={gizmoControlRef}
        gizmoDraggingRef={gizmoDraggingRef}
        onSelect={onSelectDevice}
        onMove={onMoveDevice}
        onDraggingChange={onGizmoDraggingChange}
      />
      <RotationBall
        key={`gizmo-${selectedId}-${gizmoActive ? 'on' : 'off'}`}
        targets={gizmoTargets}
        active={Boolean(gizmoActive && selectedId && gizmoTargets)}
        mode={gizmoMode}
        controlRef={gizmoControlRef}
        onDraggingChange={(dragging) => {
          gizmoDraggingRef.current = dragging;
          onGizmoDraggingChange?.(dragging);
        }}
        onRotate={(rotation, opts) => {
          if (!selectedId) return;
          onRotateDevice?.(selectedId, rotation, opts);
        }}
        onMove={(position, opts) => {
          if (!selectedId) return;
          onMoveDevice?.(selectedId, position, opts);
        }}
      />
    </>
  );
}

export default function DeviceCanvas({
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
  focusPoint = null,
  recenterToken = 0,
  onSelectDevice,
  onHoverDevice,
  onDragTargetDevice,
  onDeviceContextMenu,
  onClearSelection,
  onRotateDevice,
  onMoveDevice,
  onGizmoDraggingChange,
  screenDropDeviceId = null,
  lightGizmoActive = false,
  onLightPositionChange,
  onSpacePanDrag,
  pixelRatio,
  onSceneReady,
}: Props) {
  const selected = project.devices.find((d) => d.id === project.selectedDeviceId) ?? project.devices[0];
  const resolvedFocus = focusPoint ?? selected?.position ?? { x: 0, y: 0, z: 0 };
  const hasStudioBackdrop = Boolean(project.sceneProps?.some((p) => p.kind === 'studio_backdrop'));
  const showSoftStudioSweep = project.background === 'studio' && !hasStudioBackdrop;
  const studioSet = hasStudioBackdrop || showSoftStudioSweep;
  const floorY = studioSet ? -1.55 : -1.63;
  const showGroundBase = project.background !== 'transparent'
    && !studioSet
    && !(project.sceneProps ?? []).some((p) => (
      p.kind === 'concrete_slab' || p.kind === 'pedestal' || p.kind === 'studio_backdrop'
      || p.kind === 'stage' || p.kind === 'rock'
    ));
  const lightPosition = project.lightPosition ?? DEFAULT_PROJECT.lightPosition;
  const lightColor = project.lightColor ?? DEFAULT_PROJECT.lightColor;
  const fill = project.fillIntensity ?? DEFAULT_PROJECT.fillIntensity;
  const keyIntensity = project.lightIntensity * (studioSet ? 1.05 : 1.2);

  return (
    <Canvas
      key={canvasId}
      dpr={pixelRatio ?? [1, 2]}
      shadows
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 5.7], fov: 38, near: 0.1, far: 100 }}
      style={{ width: '100%', height: '100%', background: '#16191f', display: 'block' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#16191f', 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.45;
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      onPointerMissed={() => onClearSelection?.()}
    >
      <Background
        preset={project.background}
        colors={project.background === 'transparent' ? null : project.gradientColors}
      />
      <ambientLight intensity={fill * (studioSet ? 1.35 : 1.25)} />
      <hemisphereLight
        args={[
          studioSet ? '#fffaf4' : '#f7fbff',
          studioSet ? '#e7e1d8' : '#5a5c64',
          fill * (studioSet ? 1.05 : 1.2),
        ]}
      />
      <KeyLightRig
        position={lightPosition}
        color={lightColor}
        intensity={keyIntensity}
        castShadow
        shadowSoftness={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
        gizmoActive={lightGizmoActive && gizmoActive}
        target={resolvedFocus}
        onPositionChange={onLightPositionChange}
        onDraggingChange={onGizmoDraggingChange}
      />
      <directionalLight
        position={studioSet ? [-3.2, 4.2, 3.2] : [-4, 1.5, -4]}
        color={studioSet ? '#fff6ee' : '#c5e8ec'}
        intensity={studioSet ? 0.85 + fill * 0.35 : 0.9 + fill * 1.05}
        castShadow={false}
      />
      <SceneEnvironment
        reflectionMap={project.reflectionMap ?? 'match_background'}
        reflectionMapImage={project.reflectionMapImage ?? null}
        background={project.background}
        colors={project.background === 'transparent' ? null : project.gradientColors}
      >
        <Suspense fallback={<LoadingFallback />}>
          {showSoftStudioSweep && (
            <group position={[0, floorY, 0]}>
              <CycloramaBackdrop
                color={project.gradientColors?.center ?? '#f6f4f0'}
                floor={project.gradientColors?.edge ?? '#c9c3b8'}
              />
            </group>
          )}
          {showGroundBase && (
            <SoftGroundDisc y={floorY} color={project.gradientColors?.edge ?? '#090b0e'} />
          )}
          <SceneProps props={project.sceneProps ?? []} />
          <SceneDevices
            project={project}
            gizmoMode={gizmoMode}
            mediaPlaying={mediaPlaying}
            liveStream={liveStream}
            liveStreamDeviceId={liveStreamDeviceId}
            gizmoActive={gizmoActive && !lightGizmoActive}
            onSelectDevice={onSelectDevice}
            onHoverDevice={onHoverDevice}
            onDragTargetDevice={onDragTargetDevice}
            onDeviceContextMenu={onDeviceContextMenu}
            onRotateDevice={onRotateDevice}
            onMoveDevice={onMoveDevice}
            onGizmoDraggingChange={onGizmoDraggingChange}
            screenDropDeviceId={screenDropDeviceId}
          />
          <SceneReady onReady={onSceneReady} />
          {project.background !== 'transparent' && (project.shadowOpacity ?? 0.32) > 0.01 && (
            <ContactShadows
              key={`contact-shadow-${canvasId}`}
              frames={Infinity}
              position={[0, floorY + 0.012, studioSet ? 0.15 : 0]}
              opacity={studioSet ? Math.min(0.34, (project.shadowOpacity ?? 0.32) * 0.9) : Math.min(0.26, (project.shadowOpacity ?? 0.32) * 0.8)}
              scale={studioSet ? 9 : 8}
              blur={Math.max(5.2, (project.shadowSoftness ?? 2.5) * 1.8)}
              far={studioSet ? 7 : 6}
              color="#12141a"
            />
          )}
        </Suspense>
      </SceneEnvironment>
      <CameraRig
        view={project.cameraView}
        lens={project.cameraLens ?? 'standard'}
        split={project.compositionMode === 'split'}
        animatedPosition={cameraPosition}
        sharedOrbit={sharedOrbit}
        onSharedOrbitChange={onSharedOrbitChange}
        focusPoint={resolvedFocus}
        recenterToken={recenterToken}
        onSpacePanDrag={onSpacePanDrag}
      />
      <CaptureBridge
        captureRef={captureRef}
        edgeBlurTop={project.edgeBlurTop ?? false}
        edgeBlurBottom={project.edgeBlurBottom ?? false}
        edgeBlurAmount={project.edgeBlurAmount ?? 24}
      />
    </Canvas>
  );
}

useGLTF.preload('./models/iphone_15_pro_max.glb');
useGLTF.preload('./models/iphone_16_pro_max.glb');
useGLTF.preload('./models/iphone_17_pro.glb');
useGLTF.preload('./models/iphone_17_pro_max.glb');
useGLTF.preload('./models/pixel_9.glb');
useGLTF.preload('./models/pixel_9_pro.glb');
useGLTF.preload('./models/pixel_9_pro_xl.glb');
useGLTF.preload('./models/pixel_10_pro.glb');
useGLTF.preload('./models/galaxy_s26_ultra.glb');
