import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  createNeutralStudioEnvironment,
  setAmbientOcclusion,
  setDepthOfField,
} from '../lib/renderRealism';
import {
  resolveStudioPreset,
  STUDIO_FLOOR_Y,
  type StudioPreset,
} from '../lib/studioEnvironment';
import {
  collectCasterBounds,
  distanceToContactFar,
  fitDirectionalShadowCamera,
  opacityToShadowStrength,
  resolveFloorShadowResolution,
  shadowIntensityCurve,
  softnessToPenumbra,
  DEFAULT_SHADOW_COLOR,
  SHADOW_SOFTNESS_MAX,
  STUDIO_SHADOW_IDLE_MS,
  type StudioShadowApi,
  type StudioShadowMode,
} from '../lib/studioShadows';
import { CycloramaBackdrop, type CycloramaContactPoint } from './SceneProps';
import type {
  BackgroundPreset,
  GradientColors,
  ShadowQuality,
  ShadowType,
  Vec3,
} from '../types';

let rectAreaReady = false;
function ensureRectAreaLights() {
  if (rectAreaReady) return;
  RectAreaLightUniformsLib.init();
  rectAreaReady = true;
}

/** Softbox that aims at the product. Rect area lights do not cast shadows. */
function Softbox({
  position,
  size,
  color,
  intensity,
  target,
}: {
  position: Vec3;
  size: [number, number];
  color: string;
  intensity: number;
  target: Vec3;
}) {
  const lightRef = useRef<THREE.RectAreaLight>(null);
  useLayoutEffect(() => {
    ensureRectAreaLights();
    const light = lightRef.current;
    if (!light) return;
    light.position.set(position.x, position.y, position.z);
    light.lookAt(target.x, target.y, target.z);
  }, [position.x, position.y, position.z, target.x, target.y, target.z]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    if (Math.abs(light.intensity - intensity) > 1e-6) light.intensity = intensity;
  });

  if (intensity <= 0.001) return null;
  return (
    <rectAreaLight
      ref={lightRef}
      position={[position.x, position.y, position.z]}
      width={size[0]}
      height={size[1]}
      color={color}
      intensity={intensity}
    />
  );
}

