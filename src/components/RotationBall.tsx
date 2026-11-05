import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '../types';

export type GizmoMode = 'rotate' | 'translate';

export type GizmoTargets = {
  /** Outer pivot — translate only. */
  position: THREE.Object3D;
  /** Inner pivot — rotate / scale. */
  rotation: THREE.Object3D;
};

interface Props {
  targets: GizmoTargets | null;
  active: boolean;
  mode: GizmoMode;
  onRotate: (rotation: Vec3, opts?: { recordKeys?: boolean }) => void;
  onMove: (position: Vec3, opts?: { recordKeys?: boolean }) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

type Tool = 'translate' | 'rotate';

type ControlsHandle = THREE.Object3D & {
  enabled?: boolean;
  getHelper?: () => THREE.Object3D;
  _root?: THREE.Object3D;
};

/**
 * Clean up picker planes; fatten translate arrows only.
 * Do NOT non-uniform-scale rotate rings — that warps hit targets.
 */
function styleGizmo(controls: ControlsHandle | null | undefined, kind: Tool) {
  if (!controls) return;
  const root = controls.getHelper?.() ?? controls._root ?? controls;
  const axisBoost = 2.55;

  root.traverse((child) => {
    const name = child.name || '';
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
      mesh.renderOrder = kind === 'translate' ? 1002 : 1000;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const m = mat as THREE.MeshBasicMaterial;
        m.depthTest = false;
        m.transparent = true;
        if ((m.opacity ?? 1) < 0.4) {
          m.opacity = 0;
          m.visible = false;
        } else {
          m.opacity = Math.min(1, Math.max(m.opacity ?? 1, 0.95));
        }
        m.toneMapped = false;
        m.needsUpdate = true;
      }

      if (kind === 'translate') {
        const isAxis = name === 'X' || name === 'Y' || name === 'Z'
          || name.endsWith('X') || name.endsWith('Y') || name.endsWith('Z');
        if (isAxis) {
          mesh.scale.set(
            Math.max(mesh.scale.x, axisBoost),
            Math.max(mesh.scale.y, axisBoost),
            Math.max(mesh.scale.z, axisBoost * 1.1),
          );
        }
      }
    }

    const line = child as THREE.LineSegments;
    if (line.isLineSegments || (child as THREE.Line).isLine) {
      const mat = line.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.depthTest = false;
        mat.transparent = true;
        mat.opacity = 1;
        mat.linewidth = 4;
        mat.needsUpdate = true;
      }
    }
  });
}

function setControlsEnabled(controls: ControlsHandle | null, enabled: boolean) {
  if (!controls) return;
  controls.enabled = enabled;
}

/** Stable Euler readout matching how DeviceModelView applies rotation.set(x,y,z). */
function readRotation(object: THREE.Object3D): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
  const toDeg = (rad: number) => {
    let deg = THREE.MathUtils.radToDeg(rad);
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    return Number(deg.toFixed(1));
  };
  return { x: toDeg(euler.x), y: toDeg(euler.y), z: toDeg(euler.z) };
}

function readPosition(object: THREE.Object3D): Vec3 {
  return {
    x: Number(object.position.x.toFixed(3)),
    y: Number(object.position.y.toFixed(3)),
    z: Number(object.position.z.toFixed(3)),
  };
}

/**
 * Spline-style gizmo: rotation rings + translate arrows on separate pivots so
 * the two TransformControls never fight over the same Object3D.
 */
export default function RotationBall({
  targets,
  active,
  mode,
  onRotate,
  onMove,
  onDraggingChange,
}: Props) {
  const { controls } = useThree();
  const rotateRef = useRef<ControlsHandle | null>(null);
  const translateRef = useRef<ControlsHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [dragTool, setDragTool] = useState<Tool | null>(null);
  const dragToolRef = useRef<Tool | null>(null);
  const orbit = controls as unknown as { enabled: boolean } | null;
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;

  const positionObject = targets?.position ?? null;
  const rotationObject = targets?.rotation ?? null;

  useEffect(() => {
    setReady(Boolean(targets) && active);
    dragToolRef.current = null;
    setDragTool(null);
  }, [targets, active]);

  useEffect(() => () => {
    dragToolRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;
    onDraggingChange?.(false);
  }, [onDraggingChange]);

  useLayoutEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      styleGizmo(rotateRef.current, 'rotate');
      styleGizmo(translateRef.current, 'translate');
      if (!dragToolRef.current) {
        setControlsEnabled(translateRef.current, true);
        setControlsEnabled(rotateRef.current, true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [ready, mode, targets, dragTool]);

  if (!ready || !positionObject || !rotationObject) return null;

  const beginDrag = (tool: Tool) => {
    if (dragToolRef.current && dragToolRef.current !== tool) return;
    dragToolRef.current = tool;
    setDragTool(tool);
    onDraggingChange?.(true);
    if (orbitRef.current) orbitRef.current.enabled = false;

    if (tool === 'translate') {
      setControlsEnabled(rotateRef.current, false);
      setControlsEnabled(translateRef.current, true);
    } else {
      setControlsEnabled(translateRef.current, false);
      setControlsEnabled(rotateRef.current, true);
    }
  };

  const endDrag = (tool: Tool) => {
    if (dragToolRef.current && dragToolRef.current !== tool) return;
    if (tool === 'translate') {
      onMove(readPosition(positionObject), { recordKeys: true });
    } else {
      onRotate(readRotation(rotationObject), { recordKeys: true });
    }
    dragToolRef.current = null;
    setDragTool(null);
    setControlsEnabled(translateRef.current, true);
    setControlsEnabled(rotateRef.current, true);
    onDraggingChange?.(false);
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  const translateEnabled = dragTool === null || dragTool === 'translate';
  const rotateEnabled = dragTool === null || dragTool === 'rotate';

  const translateSize = mode === 'translate' || dragTool === 'translate' ? 2.55 : 2.35;
  const rotateSize = mode === 'rotate' || dragTool === 'rotate' ? 1.9 : 1.7;

  return (
    <>
      <TransformControls
        ref={rotateRef as never}
        object={rotationObject}
        mode="rotate"
        size={rotateSize}
        space="local"
        showX
        showY
        showZ
        enabled={rotateEnabled}
        onMouseDown={() => beginDrag('rotate')}
        onMouseUp={() => endDrag('rotate')}
        onObjectChange={() => {
          if (dragToolRef.current !== 'rotate') return;
          onRotate(readRotation(rotationObject), { recordKeys: false });
        }}
      />
      <TransformControls
        ref={translateRef as never}
        object={positionObject}
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
          if (dragToolRef.current !== 'translate') return;
          onMove(readPosition(positionObject), { recordKeys: false });
        }}
      />
    </>
  );
}
