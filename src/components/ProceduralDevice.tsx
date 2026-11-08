import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DeviceModel } from '../lib/devices';
import { TONE_CAMERA_RING, TONE_STAINLESS, TONE_STAINLESS_DARK } from '../lib/referenceTones';
import {
  ReflectionDriveContext,
  SceneEnvMapContext,
  surfaceLook,
} from '../lib/reflectionStyle';
import { useScreenEmissiveMap } from '../lib/useScreenTexture';
import { STUDIO_DEVICE_HEIGHT } from '../lib/studioEnvironment';

function useSurfaceLook(kind: 'screen' | 'glass') {
  const drive = useContext(ReflectionDriveContext);
  const envMap = useContext(SceneEnvMapContext);
  return { envMap, look: surfaceLook(kind, drive.style, drive.amount, drive.clay) };
}

function makeScreenGeometry(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ShapeGeometry(shape, 32);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + width / 2) / width, (pos.getY(i) + height / 2) / height);
  }
  uv.needsUpdate = true;
  return geometry;
}

function ScreenPlane({
  width,
  height,
  radius,
  position,
  screenshot,
  liveStream,
  screenSize,
  name = 'ProceduralScreen',
  mediaPlaying,
  dropHighlight = false,
}: {
  width: number;
  height: number;
  radius: number;
  position: [number, number, number];
  screenshot: string | null;
  liveStream?: MediaStream | null;
  screenSize: { width: number; height: number };
  name?: string;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
}) {
  const { envMap, look } = useSurfaceLook('screen');
  const geometry = useMemo(() => makeScreenGeometry(width, height, radius), [width, height, radius]);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        name,
        color: '#000000',
        emissive: '#ffffff',
        emissiveIntensity: 1,
        toneMapped: false,
      }),
    [name],
  );

  useEffect(() => {
    material.envMap = envMap;
    material.roughness = look.roughness;
    material.metalness = look.metalness;
    material.clearcoat = look.clearcoat;
    material.clearcoatRoughness = look.clearcoatRoughness;
    material.envMapIntensity = look.envMapIntensity;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.transmission = 0;
    material.needsUpdate = true;
  }, [
    material,
    envMap,
    look.roughness,
    look.metalness,
    look.clearcoat,
    look.clearcoatRoughness,
    look.envMapIntensity,
  ]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useEffect(() => {
    if (!dropHighlight) return undefined;
    const previous = material.emissive.clone();
    const previousIntensity = material.emissiveIntensity;
    material.emissive.set('#d6ff3a');
    material.emissiveIntensity = 1.2;
    material.needsUpdate = true;
    return () => {
      material.emissive.copy(previous);
      material.emissiveIntensity = previousIntensity;
      material.needsUpdate = true;
    };
  }, [dropHighlight, material]);

  useScreenEmissiveMap({
    material,
    screenshot,
    liveStream,
    width: screenSize.width,
    height: screenSize.height,
    playing: mediaPlaying,
    applyUv: (tex) => {
      tex.flipY = false;
    },
  });

  return (
    <group>
      <mesh geometry={geometry} position={position} material={material} />
      {dropHighlight && (
        <PulsingScreenGlow geometry={geometry} position={position} />
      )}
    </group>
  );
}

function PulsingScreenGlow({
  geometry,
  position,
}: {
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
}) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    name: 'screen-drop-highlight',
    color: '#d6ff3a',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    side: THREE.DoubleSide,
  }), []);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ clock }) => {
    mat.opacity = 0.42 + Math.sin(clock.elapsedTime * 5.5) * 0.2;
  });

  return (
    <mesh geometry={geometry} position={position} material={mat} renderOrder={8} raycast={() => null} />
  );
}

function TitaniumMaterial({ color, clayMode }: { color: string; clayMode?: boolean }) {
  if (clayMode) {
    return (
      <meshStandardMaterial
        color={color}
        metalness={0}
        roughness={0.92}
        envMapIntensity={0.08}
      />
    );
  }
  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0.14}
      roughness={0.42}
      clearcoat={0.46}
      clearcoatRoughness={0.32}
      envMapIntensity={0.92}
    />
  );
}

