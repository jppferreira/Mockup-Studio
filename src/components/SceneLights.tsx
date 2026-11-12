import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { SceneLight, Vec3 } from '../types';
import { resolveSceneLightShadowMapSize } from '../lib/studioShadows';
import LightTranslateGizmo from './LightTranslateGizmo';
import { useStudioShadowInteraction } from './StudioEnvironment';

let rectAreaReady = false;
function ensureRectAreaLights() {
  if (rectAreaReady) return;
  RectAreaLightUniformsLib.init();
  rectAreaReady = true;
}

function useAdaptiveShadowMap(
  lightRef: RefObject<THREE.Light | null>,
  castShadow: boolean,
) {
  const gl = useThree((s) => s.gl);
  const interaction = useStudioShadowInteraction();
  const mode = interaction?.mode ?? 'studio';

  useEffect(() => {
    const light = lightRef.current as (THREE.Light & { shadow?: THREE.LightShadow }) | null;
    if (!light?.shadow || !castShadow) return;
    // Stable size across interactive↔studio — avoid atlas thrash on orbit.
    const size = resolveSceneLightShadowMapSize('studio', false, gl.capabilities.maxTextureSize || 2048);
    light.shadow.mapSize.set(size, size);
    light.shadow.autoUpdate = mode !== 'interactive';
    light.shadow.needsUpdate = mode !== 'interactive';
    light.shadow.blurSamples = 4;
    if (light.shadow.map && (light.shadow.map.width !== size || light.shadow.map.height !== size)) {
      light.shadow.map.dispose();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (light.shadow as any).map = null;
    }
  }, [lightRef, castShadow, mode, gl]);
}

function AimingAreaLight({ light }: { light: SceneLight }) {
  const ref = useRef<THREE.RectAreaLight>(null);
  useLayoutEffect(() => {
    ensureRectAreaLights();
    const node = ref.current;
    if (!node) return;
    node.position.set(light.position.x, light.position.y, light.position.z);
    node.lookAt(light.target.x, light.target.y, light.target.z);
  }, [
    light.position.x, light.position.y, light.position.z,
    light.target.x, light.target.y, light.target.z,
  ]);
  if (!light.enabled || light.intensity <= 0.001) return null;
  return (
    <rectAreaLight
      ref={ref}
      color={light.color}
      intensity={light.intensity}
      width={light.width}
      height={light.height}
      position={[light.position.x, light.position.y, light.position.z]}
    />
  );
}

function AimingDirectionalLight({ light }: { light: SceneLight }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  useAdaptiveShadowMap(lightRef, Boolean(light.castShadow));
  useLayoutEffect(() => {
    const node = lightRef.current;
    if (!node) return;
    node.position.set(light.position.x, light.position.y, light.position.z);
    node.target.position.set(light.target.x, light.target.y, light.target.z);
    node.target.updateMatrixWorld();
  }, [
    light.position.x, light.position.y, light.position.z,
    light.target.x, light.target.y, light.target.z,
  ]);
  if (!light.enabled || light.intensity <= 0.001) return null;
  return (
    <directionalLight
      ref={lightRef}
      color={light.color}
      intensity={light.intensity}
      position={[light.position.x, light.position.y, light.position.z]}
      castShadow={light.castShadow}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.00025}
      shadow-normalBias={0.04}
      shadow-radius={4.5}
    />
  );
}

function AimingSpotLight({ light }: { light: SceneLight }) {
  const lightRef = useRef<THREE.SpotLight>(null);
  useAdaptiveShadowMap(lightRef, Boolean(light.castShadow));
  useLayoutEffect(() => {
    const node = lightRef.current;
    if (!node) return;
    node.position.set(light.position.x, light.position.y, light.position.z);
    node.target.position.set(light.target.x, light.target.y, light.target.z);
    node.target.updateMatrixWorld();
  }, [
    light.position.x, light.position.y, light.position.z,
    light.target.x, light.target.y, light.target.z,
  ]);
  if (!light.enabled || light.intensity <= 0.001) return null;
  return (
    <spotLight
      ref={lightRef}
      color={light.color}
      intensity={light.intensity}
      position={[light.position.x, light.position.y, light.position.z]}
      distance={light.distance}
      decay={light.decay}
      angle={light.angle}
      penumbra={Math.max(0.35, light.penumbra)}
      castShadow={light.castShadow}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.00025}
      shadow-normalBias={0.04}
      shadow-radius={4.5}
    />
  );
}

function SceneLightNode({ light }: { light: SceneLight }) {
  if (!light.enabled || light.intensity <= 0.001) return null;
  if (light.kind === 'area') return <AimingAreaLight light={light} />;
  if (light.kind === 'directional') return <AimingDirectionalLight light={light} />;
  if (light.kind === 'spot') return <AimingSpotLight light={light} />;
  return (
    <pointLight
      color={light.color}
      intensity={light.intensity}
      position={[light.position.x, light.position.y, light.position.z]}
      distance={light.distance}
      decay={light.decay}
      castShadow={light.castShadow}
      shadow-mapSize={[512, 512]}
      shadow-bias={-0.0002}
    />
  );
}

type Props = {
  lights: SceneLight[];
  selectedId?: string | null;
  gizmoActive?: boolean;
  onSelect?: (id: string) => void;
  onPositionChange?: (id: string, position: Vec3) => void;
  onDraggingChange?: (dragging: boolean) => void;
};

/** Spline-style extra lights layered on the studio softbox rig. */
export default function SceneLights({
  lights,
  selectedId = null,
  gizmoActive = false,
  onSelect,
  onPositionChange,
  onDraggingChange,
}: Props) {
  if (!lights.length) return null;
  return (
    <group>
      {lights.map((light) => {
        const selected = gizmoActive && selectedId === light.id && light.enabled;
        return (
          <group key={light.id}>
            <SceneLightNode light={light} />
            {light.enabled ? (
              <LightTranslateGizmo
                position={light.position}
                color={light.color}
                active={selected}
                size={0.12}
                onSelect={() => onSelect?.(light.id)}
                onDraggingChange={onDraggingChange}
                onLiveChange={(position) => onPositionChange?.(light.id, position)}
                onPositionChange={(position) => onPositionChange?.(light.id, position)}
              />
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
