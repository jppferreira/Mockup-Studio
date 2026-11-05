import { useEffect, useMemo, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { DeviceModel } from '../lib/devices';
import { useScreenEmissiveMap } from '../lib/useScreenTexture';

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
}) {
  const geometry = useMemo(() => makeScreenGeometry(width, height, radius), [width, height, radius]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        name,
        color: '#000000',
        emissive: '#ffffff',
        emissiveIntensity: 1,
        metalness: 0,
        roughness: 1,
        toneMapped: false,
        envMapIntensity: 0,
      }),
    [name],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

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

  return <mesh geometry={geometry} position={position} material={material} />;
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
      metalness={0.72}
      roughness={0.32}
      clearcoat={0.55}
      clearcoatRoughness={0.2}
      envMapIntensity={1.55}
      reflectivity={1}
    />
  );
}

function GlassBezel() {
  return (
    <meshPhysicalMaterial
      color="#05070a"
      metalness={0.2}
      roughness={0.18}
      clearcoat={1}
      clearcoatRoughness={0.05}
      envMapIntensity={0.7}
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
      />

      {/* Thin glass overlay for reflections */}
      {!clayMode && (
        <RoundedBox args={[halfW - 0.1, height - 0.12, 0.004]} radius={0.065} smoothness={6} position={[0, 0, 0.074]}>
          <meshPhysicalMaterial
            color="#ffffff"
            metalness={0}
            roughness={0.05}
            transmission={0.92}
            thickness={0.02}
            transparent
            opacity={0.12}
            envMapIntensity={1.4}
            clearcoat={1}
            clearcoatRoughness={0.02}
          />
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
                  <meshStandardMaterial color="#3a3d44" metalness={0.95} roughness={0.2} envMapIntensity={1} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.015]}>
                  <circleGeometry args={[0.055, 48]} />
                  <meshPhysicalMaterial color="#090d12" metalness={0.8} roughness={0.05} clearcoat={1} />
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
}: {
  device: DeviceModel;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  finishHex?: string;
  clayMode?: boolean;
  mediaPlaying?: boolean;
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
          />
        </group>
      </group>

      {/* Multi-piece hinge */}
      <mesh>
        <cylinderGeometry args={[0.04, 0.04, height - 0.22, 32]} />
        <meshStandardMaterial color="#9aa0a6" metalness={0.95} roughness={0.22} envMapIntensity={1.2} />
      </mesh>
      {[-0.85, 0, 0.85].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[0.048, 0.048, 0.18, 24]} />
          <meshStandardMaterial color="#7d838a" metalness={0.98} roughness={0.18} envMapIntensity={1.3} />
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
}: {
  device: DeviceModel;
  screenshot: string | null;
  liveStream?: MediaStream | null;
  finishHex?: string;
  clayMode?: boolean;
  mediaPlaying?: boolean;
}) {
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!group.current) return;
    group.current.scale.setScalar(1);
    group.current.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group.current);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) group.current.scale.setScalar(3.0 / size.y);
    group.current.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(group.current).getCenter(new THREE.Vector3());
    group.current.position.sub(center);
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
      />
    </group>
  );
}