function GlassBezel() {
  const { envMap, look } = useSurfaceLook('glass');
  return (
    <meshPhysicalMaterial
      color="#05070a"
      metalness={look.metalness}
      roughness={look.roughness}
      clearcoat={look.clearcoat}
      clearcoatRoughness={look.clearcoatRoughness}
      envMapIntensity={look.envMapIntensity}
      envMap={envMap ?? undefined}
    />
  );
}

function GlassSheet() {
  const { envMap, look } = useSurfaceLook('glass');
  const drive = useContext(ReflectionDriveContext);
  const opacity = drive.clay ? 0.04 : drive.style === 'mirror' ? 0.22 : drive.style === 'matte' ? 0.06 : 0.12;
  return (
    <meshPhysicalMaterial
      color="#ffffff"
      metalness={look.metalness}
      roughness={look.roughness}
      transparent
      opacity={opacity}
      depthWrite={false}
      envMapIntensity={look.envMapIntensity}
      envMap={envMap ?? undefined}
      clearcoat={look.clearcoat}
      clearcoatRoughness={look.clearcoatRoughness}
    />
  );
}

function DuoHalf({
  side,
  finish,
  screenshot,
  liveStream,
  halfW,
  height,
  screenSize,
  clayMode,
  mediaPlaying,
  dropHighlight = false,
}: {
  side: 'left' | 'right';
  finish: string;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  halfW: number;
  height: number;
  screenSize: { width: number; height: number };
  clayMode?: boolean;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
}) {
  const isCover = side === 'right';
  return (
    <group>
      {/* Chassis */}
      <RoundedBox args={[halfW, height, 0.11]} radius={0.09} smoothness={10} castShadow receiveShadow>
        <TitaniumMaterial color={finish} clayMode={clayMode} />
      </RoundedBox>

      {/* Inner glass lip */}
      <RoundedBox args={[halfW - 0.03, height - 0.04, 0.012]} radius={0.07} smoothness={8} position={[0, 0, 0.055]}>
        <GlassBezel />
      </RoundedBox>

      <ScreenPlane
        width={halfW - 0.1}
        height={height - 0.12}
        radius={0.07}
        position={[0, 0, 0.068]}
        screenshot={screenshot}
        liveStream={liveStream}
        screenSize={screenSize}
        name={isCover ? 'CoverScreen' : 'ProceduralScreen'}
        mediaPlaying={mediaPlaying}
        dropHighlight={dropHighlight}
      />

      {/* Thin glass overlay for reflections */}
      {!clayMode && (
        <RoundedBox args={[halfW - 0.1, height - 0.12, 0.004]} radius={0.065} smoothness={6} position={[0, 0, 0.074]}>
          <GlassSheet />
        </RoundedBox>
      )}

      {/* Side buttons on cover half */}
      {isCover && (
        <>
          <RoundedBox args={[0.018, 0.26, 0.035]} radius={0.006} smoothness={4} position={[halfW / 2 + 0.006, 0.38, 0]}>
            <TitaniumMaterial color={finish} clayMode={clayMode} />
          </RoundedBox>
          <RoundedBox args={[0.018, 0.14, 0.035]} radius={0.006} smoothness={4} position={[halfW / 2 + 0.006, 0.08, 0]}>
            <TitaniumMaterial color={finish} clayMode={clayMode} />
          </RoundedBox>
          {/* Rear camera island */}
          <group position={[-0.26, 0.78, -0.065]}>
            <RoundedBox args={[0.48, 0.48, 0.045]} radius={0.12} smoothness={8} castShadow>
              <TitaniumMaterial color={finish} />
            </RoundedBox>
            {[
              [-0.1, 0.1],
              [0.1, 0.1],
              [-0.1, -0.1],
            ].map(([x, y], i) => (
              <group key={i} position={[x, y, -0.03]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.085, 0.085, 0.025, 48]} />
                  <meshStandardMaterial color={TONE_CAMERA_RING} metalness={0.95} roughness={0.2} envMapIntensity={1} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.015]}>
                  <circleGeometry args={[0.055, 48]} />
                  <GlassBezel />
                </mesh>
              </group>
            ))}
          </group>
        </>
      )}
    </group>
  );
}

