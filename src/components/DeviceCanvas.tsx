import {
  Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getDevice, type DeviceUv } from '../lib/devices';
import { applyProgressiveEdgeBlur } from '../lib/edgeBlur';
import { useScreenEmissiveMap } from '../lib/useScreenTexture';
import ProceduralDevice from './ProceduralDevice';
import RotationBall, { type GizmoMode } from './RotationBall';
import SceneProps from './SceneProps';
import {
  DEVICE_COLORS, cameraLensFov,
  type BackgroundPreset, type CameraLens, type CameraView, type DeviceColor, type DeviceInstance,
  type GradientColors, type MockupProject, type Vec3,
} from '../types';

const SceneEnvMapContext = createContext<THREE.Texture | null>(null);

export type CaptureApi = {
  toPng: (width: number, height: number) => Promise<string>;
  toImage: (width: number, height: number, mime?: 'image/png' | 'image/webp', quality?: number) => Promise<string>;
  drawFrame: (width: number, height: number, dest: CanvasRenderingContext2D) => void;
};

/** @deprecated Prefer CaptureApi */
export type CaptureFunction = CaptureApi;

export interface DeviceSelectPayload {
  id: string;
  clientX: number;
  clientY: number;
}

interface Props {
  project: MockupProject;
  captureRef: MutableRefObject<CaptureApi | null>;
  gizmoMode?: GizmoMode;
  /** Preview playback — keeps screen videos moving with the timeline */
  mediaPlaying?: boolean;
  /** Live USB iPhone/iPad mirror stream painted onto device screens */
  liveStream?: MediaStream | null;
  /** Evaluated camera position when camera tracks are active */
  cameraPosition?: Vec3 | null;
  onSelectDevice?: (payload: DeviceSelectPayload) => void;
  onClearSelection?: () => void;
  onRotateDevice?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveDevice?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onGizmoDraggingChange?: (dragging: boolean) => void;
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
        standard.metalness = Math.max(0.55, standard.metalness ?? 0.7);
        standard.roughness = Math.min(0.45, standard.roughness ?? 0.35);
        standard.envMapIntensity = Math.max(0.6, standard.envMapIntensity ?? 1);
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
  if (/glass|gloss|crystal|lens|sapphire|transparent/.test(lower)) return true;
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
      const thinCover = /screen\s*glass|lensinglass|camglass|cam.?glass|camera.?glass|sapphire|glass\.00|base_glass(?!_black)/.test(lower)
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
}: {
  url: string;
  deviceId: string;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  glassReflection: number;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
}) {
  const device = getDevice(deviceId);
  const { scene, animations } = useGLTF(url);
  const root = useMemo(() => {
    const hasSkin = Boolean(scene.getObjectByProperty('isSkinnedMesh', true));
    const cloned = (hasSkin ? cloneSkinned(scene) : scene.clone(true)) as THREE.Object3D;
    const map = new Map<THREE.Material, THREE.Material>();
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
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
    poseOpenAnimation(cloned, animations);
    return cloned;
  }, [scene, animations]);
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

  return <primitive object={root} />;
}