/** Always-on neutral studio HDRI — reflections stay photographic even on transparent BG. */
export function StudioHdri({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const environment = createNeutralStudioEnvironment(gl);
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    scene.environment = environment.texture;
    scene.environmentIntensity = intensity;
    return () => {
      if (scene.environment === environment.texture) {
        scene.environment = previous;
        scene.environmentIntensity = previousIntensity;
      }
      environment.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

/** Sync ACES exposure to the active studio look. */
export function StudioExposure({ exposure }: { exposure: number }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

/** Screen-space AO. Amount 0 skips the pass. */
export function StudioAmbientOcclusion({ amount }: { amount: number }) {
  const gl = useThree((state) => state.gl);
  const amountRef = useRef(amount);
  amountRef.current = amount;
  useFrame(() => {
    setAmbientOcclusion(gl, amountRef.current);
  });
  return null;
}

/** Focus stays on the selected device. Amount 0 leaves the frame sharp. */
export function StudioDepthOfField({ amount, focus }: { amount: number; focus: Vec3 }) {
  const gl = useThree((state) => state.gl);
  const amountRef = useRef(amount);
  const focusRef = useRef(focus);
  amountRef.current = amount;
  focusRef.current = focus;
  useFrame(() => {
    setDepthOfField(gl, {
      amount: amountRef.current,
      focus: focusRef.current,
    });
  });
  return null;
}

/** Layer 2 = floor helpers. Shadow camera stays on 0 so these never fill the contact map. */
const FLOOR_HELPER_LAYER = 2;

/**
 * Very subtle ground tint for non-cyclorama sets when shadows are off.
 * When soft floor shadows are active this disc is skipped — it was reading as
 * a dark circular blob under the product.
 */
function SoftGroundDisc({
  y,
  color,
  onSelect,
}: {
  y: number;
  color: string;
  onSelect?: () => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    mesh.current?.layers.set(FLOOR_HELPER_LAYER);
  }, []);
  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      receiveShadow={false}
      userData={{ orbitPickFloor: true }}
      onClick={(event) => {
        if (event.delta > 8) return;
        event.stopPropagation();
        onSelect?.();
      }}
    >
      <circleGeometry args={[3.2, 64]} />
      <meshStandardMaterial
        color={color}
        roughness={1}
        metalness={0}
        transparent
        opacity={0.1}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/**
 * Large invisible floor used only for pointer hit tests. Empty-canvas drags
 * need something closer than the far side of the gimbal rings, or orbit dies.
 * A clean tap (no drag) opens Floor colour in the Look side panel.
 */
function OrbitPickFloor({
  y,
  onSelect,
}: {
  y: number;
  onSelect?: () => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    mesh.current?.layers.set(FLOOR_HELPER_LAYER);
  }, []);
  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      userData={{ orbitPickFloor: true }}
      renderOrder={-2}
      onClick={(event) => {
        // Devices / props / backdrop wall sit closer and win first.
        // Do not stop pointerdown — empty-canvas drag still orbits.
        if (event.delta > 8) return;
        event.stopPropagation();
        onSelect?.();
      }}
    >
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        colorWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Floor receiver for the key light's progressive (PCSS) cast. Invisible except
 * where shadowed, so the contact-hardening silhouette lands on every look —
 * empty stage, gradient, cyclorama, or transparent export — without a visible plate.
 */
function StudioShadowCatcher({
  y,
  size,
  opacity,
  color,
}: {
  y: number;
  size: number;
  opacity: number;
  color: string;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    // Layer 1: main camera sees it (PCSS), ContactShadows camera (layer 0) does not —
    // otherwise this plane floods the contact map with a dark rectangle.
    target.layers.set(1);
    // Never a pointer target: orbit, grab, and selection keep using OrbitPickFloor.
    target.raycast = () => null;
  }, []);
  if (opacity < 0.004) return null;
  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y + 0.0008, 0]}
      receiveShadow
      castShadow={false}
      renderOrder={1}
      layers={1}
      userData={{ studioShadowCatcher: true, contactShadowPlane: true }}
    >
      <planeGeometry args={[size, size]} />
      <shadowMaterial
        transparent
        opacity={opacity}
        color={color}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Map size helper kept for older call sites / thumbnails. */
export function resolveShadowMapSize(
  quality: ShadowQuality,
  _dpr: number,
  exportBoost = false,
): number {
  if (exportBoost || quality === 'ultra') return 2048;
  if (quality === 'high') return 1536;
  return 1024;
}

type ShadowInteractionApi = {
  /** Mark the viewport as busy (gizmo / orbit / light / scrub). */
  setBusy: (busy: boolean) => void;
  /** Bump whenever scene geometry or lighting that affects shadows changes. */
  notifySceneChanged: () => void;
  apiRef: MutableRefObject<StudioShadowApi | null>;
  mode: StudioShadowMode;
};

const ShadowInteractionContext = createContext<ShadowInteractionApi | null>(null);

export function useStudioShadowInteraction(): ShadowInteractionApi | null {
  return useContext(ShadowInteractionContext);
}

/**
 * Tracks interactive vs studio shadow mode with a short idle delay so the
 * floor plate can progressively refine without jumping.
 */
export function StudioShadowInteractionProvider({
  exportBoost = false,
  busyExternal = false,
  children,
}: {
  exportBoost?: boolean;
  /** True while gizmos, orbit, light moves, or playback scrubbing are active. */
  busyExternal?: boolean;
  children: ReactNode;
}) {
  const apiRef = useRef<StudioShadowApi | null>(null);
  const [busyInternal, setBusyInternal] = useState(false);
  const [mode, setMode] = useState<StudioShadowMode>('studio');
  const idleTimer = useRef<number | null>(null);

  const setBusy = useCallback((busy: boolean) => {
    setBusyInternal(busy);
  }, []);

  const notifySceneChanged = useCallback(() => {
    apiRef.current?.reset();
  }, []);

  const effectivelyBusy = busyExternal || busyInternal;
  const wasBusy = useRef(effectivelyBusy);

  useEffect(() => {
    if (exportBoost) {
      if (idleTimer.current != null) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      setMode('studio');
      return;
    }
    if (effectivelyBusy) {
      if (idleTimer.current != null) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      setMode('interactive');
      wasBusy.current = true;
      return;
    }
    // Interaction just ended — clear stale progressive buffers before refining.
    if (wasBusy.current) {
      apiRef.current?.reset();
      wasBusy.current = false;
    }
    idleTimer.current = window.setTimeout(() => {
      setMode('studio');
      idleTimer.current = null;
    }, STUDIO_SHADOW_IDLE_MS);
    return () => {
      if (idleTimer.current != null) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };
  }, [effectivelyBusy, exportBoost]);

  const value = useMemo<ShadowInteractionApi>(() => ({
    setBusy,
    notifySceneChanged,
    apiRef,
    mode: exportBoost ? 'studio' : mode,
  }), [setBusy, notifySceneChanged, mode, exportBoost]);

  return (
    <ShadowInteractionContext.Provider value={value}>
      {children}
    </ShadowInteractionContext.Provider>
  );
}

/**
 * Adaptive world extent for the floor shadow plate — tight around casters so
 * texel density stays high (avoids blocky / square shadow artefacts).
 */
function useAdaptiveShadowExtent(
  lightPosition: Vec3,
  lightTarget: Vec3,
  floorY: number,
  fallback = 5.5,
): number {
  const scene = useThree((s) => s.scene);
  const bounds = useRef(new THREE.Box3());
  const [extent, setExtent] = useState(fallback);
  const frame = useRef(0);
  const lightKey = `${lightPosition.x.toFixed(2)}:${lightPosition.y.toFixed(2)}:${lightPosition.z.toFixed(2)}:${lightTarget.x.toFixed(2)}:${lightTarget.z.toFixed(2)}`;

  useFrame(() => {
    frame.current += 1;
    // Refit a few times a second — enough for rotate/scale without React thrash.
    if (frame.current % 8 !== 0) return;
    collectCasterBounds(scene, bounds.current);
    if (bounds.current.isEmpty()) {
      if (Math.abs(extent - fallback) > 0.2) setExtent(fallback);
      return;
    }
    const fitted = fitDirectionalShadowCamera(
      lightPosition,
      lightTarget,
      bounds.current,
      floorY,
      { padding: 1.45, minExtent: 2.2, maxExtent: 16 },
    );
    if (!fitted) return;
    const next = THREE.MathUtils.clamp(fitted.halfExtent * 2.15, 3.2, 16);
    if (Math.abs(next - extent) > 0.4) setExtent(next);
  });

  // Light moves should nudge extent immediately.
  useEffect(() => {
    collectCasterBounds(scene, bounds.current);
    if (bounds.current.isEmpty()) return;
    const fitted = fitDirectionalShadowCamera(
      lightPosition,
      lightTarget,
      bounds.current,
      floorY,
      { padding: 1.45, minExtent: 2.2, maxExtent: 16 },
    );
    if (!fitted) return;
    setExtent(THREE.MathUtils.clamp(fitted.halfExtent * 2.15, 3.2, 16));
  }, [lightKey, floorY, scene, lightPosition, lightTarget]);

  return extent;
}

/**
 * Soft floor shadows via ContactShadows only.
 *
 * AccumulativeShadows / ProgressiveLightMap was removed: its bake path zeroes
 * every scene light and can permanently restore intensity=0 if reset() races
 * mid-bake — that made the whole app go dark.
 *
 * Interactive (orbit / gizmo / playback): continuous plate so the foot tracks motion.
 * Studio idle / export: bake once (`frames={1}`) and freeze — remount via refreshToken
 * when lighting or casters change. Infinity-while-idle was the main idle GPU cost.
 */
function StudioSoftFloorShadows({
  y,
  opacity,
  softness,
  contact,
  contactEnabled = true,
  distance,
  quality,
  exportBoost = false,
  lightPosition,
  lightTarget,
  lightStrength,
  color = DEFAULT_SHADOW_COLOR,
  onPaper = false,
}: {
  y: number;
  opacity: number;
  softness: number;
  contact: number;
  contactEnabled?: boolean;
  distance: number;
  quality: ShadowQuality;
  exportBoost?: boolean;
  lightPosition: Vec3;
  lightTarget: Vec3;
  lightStrength: number;
  color?: string;
  /** Cyclorama / studio_backdrop — lift + polygon-offset so the plate does not stripe the paper. */
  onPaper?: boolean;
}) {
  const interaction = useStudioShadowInteraction();
  const mode: StudioShadowMode = exportBoost ? 'studio' : (interaction?.mode ?? 'studio');
  const gl = useThree((s) => s.gl);
  const maxTex = gl.capabilities.maxTextureSize || 4096;
  const scale = useAdaptiveShadowExtent(lightPosition, lightTarget, y, 6);
  const penumbra = softnessToPenumbra(softness);
  const strength = opacityToShadowStrength(opacity, 1);
  const resolution = resolveFloorShadowResolution(quality, mode, exportBoost, maxTex);
  const [refreshToken, setRefreshToken] = useState(0);
  // Live while the viewport is moving (orbit, gizmos, playback) and during export
  // so stills / video pick up the current pose. Idle studio bakes once.
  const frames = mode === 'interactive' || exportBoost ? Infinity : 1;

  const groupRef = useRef<THREE.Group>(null);
  const lightFade = THREE.MathUtils.clamp(0.75 + lightStrength * 0.18, 0.7, 1);
  const paperFade = onPaper ? 0.72 : 1;
  const primaryOpacity = Math.min(
    0.68,
    strength.contactPrimary * lightFade * paperFade,
  );
  const accentOpacity = contactEnabled
    ? Math.min(
      0.5,
      strength.contactAccent * lightFade * (0.4 + THREE.MathUtils.clamp(contact, 0, 1) * 0.85),
    )
    : 0;
  const contactFar = distanceToContactFar(distance);
  // drei ContactShadows: width/height are multiplied by scale — keep width=1.
  const blur = mode === 'studio'
    ? Math.max(0.55, penumbra.contactBlur * 0.9)
    : Math.max(0.45, penumbra.contactBlur * 0.72);

  const reset = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const settle = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!interaction) return;
    const api: StudioShadowApi = {
      reset,
      settle: () => settle(),
      getMode: () => mode,
    };
    interaction.apiRef.current = api;
    return () => {
      if (interaction.apiRef.current === api) interaction.apiRef.current = null;
    };
  }, [interaction, mode, reset, settle]);

  useEffect(() => {
    reset();
  }, [
    reset,
    lightPosition.x, lightPosition.y, lightPosition.z,
    lightTarget.x, lightTarget.y, lightTarget.z,
    softness, opacity, contact, contactEnabled, distance, quality, scale, exportBoost, lightStrength, color, mode,
  ]);

  useLayoutEffect(() => {
    const root = groupRef.current;
    if (!root) return;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of list) {
        if (!mat) continue;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -8;
        mat.depthWrite = false;
      }
    });
  }, [refreshToken, onPaper]);

  if (!contactEnabled || primaryOpacity < 0.02) return null;

  return (
    <group ref={groupRef} position={[0, y + (onPaper ? 0.004 : 0.001), 0]}>
      <ContactShadows
        key={`floor-${mode}-${resolution}-${refreshToken}`}
        frames={frames}
        opacity={primaryOpacity}
        width={1}
        height={1}
        blur={blur}
        far={contactFar}
        resolution={resolution}
        color={color}
        smooth
        scale={scale}
      />
      {accentOpacity > 0.05 && contact > 0.04 && mode === 'studio' && (
        <ContactShadows
          key={`feet-${resolution}-${refreshToken}`}
          frames={exportBoost ? Infinity : 1}
          opacity={accentOpacity}
          width={1}
          height={1}
          blur={Math.max(0.28, blur * 0.38)}
          far={Math.min(1.7, contactFar * 0.38)}
          resolution={Math.min(1024, resolution)}
          color={color}
          smooth
          scale={scale * 0.92}
        />
      )}
    </group>
  );
}

