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
 * Do NOT non-uniform-scale rotate rings — that warps hit targets and makes
 * axis grabs feel random.
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

    // Screen-space "E" free-rotate torus fights precise per-axis spins — hide it.
    if (kind === 'rotate' && (name === 'E' || name.endsWith('E'))) {
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
    // Wrap to (-180, 180] so inspector / clamps stay continuous.
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
 * Spline-style gizmo: rotation rings + translate arrows.
 * One tool mutates at a time; rotation commits on pointer-up so TransformControls
 * can spin in quaternion space without Euler writeback fighting mid-drag.
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
  const rotateRef = useRef<ControlsHandle | null>(null);
  const translateRef = useRef<ControlsHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [dragTool, setDragTool] = useState<Tool | null>(null);
  const dragToolRef = useRef<Tool | null>(null);
  const poseLockRef = useRef<{ rotation: THREE.Euler; position: THREE.Vector3 } | null>(null);
  const orbit = controls as unknown as { enabled: boolean } | null;
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;

  useEffect(() => {
    setReady(Boolean(object) && active);
    dragToolRef.current = null;
    poseLockRef.current = null;
    setDragTool(null);
  }, [object, active]);

  useEffect(() => () => {
    dragToolRef.current = null;
    poseLockRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;
    onDraggingChange?.(false);
  }, [onDraggingChange]);

  useLayoutEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      styleGizmo(rotateRef.current, 'rotate');
      styleGizmo(translateRef.current, 'translate');
      if (!dragToolRef.current) {
        // Prefer the active UI mode for picking, but keep the other tool available.
        setControlsEnabled(translateRef.current, true);
        setControlsEnabled(rotateRef.current, true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [ready, mode, object, dragTool]);

  if (!ready || !object) return null;

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
    poseLockRef.current = {
      rotation: object.rotation.clone(),
      position: object.position.clone(),
    };
  };

  const endDrag = (tool: Tool) => {
    if (dragToolRef.current && dragToolRef.current !== tool) return;
    if (tool === 'translate') {
      const lock = poseLockRef.current;
      if (lock) object.rotation.copy(lock.rotation);
      // Record keys only on pointer-up — mid-drag onMove is live pose only.
      onMove(readPosition(object), { recordKeys: true });
    } else {
      const lock = poseLockRef.current;
      if (lock) object.position.copy(lock.position);
      // Final commit after quaternion drag (keys recorded here, not on every frame).
      onRotate(readRotation(object), { recordKeys: true });
    }
    dragToolRef.current = null;
    poseLockRef.current = null;
    setDragTool(null);
    setControlsEnabled(translateRef.current, true);
    setControlsEnabled(rotateRef.current, true);
    onDraggingChange?.(false);
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  const translateEnabled = dragTool === null || dragTool === 'translate';
  const rotateEnabled = dragTool === null || dragTool === 'rotate';

  const translateSize = mode === 'translate' || dragTool === 'translate' ? 2.55 : 2.35;
  // Larger rings for hit area without mesh.scale distortion.
  const rotateSize = mode === 'rotate' || dragTool === 'rotate' ? 1.9 : 1.7;

  return (
    <>
      <TransformControls
        ref={rotateRef as never}
        object={object}
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
          // Keep position pinned; live-push Euler so linked dual panes stay in sync mid-drag.
          const lock = poseLockRef.current;
          if (lock) object.position.copy(lock.position);
          onRotate(readRotation(object), { recordKeys: false });
        }}
      />
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
          if (dragToolRef.current !== 'translate') return;
          const lock = poseLockRef.current;
          if (lock) object.rotation.copy(lock.rotation);
          // Live pose only — writing keyframes every frame caused an anim feedback loop.
          onMove(readPosition(object), { recordKeys: false });
        }}
      />
    </>
  );
}