function DuoPhone({
  device,
  screenshot,
  liveStream,
  finishHex,
  clayMode,
  mediaPlaying,
  dropHighlight = false,
}: {
  device: DeviceModel;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  finishHex?: string;
  clayMode?: boolean;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
}) {
  const finish = finishHex ?? device.finish ?? '#c8ccd1';
  const halfW = 1.18;
  const height = 2.52;
  const open = 0.95;

  return (
    <group scale={0.95}>
      <group position={[-0.015, 0, 0]} rotation={[0, open / 2, 0]}>
        <group position={[-halfW / 2, 0, 0]}>
          <DuoHalf
            side="left"
            finish={finish}
            screenshot={screenshot}
            liveStream={liveStream}
            halfW={halfW}
            height={height}
            screenSize={device.screenSize}
            clayMode={clayMode}
            mediaPlaying={mediaPlaying}
            dropHighlight={dropHighlight}
          />
        </group>
      </group>
      <group position={[0.015, 0, 0]} rotation={[0, -open / 2, 0]}>
        <group position={[halfW / 2, 0, 0]}>
          <DuoHalf
            side="right"
            finish={finish}
            screenshot={screenshot}
            liveStream={liveStream}
            halfW={halfW}
            height={height}
            screenSize={device.screenSize}
            clayMode={clayMode}
            mediaPlaying={mediaPlaying}
            dropHighlight={dropHighlight}
          />
        </group>
      </group>

      {/* Multi-piece hinge */}
      <mesh>
        <cylinderGeometry args={[0.04, 0.04, height - 0.22, 32]} />
        <meshStandardMaterial color={TONE_STAINLESS} metalness={0.95} roughness={0.22} envMapIntensity={1.2} />
      </mesh>
      {[-0.85, 0, 0.85].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[0.048, 0.048, 0.18, 24]} />
          <meshStandardMaterial color={TONE_STAINLESS_DARK} metalness={0.98} roughness={0.18} envMapIntensity={1.3} />
        </mesh>
      ))}
    </group>
  );
}

export default function ProceduralDevice({
  device,
  screenshot,
  liveStream,
  finishHex,
  clayMode,
  mediaPlaying,
  dropHighlight = false,
}: {
  device: DeviceModel;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  finishHex?: string;
  clayMode?: boolean;
  mediaPlaying?: boolean;
  dropHighlight?: boolean;
}) {
  const group = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;
    // Same parent-pose trap as GLB fit: world-space centering while the
    // translate/rotate pivots are offset pulls the mesh off the gimbal.
    // Mutating parent TRS does not refresh matrixWorld — rebuild from the
    // top neutralized ancestor or bounds still include the old pose.
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
      root.scale.setScalar(1);
      root.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 0) {
        root.scale.setScalar(STUDIO_DEVICE_HEIGHT / size.y);
      }
      root.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      root.position.sub(center);
      root.updateMatrixWorld(true);
    } finally {
      for (let i = saved.length - 1; i >= 0; i -= 1) {
        const entry = saved[i];
        entry.obj.position.copy(entry.position);
        entry.obj.quaternion.copy(entry.quaternion);
        entry.obj.scale.copy(entry.scale);
      }
      refreshWorld();
    }
  }, [device.id]);

  return (
    <group ref={group}>
      <DuoPhone
        device={device}
        screenshot={screenshot}
        liveStream={liveStream}
        finishHex={finishHex}
        clayMode={clayMode}
        mediaPlaying={mediaPlaying}
        dropHighlight={dropHighlight}
      />
    </group>
  );
}
