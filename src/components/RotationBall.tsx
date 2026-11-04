import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '../types';

export type GizmoMode = 'rotate' | 'translate';

interface Props {
  object: THREE.Object3D | null;
  active: boolean;
  mode: GizmoMode;
  onRotate: (rotation: Vec3) => void;
  onMove: (position: Vec3) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

type Tool = 'translate' | 'rotate';

/** Hide picker planes / center blobs; brighten only the actual rings & arrows. */
function thickenGizmo(controls: THREE.Object3D | null | undefined, kind: Tool) {
  if (!controls) return;
  const root = (controls as unknown as { getHelper?: () => THREE.Object3D }).getHelper?.()
    ?? (controls as unknown as { _root?: THREE.Object3D })._root
    ?? controls;

  root.traverse((child) => {
    const name = child.name || '';
    // Translucent XY/YZ/XZ planes + center pickers read as a weird colored halo.
    const isPickerPlane = name === 'XY' || name === 'YZ' || name === 'XZ'
      || name === 'XYZ' || name === 'XYZE'
      || name.includes('Plane')
      || (child as THREE.Object3D & { isTransformControlsPlane?: boolean }).isTransformControlsPlane;
    if (isPickerPlane) {
      child.visible = false;
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.renderOrder = kind === 'translate' ? 1002 : 998;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const m = mat as THREE.MeshBasicMaterial;
        m.depthTest = false;
        m.transparent = true;
        // Keep axis colors crisp — don't boost near-invisible plane leftovers.
        if ((m.opacity ?? 1) < 0.4) {
          m.opacity = 0;
          m.visible = false;
        } else {
          m.opacity = Math.min(1, Math.max(m.opacity ?? 1, 0.92));
        }
        m.toneMapped = false;
        m.needsUpdate = true;
      }
      if (
        name === 'X' || name === 'Y' || name === 'Z' || name === 'E'
        || name.endsWith('X') || name.endsWith('Y') || name.endsWith('Z')
      ) {
        mesh.scale.setScalar(Math.max(mesh.scale.x, kind === 'translate' ? 1.55 : 1.25));
      }
    }
    const line = child as THREE.LineSegments;
    if (line.isLineSegments || (child as THREE.Line).isLine) {
      const mat = line.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.depthTest = false;
        mat.transparent = true;
        mat.opacity = 0.95;
        mat.linewidth = 3;
        mat.needsUpdate = true;
      }
    }
  });
}

function readRotation(object: THREE.Object3D): Vec3 {
  object.rotation.reorder('XYZ');
  return {
    x: Number(THREE.MathUtils.radToDeg(object.rotation.x).toFixed(1)),
    y: Number(THREE.MathUtils.radToDeg(object.rotation.y).toFixed(1)),
    z: Number(THREE.MathUtils.radToDeg(object.rotation.z).toFixed(1)),
  };
}

function readPosition(object: THREE.Object3D): Vec3 {
  return {
    x: Number(object.position.x.toFixed(3)),
    y: Number(object.position.y.toFixed(3)),
    z: Number(object.position.z.toFixed(3)),
  };
}

/**
 * Spline-style gizmo: rotation rings + translate arrows.
 * Only one tool is interactive at a time so they don't fight — especially
 * important in multi-device compositions.
 */
export default function RotationBall({
  object,
  active,
  mode,
  onRotate,
  onMove,
  onDraggingChange,
}: Props) {
  const { controls } = useThree();
  const rotateRef = useRef<THREE.Object3D | null>(null);
  const translateRef = useRef<THREE.Object3D | null>(null);
  const [ready, setReady] = useState(false);
  /** Which handle captured the pointer — locks the other tool out. */
  const [dragTool, setDragTool] = useState<Tool | null>(null);
  const dragToolRef = useRef<Tool | null>(null);
  const orbit = controls as unknown as { enabled: boolean } | null;
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;

  useEffect(() => {
    setReady(Boolean(object) && active);
    dragToolRef.current = null;
    setDragTool(null);
  }, [object, active]);

  useEffect(() => () => {
    dragToolRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;
    onDraggingChange?.(false);
  }, [onDraggingChange]);

  useLayoutEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      thickenGizmo(rotateRef.current, 'rotate');
      thickenGizmo(translateRef.current, 'translate');
    });
    return () => cancelAnimationFrame(id);
  }, [ready, mode, object, dragTool]);

  if (!ready || !object) return null;

  const beginDrag = (tool: Tool) => {
    // Ignore the other tool if it also fires mouseDown in the same gesture.
    if (dragToolRef.current && dragToolRef.current !== tool) return;
    dragToolRef.current = tool;
    setDragTool(tool);
    onDraggingChange?.(true);
    if (orbitRef.current) orbitRef.current.enabled = false;
  };

  const endDrag = (tool: Tool) => {
    if (dragToolRef.current && dragToolRef.current !== tool) return;
    if (tool === 'translate') onMove(readPosition(object));
    else onRotate(readRotation(object));
    dragToolRef.current = null;
    setDragTool(null);
    onDraggingChange?.(false);
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  // Prefer the UI mode, but once a handle is grabbed that tool owns the drag.
  const translateEnabled = dragTool === null ? true : dragTool === 'translate';
  const rotateEnabled = dragTool === null ? true : dragTool === 'rotate';

  const translateSize = mode === 'translate' || dragTool === 'translate' ? 2.1 : 1.95;
  const rotateSize = mode === 'rotate' && dragTool !== 'translate' ? 1.5 : 1.35;

  return (
    <>
      <TransformControls
        ref={translateRef as never}
        object={object}
        mode="translate"
        size={translateSize}
        space="world"
        showX
        showY
        showZ
        enabled={translateEnabled}
        onMouseDown={() => beginDrag('translate')}
        onMouseUp={() => endDrag('translate')}
        onObjectChange={() => {
          if (dragToolRef.current && dragToolRef.current !== 'translate') return;
          onMove(readPosition(object));
        }}
      />
      <TransformControls
        ref={rotateRef as never}
        object={object}
        mode="rotate"
        size={rotateSize}
        space="world"
        showX
        showY
        showZ
        enabled={rotateEnabled}
        onMouseDown={() => beginDrag('rotate')}
        onMouseUp={() => endDrag('rotate')}
        onObjectChange={() => {
          if (dragToolRef.current && dragToolRef.current !== 'rotate') return;
          onRotate(readRotation(object));
        }}
      />
    </>
  );
}