function DeviceModelView({
  instance,
  screenshot,
  liveStream,
  selected,
  onSelect,
  onGizmoObject,
  gizmoDraggingRef,
  deviceColor,
  clayMode,
  mediaPlaying,
}: {
  instance: DeviceInstance;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  selected: boolean;
  onSelect?: (payload: DeviceSelectPayload) => void;
  onGizmoObject?: (object: THREE.Object3D | null) => void;
  gizmoDraggingRef: MutableRefObject<boolean>;
  deviceColor: DeviceColor;
  clayMode: boolean;
  mediaPlaying?: boolean;
}) {
  const device = getDevice(instance.deviceId);
  const groupRef = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0, moved: false });

  const radians = (d: number) => (d * Math.PI) / 180;

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    // While the gizmo is dragging, TransformControls owns the pose — don't fight it.
    if (gizmoDraggingRef.current) {
      group.scale.setScalar(instance.scale ?? 1);
      return;
    }
    const rot = instance.rotation ?? { x: 0, y: 0, z: 0 };
    const pos = instance.position ?? { x: 0, y: 0, z: 0 };
    group.rotation.set(radians(rot.x), radians(rot.y), radians(rot.z));
    group.position.set(pos.x, pos.y, pos.z);
    group.scale.setScalar(instance.scale ?? 1);
  }, [instance.rotation.x, instance.rotation.y, instance.rotation.z, instance.position?.x, instance.position?.y, instance.position?.z, instance.scale, gizmoDraggingRef]);

  useEffect(() => {
    if (!selected) return undefined;
    onGizmoObject?.(groupRef.current);
    return () => onGizmoObject?.(null);
  }, [selected, onGizmoObject, instance.id]);

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
      ref={groupRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onClick={onClick}
    >
      {device.kind === 'procedural' ? (
        <ProceduralDevice
          device={device}
          screenshot={screenshot}
          liveStream={liveStream}
          finishHex={(DEVICE_COLORS.find((c) => c.id === deviceColor) ?? DEVICE_COLORS[0]).hex}
          clayMode={clayMode}
          mediaPlaying={mediaPlaying}
        />
      ) : device.url ? (
        <GltfDeviceContent
          key={`${device.url}|${device.screenMat}|${device.rot.join(',')}|${device.uv.mirrorX ? 1 : 0}|${device.screenSize.width}x${device.screenSize.height}`}
          url={device.url}
          deviceId={device.id}
          screenshot={screenshot}
          liveStream={liveStream}
          glassReflection={instance.glassReflection ?? 0.55}
          deviceColor={deviceColor}
          clayMode={clayMode}
          mediaPlaying={mediaPlaying}
        />
      ) : null}
    </group>
  );
}

