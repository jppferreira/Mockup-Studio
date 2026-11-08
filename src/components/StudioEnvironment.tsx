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
  setDepthOfField,
} from '../lib/renderRealism';
import {
  resolveStudioPreset,
  STUDIO_FLOOR_Y,
  type StudioPreset,
} from '../lib/studioEnvironment';
import {
  collectCasterBounds,
  fitDirectionalShadowCamera,
  opacityToShadowStrength,
  resolveFloorShadowResolution,
  softnessToPenumbra,
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

/** Focus stays on the selected device. Amount 0 leaves the frame sharp. */
export function StudioDepthOfField({ amount, focus }: { amount: number; focus: Vec3 }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const amountRef = useRef(amount);
  const focusRef = useRef(focus);
  const point = useRef(new THREE.Vector3());
  amountRef.current = amount;
  focusRef.current = focus;
  useFrame(() => {
    const target = focusRef.current;
    point.current.set(target.x, target.y, target.z);
    const distance = camera.position.distanceTo(point.current);
    setDepthOfField(gl, {
      amount: amountRef.current,
      focusDistance: Math.max(camera.near + 0.05, distance),
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
function SoftGroundDisc({ y, color }: { y: number; color: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    mesh.current?.layers.set(FLOOR_HELPER_LAYER);
  }, []);
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow={false}>
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
 */
function OrbitPickFloor({ y }: { y: number }) {
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
 * Interactive: continuous low-cost contact plate.
 * Studio / export: higher-resolution contact with tighter feet + broader penumbra.
 */
function StudioSoftFloorShadows({
  y,
  opacity,
  softness,
  contact,
  quality,
  exportBoost = false,
  lightPosition,
  lightTarget,
  lightStrength,
  color = '#0b0d11',
}: {
  y: number;
  opacity: number;
  softness: number;
  contact: number;
  quality: ShadowQuality;
  exportBoost?: boolean;
  lightPosition: Vec3;
  lightTarget: Vec3;
  lightStrength: number;
  color?: string;
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

  const lightFade = THREE.MathUtils.clamp(0.7 + lightStrength * 0.2, 0.65, 1);
  // The key light's PCSS cast now carries the shadow shape; the contact plate is
  // only a light grounding kiss, so keep it well below the old plate strength
  // to avoid a uniformly fuzzy / double-dark base.
  const primaryOpacity = Math.min(
    0.4,
    (mode === 'studio' ? strength.accumulative : strength.contactPrimary) * lightFade * 0.55,
  );
  const accentOpacity = mode === 'studio'
    ? Math.min(
      0.28,
      strength.contactAccent * lightFade * (0.4 + THREE.MathUtils.clamp(contact, 0, 1) * 0.75),
    )
    : 0;
  const contactFar = THREE.MathUtils.clamp(
    THREE.MathUtils.lerp(3.4, 1.35, THREE.MathUtils.clamp(contact, 0, 1)),
    1.2,
    4,
  );
  // Tight plate: PCSS already widens the penumbra with height, so the contact
  // blur only needs to feather the foot. Studio stays a touch softer than interactive.
  const blur = mode === 'studio'
    ? Math.max(0.35, penumbra.contactBlur * 0.5)
    : Math.max(0.3, penumbra.contactBlur * 0.42);

  const reset = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const settle = useCallback(() => {
    // ContactShadows resolve in one depth pass — bump key so export gets a fresh plate.
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
    softness, opacity, contact, quality, scale, exportBoost, lightStrength, color, mode,
  ]);

  if (primaryOpacity < 0.012) return null;

  return (
    <group position={[0, y + 0.001, 0]}>
      <ContactShadows
        key={`floor-${mode}-${resolution}-${refreshToken}`}
        frames={mode === 'interactive' ? Infinity : (exportBoost ? 1 : Infinity)}
        opacity={primaryOpacity}
        width={scale}
        height={scale}
        blur={blur}
        far={contactFar}
        resolution={resolution}
        color={color}
        smooth
        scale={scale}
      />
      {accentOpacity > 0.04 && contact > 0.08 && (
        <ContactShadows
          key={`feet-${resolution}-${refreshToken}`}
          frames={1}
          opacity={accentOpacity}
          width={scale * 0.88}
          height={scale * 0.88}
          blur={Math.max(0.3, blur * 0.4)}
          far={Math.min(1.9, contactFar * 0.55)}
          resolution={Math.min(1024, resolution)}
          color={color}
          smooth
          scale={scale * 0.88}
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
  contactPoints = [],
  children,
}: StudioLightingProps) {
  const showCyclorama = preset.showCyclorama
    && !hasStudioBackdropProp
    && background !== 'transparent';
  const studioSet = hasStudioBackdropProp || showCyclorama;
  /** Same floor for every look so fitted models always sit above a soft shadow. */
  const floorY = STUDIO_FLOOR_Y;
  const groundAllowed = showGroundBase
    && preset.showGroundDisc
    && background !== 'transparent'
    && !studioSet;

  const hasReceiver = studioSet
    || groundAllowed
    || background === 'transparent'
    || hasShadowReceiverProp;

  /** Floor soft shadow only when a receiving surface (or transparent plate) exists. */
  const showFloorShadow = shadowType !== 'off'
    && shadowOpacity > 0.01
    && hasReceiver;

  // Photographic balance: ambient / hemi wrap carry exposure; softboxes shape
  // speculars; KeyLightRig (children) is the gentle directional key + mesh shadows.
  const softKey = Math.max(0, keyIntensity) * preset.key.intensity * 0.32;
  const softFill = Math.max(0, fillIntensity) * preset.fill.intensity * 0.58;
  const softRim = Math.max(0, fillIntensity) * preset.rim.intensity * 0.44
    + Math.max(0, keyIntensity) * preset.rim.intensity * 0.08;
  const bounce = Math.max(0, fillIntensity) * preset.groundBounce.intensity * 0.7;
  const ambient = Math.max(0, fillIntensity) * preset.ambientScale;
  const hemi = Math.max(0, fillIntensity) * preset.hemisphere.intensityScale;

  const shadowOpacityResolved = Math.min(
    studioSet ? 0.8 : 0.68,
    Math.max(0, shadowOpacity) * preset.shadow.opacityScale * (studioSet ? 1.12 : 1.0),
  );
  const shadowBlur = Math.max(
    0.35,
    shadowSoftness * preset.shadow.blurScale,
  );
  const coveContactStrength = showCyclorama
    ? Math.min(0.7, Math.max(0.15, shadowOpacity) * preset.shadow.opacityScale * (0.5 + shadowContact * 0.5))
    : 0;

  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const bounceRef = useRef<THREE.PointLight>(null);

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
        <group position={[0, floorY, 0]}>
          <CycloramaBackdrop
            color={gradientColors.center}
            floor={gradientColors.edge}
            selected={backdropSelected}
            onSelect={onSelectBackdrop}
            contactPoints={contactPoints}
            contactStrength={coveContactStrength}
          />
        </group>
      )}
      {/* Always present so dragging beside the device orbits instead of
          locking onto a farther gimbal ring through empty space. */}
      <OrbitPickFloor y={floorY} />
      {/* Atmosphere disc only when soft shadows are off — avoids dark circular blobs. */}
      {groundAllowed && !showFloorShadow && (
        <SoftGroundDisc y={floorY} color={gradientColors?.edge ?? '#090b0e'} />
      )}
      {showFloorShadow && shadowOpacityResolved > 0.01 && (
        <StudioSoftFloorShadows
          y={floorY}
          opacity={Math.min(0.85, shadowOpacityResolved)}
          softness={shadowBlur}
          contact={shadowContact}
          quality={shadowQuality}
          exportBoost={shadowExportBoost}
          lightPosition={keyPosition}
          lightTarget={focus}
          lightStrength={keyIntensity}
          color={preset.shadow.color}
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
