import {
  Suspense, useEffect, useMemo, useRef, useState,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, PerspectiveCamera, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ANIMATION_PRESETS, applyAnimationPreset, type AnimationPreset } from '../lib/animationPresets';
import { evaluateAnimation, evaluateCamera } from '../lib/animation';
import { getDevice, type DeviceId } from '../lib/devices';
import { createDeviceInstance, DEVICE_COLORS, type DeviceColor } from '../types';

const PREVIEW_PRESETS = ANIMATION_PRESETS.filter((preset) => preset.id !== 'clear');
const CLEAR_PRESET = ANIMATION_PRESETS.find((preset) => preset.id === 'clear');

type AnimationPresetsPanelProps = {
  onApply: (presetId: string) => void;
  appliedId?: string | null;
  deviceId: DeviceId;
  deviceColor?: DeviceColor;
  clayMode?: boolean;
  screenshot?: string | null;
};

function deg(value: number) {
  return (value * Math.PI) / 180;
}

function finishHex(deviceColor?: DeviceColor) {
  if (!deviceColor) return undefined;
  return DEVICE_COLORS.find((swatch) => swatch.id === deviceColor)?.hex;
}

function PreviewFallback({ color = '#3d8f72' }: { color?: string }) {
  return (
    <mesh rotation={[deg(-10), deg(-20), 0]} castShadow={false}>
      <boxGeometry args={[0.48, 0.98, 0.07]} />
      <meshStandardMaterial color={color} roughness={0.42} metalness={0.18} />
    </mesh>
  );
}

function FittedGltfModel({
  url,
  clayMode = false,
  colorHex,
}: {
  url: string;
  clayMode?: boolean;
  colorHex?: string;
}) {
  const { scene } = useGLTF(url);
  const fitted = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const tint = (mat: THREE.Material) => {
        const next = mat.clone();
        if (clayMode && 'color' in next && next.color instanceof THREE.Color) {
          next.color.set(colorHex || '#c5c0b8');
          if ('roughness' in next) (next as THREE.MeshStandardMaterial).roughness = 0.72;
          if ('metalness' in next) (next as THREE.MeshStandardMaterial).metalness = 0.08;
          if ('map' in next) (next as THREE.MeshStandardMaterial).map = null;
        } else if (colorHex && 'color' in next && next.color instanceof THREE.Color) {
          const name = (mat.name || mesh.name || '').toLowerCase();
          if (/body|frame|housing|case|chassis|aluminium|aluminum|titanium/.test(name)) {
            next.color.set(colorHex);
          }
        }
        return next;
      };
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(tint);
      else if (mesh.material) mesh.material = tint(mesh.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    // Leave margin in the square thumb so spin / tilt / zoom never clip.
    clone.scale.multiplyScalar(1.2 / maxDim);
    // Re-center after scaling so the mesh sits true middle of the thumb.
    const fitted = new THREE.Box3().setFromObject(clone);
    const fittedCenter = fitted.getCenter(new THREE.Vector3());
    clone.position.sub(fittedCenter);
    return clone;
  }, [scene, clayMode, colorHex]);

  return <primitive object={fitted} />;
}

function PreviewModel({
  deviceId,
  clayMode,
  colorHex,
}: {
  deviceId: DeviceId;
  clayMode?: boolean;
  colorHex?: string;
}) {
  const device = getDevice(deviceId);
  if (device.url) {
    return (
      <Suspense fallback={<PreviewFallback color={colorHex || '#3d8f72'} />}>
        <FittedGltfModel url={device.url} clayMode={clayMode} colorHex={colorHex} />
      </Suspense>
    );
  }
  return <PreviewFallback color={colorHex || '#3d8f72'} />;
}