function backgroundTexture(
  preset: Exclude<BackgroundPreset, 'transparent'>,
  colors?: GradientColors | null,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not render background');
  const gradient = context.createRadialGradient(390, 330, 30, 520, 520, 900);
  if (colors) {
    gradient.addColorStop(0, colors.center);
    gradient.addColorStop(0.5, colors.mid);
    gradient.addColorStop(1, colors.edge);
  } else if (preset === 'midnight') {
    gradient.addColorStop(0, '#363e49');
    gradient.addColorStop(0.45, '#1d232b');
    gradient.addColorStop(1, '#0d1016');
  } else if (preset === 'studio') {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.55, '#f7f7f5');
    gradient.addColorStop(1, '#ecece8');
  } else if (preset === 'mint') {
    gradient.addColorStop(0, '#487e6c');
    gradient.addColorStop(0.44, '#18463c');
    gradient.addColorStop(1, '#071916');
  } else {
    gradient.addColorStop(0, '#c07a9d');
    gradient.addColorStop(0.43, '#5c456e');
    gradient.addColorStop(1, '#191428');
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1024, 1024);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Background({
  preset,
  colors,
}: {
  preset: BackgroundPreset;
  colors?: GradientColors | null;
}) {
  const { scene, gl } = useThree();
  const colorKey = colors ? `${colors.center}-${colors.mid}-${colors.edge}` : '';
  useEffect(() => {
    if (preset === 'transparent') {
      scene.background = null;
      gl.setClearColor('#16191f', 0);
      return () => {
        gl.setClearColor('#16191f', 1);
      };
    }
    gl.setClearColor('#16191f', 1);
    const texture = backgroundTexture(preset, colors);
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = null;
      texture.dispose();
    };
  }, [scene, gl, preset, colorKey, colors]);
  return null;
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
        (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 1.25;
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

function CameraRig({
  view,
  lens,
  split,
  animatedPosition,
}: {
  view: CameraView;
  lens: CameraLens;
  split: boolean;
  animatedPosition?: Vec3 | null;
}) {
  const { camera, gl } = useThree();
  const controls = useRef<any>(null);
  const [spacePan, setSpacePan] = useState(false);
  const fov = cameraLensFov(lens);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, fov]);

  useEffect(() => {
    if (animatedPosition) {
      camera.position.set(animatedPosition.x, animatedPosition.y, animatedPosition.z);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      controls.current?.target.set(0, 0, 0);
      controls.current?.update();
      return;
    }
    const z = split ? 7.4 : 5.7;
    const positions: Record<CameraView, [number, number, number]> = {
      front: [0, 0, z],
      left: [split ? -3.4 : -2.7, 0.1, split ? 6.6 : 5.1],
      right: [split ? 3.4 : 2.7, 0.1, split ? 6.6 : 5.1],
      top: [0, split ? 2.6 : 2.2, split ? 6.8 : 5.4],
    };
    camera.position.set(...positions[view]);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [view, camera, split, animatedPosition?.x, animatedPosition?.y, animatedPosition?.z]);

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
    const onPointerDown = () => { if (spacePan) el.style.cursor = 'grabbing'; };
    const onPointerUp = () => { el.style.cursor = spacePan ? 'grab' : ''; };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl, spacePan]);

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
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI - 0.2}
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

    captureRef.current = {
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
  onSelectDevice,
  onRotateDevice,
  onMoveDevice,
  onGizmoDraggingChange,
}: {
  project: MockupProject;
  gizmoMode: GizmoMode;
  mediaPlaying?: boolean;
  liveStream?: MediaStream | null;
  onSelectDevice?: (payload: DeviceSelectPayload) => void;
  onRotateDevice?: (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMoveDevice?: (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onGizmoDraggingChange?: (dragging: boolean) => void;
}) {
  const [gizmoObject, setGizmoObject] = useState<THREE.Object3D | null>(null);
  const gizmoDraggingRef = useRef(false);
  const selectedId = project.selectedDeviceId;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Stable callback — only the selected device may publish/clear the gizmo target.
  // (Inline per-device callbacks were clearing the gizmo when sibling devices updated.)
  const bindGizmoObject = useCallback((deviceId: string, object: THREE.Object3D | null) => {
    if (deviceId !== selectedIdRef.current) return;
    setGizmoObject(object);
  }, []);

  useEffect(() => {
    // Selection changed — drop stale object until the new device publishes.
    setGizmoObject(null);
  }, [selectedId]);

  return (
    <>
      {project.devices.map((instance) => (
        <DeviceModelView
          key={`${instance.id}-${instance.deviceId}`}
          instance={instance}
          screenshot={project.screenshot}
          liveStream={liveStream}
          selected={instance.id === selectedId}
          onSelect={onSelectDevice}
          gizmoDraggingRef={gizmoDraggingRef}
          onGizmoObject={(object) => bindGizmoObject(instance.id, object)}
          deviceColor={project.deviceColor}
          clayMode={project.clayMode || project.deviceColor === 'clay'}
          mediaPlaying={mediaPlaying}
        />
      ))}
      <RotationBall
        key={`gizmo-${selectedId}`}
        object={gizmoObject}
        active={Boolean(selectedId && gizmoObject)}
        mode={gizmoMode}
        onDraggingChange={(dragging) => {
          gizmoDraggingRef.current = dragging;
          onGizmoDraggingChange?.(dragging);
        }}
        onRotate={(rotation) => {
          if (!selectedId) return;
          // Commit-only: RotationBall only fires rotate on pointer-up.
          onRotateDevice?.(selectedId, rotation, { recordKeys: true });
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
  cameraPosition = null,
  onSelectDevice,
  onClearSelection,
  onRotateDevice,
  onMoveDevice,
  onGizmoDraggingChange,
}: Props) {
  const hasStudioBackdrop = Boolean(project.sceneProps?.some((p) => p.kind === 'studio_backdrop'));
  const floorY = hasStudioBackdrop ? -1.55 : -1.63;

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 5.7], fov: 38, near: 0.1, far: 100 }}
      style={{ width: '100%', height: '100%', background: '#16191f', display: 'block' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#16191f', 1);
      }}
      onPointerMissed={() => onClearSelection?.()}
    >
      <Background
        preset={project.background}
        colors={project.background === 'transparent' ? null : project.gradientColors}
      />
      <ambientLight intensity={(project.fillIntensity ?? 0.7) * (hasStudioBackdrop ? 1.05 : 0.8)} />
      <hemisphereLight
        args={[
          hasStudioBackdrop ? '#ffffff' : '#f3f8ff',
          hasStudioBackdrop ? '#f0f0ee' : '#42434a',
          (project.fillIntensity ?? 0.7) * (hasStudioBackdrop ? 0.7 : 0.95),
        ]}
      />
      <directionalLight
        position={hasStudioBackdrop ? [2.8, 6.2, 4.2] : [4, 5, 7]}
        intensity={project.lightIntensity * (hasStudioBackdrop ? 0.72 : 0.85)}
        // Soft contact shadow handles the “floating” look on white studio;
        // directional shadow maps stripe badly on large flat white surfaces.
        castShadow={!hasStudioBackdrop}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={Math.max(1, (project.shadowSoftness ?? 2.5) * 1.6)}
        shadow-bias={-0.00025}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={24}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight
        position={hasStudioBackdrop ? [-3.5, 3.5, 2.5] : [-4, 1, -5]}
        color={hasStudioBackdrop ? '#ffffff' : '#a3d4da'}
        intensity={hasStudioBackdrop ? 0.85 + (project.fillIntensity ?? 0.7) * 0.35 : 0.55 + (project.fillIntensity ?? 0.7) * 0.9}
      />
      <SceneEnvironment
        reflectionMap={project.reflectionMap ?? 'match_background'}
        reflectionMapImage={project.reflectionMapImage ?? null}
        background={project.background}
        colors={project.background === 'transparent' ? null : project.gradientColors}
      >
        <Suspense fallback={<LoadingFallback />}>
          <SceneProps props={project.sceneProps ?? []} />
          <SceneDevices
            project={project}
            gizmoMode={gizmoMode}
            mediaPlaying={mediaPlaying}
            liveStream={liveStream}
            onSelectDevice={onSelectDevice}
            onRotateDevice={onRotateDevice}
            onMoveDevice={onMoveDevice}
            onGizmoDraggingChange={onGizmoDraggingChange}
          />
        </Suspense>
      </SceneEnvironment>
      {project.background !== 'transparent' && (project.shadowOpacity ?? 0.32) > 0.01 && (
        <ContactShadows
          position={[0, floorY + 0.01, hasStudioBackdrop ? 0.35 : 0]}
          opacity={hasStudioBackdrop ? Math.min(0.55, (project.shadowOpacity ?? 0.32) + 0.12) : (project.shadowOpacity ?? 0.32)}
          scale={hasStudioBackdrop ? 8 : (project.sceneProps?.length ? 7.5 : 5.5)}
          blur={hasStudioBackdrop ? Math.max(3.2, project.shadowSoftness ?? 2.5) : (project.shadowSoftness ?? 2.5)}
          far={hasStudioBackdrop ? 6 : 5}
          color={hasStudioBackdrop ? '#1a1a1a' : '#000000'}
        />
      )}
      <CameraRig
        view={project.cameraView}
        lens={project.cameraLens ?? 'standard'}
        split={project.compositionMode === 'split'}
        animatedPosition={cameraPosition}
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
useGLTF.preload('./models/iphone_duo.glb');
useGLTF.preload('./models/pixel_9.glb');
useGLTF.preload('./models/pixel_9_pro.glb');
useGLTF.preload('./models/pixel_9_pro_xl.glb');
useGLTF.preload('./models/pixel_10_pro.glb');
useGLTF.preload('./models/galaxy_s25_ultra.glb');
