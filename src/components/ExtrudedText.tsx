import { useLayoutEffect, useRef } from 'react';
import { Text3D } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import helvetiker from 'three/examples/fonts/helvetiker_regular.typeface.json';
import { overlayVisibleAt, type SceneOverlay } from '../lib/overlays';

const FONT = helvetiker as never;

function ExtrudedLine({
  overlay,
  onSelect,
}: {
  overlay: SceneOverlay;
  onSelect?: (id: string) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const text = (overlay.text ?? '').trim().slice(0, 80);
  const depth = 0.035 + (overlay.extrusion ?? 0) * 0.4;
  const size = 0.32 * ((overlay.fontSize ?? 0.055) / 0.055);

  useLayoutEffect(() => {
    const current = mesh.current;
    if (!current?.geometry) return;
    current.geometry.computeBoundingBox();
    const box = current.geometry.boundingBox;
    if (!box) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    current.position.set(-center.x, -center.y, -box.max.z);
  }, [text, depth, size]);

  if (!text) return null;

  return (
    <group
      position={[(overlay.x - 0.5) * 3.6, (0.5 - overlay.y) * 2.5, 0.2]}
      scale={overlay.scale}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect?.(overlay.id);
      }}
    >
      <Text3D
        ref={mesh}
        font={FONT}
        size={size}
        height={depth}
        curveSegments={8}
        bevelEnabled
        bevelThickness={Math.min(0.02, depth * 0.12)}
        bevelSize={size * 0.012}
        bevelSegments={2}
        castShadow
        receiveShadow
        userData={{ overlayId: overlay.id, overlayKind: 'text' }}
      >
        {text}
        <meshStandardMaterial
          color={overlay.color || '#ffffff'}
          roughness={0.42}
          metalness={0.04}
          transparent={(overlay.opacity ?? 1) < 0.999}
          opacity={overlay.opacity}
          depthWrite={(overlay.opacity ?? 1) >= 0.999}
        />
      </Text3D>
    </group>
  );
}

export default function ExtrudedText({
  overlays,
  time,
  onSelect,
}: {
  overlays: SceneOverlay[] | undefined;
  time: number;
  onSelect?: (id: string) => void;
}) {
  const items = (overlays ?? []).filter((overlay) => (
    overlay.kind === 'text'
    && (overlay.extrusion ?? 0) > 0.001
    && overlayVisibleAt(overlay, time)
    && Boolean(overlay.text?.trim())
  ));
  if (!items.length) return null;
  return (
    <group>
      {items.map((overlay) => (
        <ExtrudedLine key={`${overlay.id}-${overlay.text}-${overlay.extrusion}`} overlay={overlay} onSelect={onSelect} />
      ))}
    </group>
  );
}