/**
 * Safety net: a prior AccumulativeShadows bake can leave lights at intensity 0.
 * Remember last known-good intensities and restore if something zeroes them.
 */
function StudioLightRecovery() {
  const scene = useThree((s) => s.scene);
  const remembered = useRef(new Map<string, number>());

  useFrame(() => {
    scene.traverse((obj) => {
      const light = obj as THREE.Light & { isLight?: boolean };
      if (!light.isLight) return;
      // Ignore helper / bake-only lights under hidden groups.
      if (light.parent && light.parent.visible === false) return;
      const id = light.uuid;
      if (light.intensity > 0.0001) {
        remembered.current.set(id, light.intensity);
        return;
      }
      const prev = remembered.current.get(id);
      if (prev != null && prev > 0.0001) light.intensity = prev;
    });
  });

  return null;
}

export interface StudioLightingProps {
  preset: StudioPreset;
  keyPosition: Vec3;
  keyColor: string;
  keyIntensity: number;
  fillIntensity: number;
  shadowSoftness: number;
  shadowOpacity: number;
  shadowType: ShadowType;
  shadowContact: number;
  shadowContactEnabled?: boolean;
  shadowDistance?: number;
  shadowColor?: string;
  shadowQuality: ShadowQuality;
  /** Force Ultra map size / bake while exporting. */
  shadowExportBoost?: boolean;
  showGroundBase: boolean;
  hasStudioBackdropProp: boolean;
  /** Pedestals / slabs / stages that can receive contact without a ground disc. */
  hasShadowReceiverProp?: boolean;
  background: BackgroundPreset;
  gradientColors: GradientColors | null;
  focus: Vec3;
  canvasId: string;
  /** Built-in cyclorama is selected — colour controls + paper highlight. */
  backdropSelected?: boolean;
  onSelectBackdrop?: () => void;
  /** Tap empty floor plane → Floor colour in the Look side panel. */
  onSelectFloor?: () => void;
  /** Degrees around Y — turns the paper wall to face Left / Right / Front. */
  backdropYaw?: number;
  /** Device footprints for soft contact that climbs the cyclorama cove. */
  contactPoints?: CycloramaContactPoint[];
  /** When true, show the key-light directional gizmo path via children / parent. */
  children?: ReactNode;
}

