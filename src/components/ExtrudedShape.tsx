import { useEffect, useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { flatShapeOf, overlayVisibleAt, type FlatShape, type SceneOverlay } from '../lib/overlays';

const BASE_SIZE = 0.55;

function buildFlatShape(kind: FlatShape, size: number): THREE.Shape {
  const half = size / 2;
  const shape = new THREE.Shape();
  if (kind === 'ellipse') {
    shape.absellipse(0, 0, half, half, 0, Math.PI * 2, false, 0);
    return shape;
  }
  if (kind === 'triangle') {
    shape.moveTo(0, half);
    shape.lineTo(half, -half);
    shape.lineTo(-half, -half);
    shape.closePath();
    return shape;
  }
  const radius = size * 0.12;
  const x0 = -half;
  const y0 = -half;
  const x1 = half;
  const y1 = half;
  shape.moveTo(x0 + radius, y0);
  shape.lineTo(x1 - radius, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
  shape.lineTo(x1, y1 - radius);
  shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
  shape.lineTo(x0 + radius, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - radius);
  shape.lineTo(x0, y0 + radius);
  shape.quadraticCurveTo(x0, y0, x0 + radius, y0);
  shape.closePath();
  return shape;
}

function ExtrudedShapeMesh({
  overlay,
  onSelect,
}: {
  overlay: SceneOverlay;
  onSelect?: (id: string) => void;
}) {
  const kind = flatShapeOf(overlay);
  const depth = 0.02 + (overlay.extrusion ?? 0) * 0.42;
  const size = BASE_SIZE;

  const geometry = useMemo(() => {
    const shape = buildFlatShape(kind, size);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: Math.min(0.018, depth * 0.14),
      bevelSize: size * 0.02,
      bevelSegments: 2,
      curveSegments: kind === 'ellipse' ? 48 : 8,
    });
    geo.center();
    // Keep the front face centered on the billboard plane.
    geo.translate(0, 0, -depth / 2);
    return geo;
  }, [kind, depth, size]);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);

  return (
    <Billboard
      follow
      position={[(overlay.x - 0.5) * 3.6, (0.5 - overlay.y) * 2.5, 0.2]}
      scale={overlay.scale}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect?.(overlay.id);
      }}
    >
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        userData={{ overlayId: overlay.id, overlayKind: 'shape' }}
      >
        <meshStandardMaterial
          color={overlay.color || '#d7dde4'}
          roughness={0.46}
          metalness={0.03}
          transparent={(overlay.opacity ?? 1) < 0.999}
          opacity={overlay.opacity}
          // Opaque shapes must write depth so PCSS can land on / from them.
          depthWrite={(overlay.opacity ?? 1) >= 0.999}
        />
      </mesh>
    </Billboard>
  );
}

export default function ExtrudedShape({
  overlays,
  time,
  onSelect,
}: {
  overlays: SceneOverlay[] | undefined;
  time: number;
  onSelect?: (id: string) => void;
}) {
  const items = (overlays ?? []).filter((overlay) => (
    overlay.kind === 'shape'
    && (overlay.extrusion ?? 0) > 0.001
    && overlayVisibleAt(overlay, time)
  ));
  if (!items.length) return null;
  return (
    <group>
      {items.map((overlay) => (
        <ExtrudedShapeMesh
          key={`${overlay.id}-${flatShapeOf(overlay)}-${overlay.extrusion}`}
          overlay={overlay}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