function PresetPreviewScene({
  preset,
  deviceId,
  clayMode,
  colorHex,
  animate,
}: {
  preset: AnimationPreset;
  deviceId: DeviceId;
  clayMode?: boolean;
  colorHex?: string;
  animate: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const base = useMemo(
    () => createDeviceInstance({
      id: `preview-${preset.id}`,
      deviceId,
      position: { x: 0, y: 0, z: 0 },
      // Near-front rest pose so the mesh reads centered in a square thumb.
      rotation: { x: -2, y: -8, z: 0 },
      scale: 1,
    }),
    [deviceId, preset.id],
  );
  const clip = useMemo(
    () => applyAnimationPreset(
      { duration: Math.max(preset.duration, 0.1), fps: 30, loop: preset.loop, tracks: [] },
      base,
      preset,
    ),
    [base, preset],
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const camera = cameraRef.current;
    if (!group || !camera) return;

    // Framed for a square thumb — camera locked on origin so content is mid-box.
    const camZ = 3.05;
    if (!animate || preset.id === 'clear') {
      group.position.set(0, 0, 0);
      group.rotation.set(deg(base.rotation.x), deg(base.rotation.y), deg(base.rotation.z));
      group.scale.setScalar(1);
      camera.position.set(0, 0, camZ);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      return;
    }

    const time = clock.elapsedTime;
    const [posed] = evaluateAnimation([base], clip, time);
    // Keep the visual center locked; damp translation / scale so edges never clip.
    group.position.set(
      (posed.position.x - base.position.x) * 0.1,
      (posed.position.y - base.position.y) * 0.1,
      (posed.position.z - base.position.z) * 0.1,
    );
    group.rotation.set(deg(posed.rotation.x), deg(posed.rotation.y), deg(posed.rotation.z));
    const scaleDelta = posed.scale / Math.max(base.scale, 0.001);
    group.scale.setScalar(1 + (scaleDelta - 1) * 0.16);

    if (preset.id === 'closePan') {
      const cam = evaluateCamera(clip, time, 'front', false);
      const z = THREE.MathUtils.clamp(camZ + (cam.z - 8.175) * 0.04, 2.7, 3.4);
      camera.position.set(cam.x * 0.03, cam.y * 0.02, z);
    } else {
      camera.position.set(0, 0, camZ);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <color attach="background" args={['#dfe3e8']} />
      <hemisphereLight args={['#ffffff', '#c5ccd4', 1.5]} />
      <ambientLight intensity={1.9} />
      <directionalLight position={[2.8, 4.2, 3.2]} intensity={2.45} />
      <directionalLight position={[-2.6, 2.2, 1.4]} intensity={1.2} color="#eef4ff" />
      <directionalLight position={[0.4, 1.2, 4.2]} intensity={0.95} color="#fff8ee" />
      <PerspectiveCamera ref={cameraRef} makeDefault fov={34} position={[0, 0, 3.05]} near={0.05} far={40} />
      <group ref={groupRef}>
        <PreviewModel deviceId={deviceId} clayMode={clayMode} colorHex={colorHex} />
      </group>
      <ContactShadows position={[0, -0.92, 0]} opacity={0.12} scale={4.5} blur={3.6} far={2.8} color="#6a7380" />
    </>
  );
}

function useCardVisible() {
  const ref = useRef<HTMLDivElement>(null);
  // Start visible so the first paint mounts a canvas immediately.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const root = el.closest('.inspector-scroll, .right-presets-scroll');
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: root instanceof Element ? root : null, rootMargin: '120px 0px', threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

function PresetCard({
  preset,
  applied,
  onApply,
  deviceId,
  clayMode,
  colorHex,
}: {
  preset: AnimationPreset;
  applied: boolean;
  onApply: (presetId: string) => void;
  deviceId: DeviceId;
  clayMode?: boolean;
  colorHex?: string;
}) {
  const isClear = preset.id === 'clear';
  const { ref, visible } = useCardVisible();

  return (
    <div
      role="button"
      tabIndex={0}
      className={`anim-preset-card${applied ? ' is-applied' : ''}${isClear ? ' is-clear' : ''}`}
      title={preset.description}
      aria-label={`Apply ${preset.label} animation`}
      onClick={() => onApply(preset.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onApply(preset.id);
        }
      }}
    >
      <div className="anim-preset-stage" ref={ref} aria-hidden>
        {visible ? (
          <Canvas
            className="anim-preset-canvas"
            dpr={[1, 1.5]}
            gl={{ alpha: false, antialias: true, powerPreference: 'low-power' }}
            frameloop={isClear ? 'demand' : 'always'}
            camera={{ position: [0, 0, 3.05], fov: 34 }}
            onCreated={({ gl }) => {
              gl.setClearColor(0xdfe3e8, 1);
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.7;
            }}
          >
            <PresetPreviewScene
              preset={preset}
              deviceId={deviceId}
              clayMode={clayMode}
              colorHex={colorHex}
              animate={!isClear}
            />
          </Canvas>
        ) : (
          <div className="anim-preset-placeholder" />
        )}
        {isClear && <span className="anim-preset-slash" />}
      </div>
      <div className="anim-preset-body">
        <div className="anim-preset-copy">
          <strong>{preset.label}</strong>
          <span>{preset.description}</span>
        </div>
        <em className="anim-preset-meta">
          {isClear ? 'Reset' : preset.loop ? `${preset.duration}s · loop` : `${preset.duration}s · once`}
        </em>
      </div>
    </div>
  );
}

export default function AnimationPresetsPanel({
  onApply,
  appliedId = null,
  deviceId,
  deviceColor,
  clayMode = false,
  screenshot = null,
}: AnimationPresetsPanelProps) {
  const colorHex = clayMode ? '#c5c0b8' : finishHex(deviceColor);
  const device = getDevice(deviceId);

  useEffect(() => {
    if (device.url) useGLTF.preload(device.url);
  }, [device.url]);

  void screenshot;

  return (
    <div className="anim-presets-panel" aria-label="Preset animations">
      <div className="anim-presets-intro">
        <strong>Preset animations</strong>
        <span>Previews use your current device model. Click a card to apply the motion.</span>
      </div>
      <div className="anim-presets-grid" role="list">
        {PREVIEW_PRESETS.map((preset) => (
          <div key={preset.id} role="listitem">
            <PresetCard
              preset={preset}
              applied={appliedId === preset.id}
              onApply={onApply}
              deviceId={deviceId}
              clayMode={clayMode}
              colorHex={colorHex}
            />
          </div>
        ))}
        {CLEAR_PRESET && (
          <div role="listitem">
            <PresetCard
              preset={CLEAR_PRESET}
              applied={false}
              onApply={onApply}
              deviceId={deviceId}
              clayMode={clayMode}
              colorHex={colorHex}
            />
          </div>
        )}
      </div>
    </div>
  );
}