/**
 * Spline-like studio lighting + photoreal floor shadows.
 * Ambient / hemi wrap first; quiet softboxes for speculars; directional key for shape.
 * Soft floor mark comes from AccumulativeShadows (studio) / ContactShadows (interactive).
 */
export function StudioLighting({
  preset,
  keyPosition,
  keyColor,
  keyIntensity,
  fillIntensity,
  shadowSoftness,
  shadowOpacity,
  shadowType,
  shadowContact,
  shadowContactEnabled = true,
  shadowDistance = 3.6,
  shadowColor,
  shadowQuality,
  shadowExportBoost = false,
  showGroundBase,
  hasStudioBackdropProp,
  hasShadowReceiverProp = false,
  background,
  gradientColors,
  focus,
  canvasId: _canvasId,
  backdropSelected = false,
  onSelectBackdrop,
  onSelectFloor,
  backdropYaw = 0,
  contactPoints = [],
  children,
}: StudioLightingProps) {
  const showCyclorama = preset.showCyclorama
    && !hasStudioBackdropProp
    && background !== 'transparent';
  const studioSet = hasStudioBackdropProp || showCyclorama;
  const yawRad = (backdropYaw * Math.PI) / 180;
  const localContactPoints = useMemo(() => {
    if (!backdropYaw || contactPoints.length === 0) return contactPoints;
    const cos = Math.cos(-yawRad);
    const sin = Math.sin(-yawRad);
    return contactPoints.map((point) => ({
      ...point,
      x: point.x * cos - point.z * sin,
      z: point.x * sin + point.z * cos,
      yaw: (point.yaw ?? 0) - backdropYaw,
    }));
  }, [backdropYaw, contactPoints, yawRad]);
  /** Same floor for every look so fitted models always sit above a soft shadow. */
  const floorY = STUDIO_FLOOR_Y;
  const groundAllowed = showGroundBase
    && preset.showGroundDisc
    && background !== 'transparent'
    && !studioSet;

  // Shadows no longer wait for a visible receiver: the PCSS catcher below draws
  // the progressive cast on any look, so an empty stage still grounds the device.
  void hasShadowReceiverProp;
  const showFloorShadow = shadowType !== 'off' && shadowOpacity > 0.01;

  // Photographic balance: ambient / hemi wrap carry exposure; softboxes shape
  // speculars; KeyLightRig (children) is the gentle directional key + mesh shadows.
  const softKey = Math.max(0, keyIntensity) * preset.key.intensity * 0.32;
  const softFill = Math.max(0, fillIntensity) * preset.fill.intensity * 0.58;
  const softRim = Math.max(0, fillIntensity) * preset.rim.intensity * 0.44
    + Math.max(0, keyIntensity) * preset.rim.intensity * 0.08;
  const bounce = Math.max(0, fillIntensity) * preset.groundBounce.intensity * 0.7;
  const ambient = Math.max(0, fillIntensity) * preset.ambientScale;
  const hemi = Math.max(0, fillIntensity) * preset.hemisphere.intensityScale;

  // Intensity spans 0–2: 1 is the soft default, above 1 crushes soft cores darker.
  const shadowOpacityResolved = Math.max(0, shadowOpacity) * preset.shadow.opacityScale * (studioSet ? 1.12 : 1.0);
  const shadowBlur = Math.max(
    0.35,
    shadowSoftness * preset.shadow.blurScale,
  );
  const floorShadowColor = shadowColor || preset.shadow.color || DEFAULT_SHADOW_COLOR;
  const coveContactStrength = showCyclorama
    ? Math.min(1.4, shadowIntensityCurve(shadowOpacity, 0.7, 1.8) * preset.shadow.opacityScale * (0.5 + shadowContact * 0.5))
    : 0;
  const softComp = THREE.MathUtils.smoothstep(1.5, SHADOW_SOFTNESS_MAX, shadowSoftness);
  const catcherStrength = opacityToShadowStrength(shadowOpacityResolved, 1).catcher;
  const catcherOpacity = showFloorShadow
    ? THREE.MathUtils.clamp(catcherStrength * (1 + softComp * 0.4), 0, 0.78)
    : 0;
  // Paper needs a stronger stain than the invisible floor plate — white seamless
  // reads the overlay as the only directional cast.
  const paperShadowOpacity = showFloorShadow
    ? THREE.MathUtils.clamp(catcherStrength * (1.25 + softComp * 0.35), 0, 0.86)
    : 0;

  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const bounceRef = useRef<THREE.PointLight>(null);

  // Backdrop paper lives on layer 1 (skipped by ContactShadows). Wrap + bounce
  // must reach that layer or the cyclorama goes black once it receives shadows.
  useLayoutEffect(() => {
    ambientRef.current?.layers.enable(1);
    hemiRef.current?.layers.enable(1);
    bounceRef.current?.layers.enable(1);
  }, []);

  // Re-assert wrap lights every frame — shadow bakers must never leave them at 0.
  useFrame(() => {
    if (ambientRef.current && Math.abs(ambientRef.current.intensity - ambient) > 1e-6) {
      ambientRef.current.intensity = ambient;
    }
    if (hemiRef.current && Math.abs(hemiRef.current.intensity - hemi) > 1e-6) {
      hemiRef.current.intensity = hemi;
    }
    if (bounceRef.current && Math.abs(bounceRef.current.intensity - bounce) > 1e-6) {
      bounceRef.current.intensity = bounce;
    }
  });

  return (
    <>
      <StudioLightRecovery />
      <ambientLight ref={ambientRef} intensity={ambient} color="#ffffff" />
      <hemisphereLight
        ref={hemiRef}
        args={[preset.hemisphere.sky, preset.hemisphere.ground, hemi]}
      />
      {/* Quiet softboxes — specular shape only; not the primary exposure */}
      <Softbox
        position={keyPosition}
        size={[preset.key.size[0] * 1.08, preset.key.size[1] * 1.08]}
        color={keyColor || preset.key.color}
        intensity={softKey}
        target={focus}
      />
      <Softbox
        position={preset.fill.position}
        size={preset.fill.size}
        color={preset.fill.color}
        intensity={softFill}
        target={focus}
      />
      <Softbox
        position={preset.rim.position}
        size={preset.rim.size}
        color={preset.rim.color}
        intensity={softRim}
        target={focus}
      />
      {/* Soft floor bounce — lifts contact without flattening the key shadow */}
      <pointLight
        ref={bounceRef}
        position={[focus.x, floorY + 0.28, focus.z + 0.35]}
        color={preset.groundBounce.color}
        intensity={bounce}
        distance={5}
        decay={2}
      />
      {children}
      {showCyclorama && gradientColors && (
        <group position={[0, floorY, 0]} rotation={[0, yawRad, 0]}>
          <CycloramaBackdrop
            color={gradientColors.center}
            floor={gradientColors.edge}
            selected={backdropSelected}
            onSelect={onSelectBackdrop}
            contactPoints={localContactPoints}
            contactStrength={coveContactStrength}
            shadowOpacity={paperShadowOpacity}
            shadowColor={floorShadowColor}
          />
        </group>
      )}
      {/* Always present so dragging beside the device orbits instead of
          locking onto a farther gimbal ring through empty space. */}
      <OrbitPickFloor y={floorY} onSelect={onSelectFloor} />
      {/* Atmosphere disc only when soft shadows are off — avoids dark circular blobs. */}
      {groundAllowed && !showFloorShadow && (
        <SoftGroundDisc
          y={floorY}
          color={gradientColors?.edge ?? '#090b0e'}
          onSelect={onSelectFloor}
        />
      )}
      {/* Invisible catcher only when there is no paper cyclorama — otherwise the
          catcher + receiving backdrop stack as a hard tone seam / clipped edge. */}
      {showFloorShadow && !studioSet && (
        <StudioShadowCatcher
          y={floorY}
          size={22}
          opacity={catcherOpacity}
          color={floorShadowColor}
        />
      )}
      {showFloorShadow && shadowOpacityResolved > 0.01 && (
        <StudioSoftFloorShadows
          y={floorY}
          opacity={shadowOpacityResolved}
          softness={shadowBlur}
          contact={shadowContact}
          contactEnabled={shadowContactEnabled}
          distance={shadowDistance}
          quality={shadowQuality}
          exportBoost={shadowExportBoost}
          lightPosition={keyPosition}
          lightTarget={focus}
          lightStrength={keyIntensity}
          color={floorShadowColor}
          onPaper={studioSet}
        />
      )}
    </>
  );
}

/** Convenience: resolve preset + apply HDRI / exposure for a project background. */
export function useStudioPreset(
  background: BackgroundPreset,
  colors?: GradientColors | null,
): StudioPreset {
  const colorKey = colors ? `${colors.center}-${colors.mid}-${colors.edge}` : '';
  return useMemo(
    () => resolveStudioPreset(background, colors),
    [background, colorKey, colors],
  );
}
