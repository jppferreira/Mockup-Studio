import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '../types';

type Props = {
  position: Vec3;
  color?: string;
  active: boolean;
  /** Soft glow size — key light uses a larger marker so it’s easy to find. */
  size?: number;
  /** Live Three.js sync while the axes are dragged (no React commit). */
  onLiveChange?: (position: Vec3) => void;
  onPositionChange?: (position: Vec3) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onSelect?: () => void;
};

/**
 * World-space translate gimbal for a light source.
 * Shows a coloured marker when active, and commits position on drag end.
 */
export default function LightTranslateGizmo({
  position,
  color = '#fff4d6',
  active,
  size = 0.14,
  onLiveChange,
  onPositionChange,
  onDraggingChange,
  onSelect,
}: Props) {
  const [handleObj, setHandleObj] = useState<THREE.Group | null>(null);
  const draggingRef = useRef(false);
  const { gl } = useThree();
  const setHandleRef = useCallback((node: THREE.Group | null) => {
    setHandleObj((prev) => (prev === node ? prev : node));
  }, []);

  useLayoutEffect(() => {
    if (draggingRef.current || !handleObj) return;
    handleObj.position.set(position.x, position.y, position.z);
  }, [handleObj, position.x, position.y, position.z]);

  const readPosition = (): Vec3 | null => {
    if (!handleObj) return null;
    return {
      x: Number(handleObj.position.x.toFixed(3)),
      y: Number(handleObj.position.y.toFixed(3)),
      z: Number(handleObj.position.z.toFixed(3)),
    };
  };

  const commitPosition = () => {
    const next = readPosition();
    if (!next || !onPositionChange) return;
    onPositionChange(next);
  };

  return (
    <>
      <group
        ref={setHandleRef}
        position={[position.x, position.y, position.z]}
        userData={{ exportHide: true }}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect();
        }}
      >
        <mesh
          visible={active}
          renderOrder={1005}
          castShadow={false}
          receiveShadow={false}
          userData={{ exportHide: true, isGizmoHandle: true }}
        >
          <sphereGeometry args={[size, 20, 20]} />
          <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
        </mesh>
        {active ? (
          <mesh
            visible
            renderOrder={1004}
            castShadow={false}
            receiveShadow={false}
            userData={{ exportHide: true, isGizmoHandle: true }}
          >
            <sphereGeometry args={[size * 1.55, 16, 16]} />
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
      {active && handleObj ? (
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
            const next = readPosition();
            if (next) onLiveChange?.(next);
          }}
          onMouseUp={() => {
            draggingRef.current = false;
            const next = readPosition();
            if (next) onLiveChange?.(next);
            commitPosition();
            onDraggingChange?.(false);
            gl.domElement.style.cursor = '';
          }}
        />
      ) : null}
    </>
  );
}
