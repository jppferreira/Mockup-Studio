import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
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
  controlRef?: MutableRefObject<GizmoControl | null>;
}

type Tool = 'translate' | 'rotate';

type ControlsHandle = THREE.Object3D & {
  enabled?: boolean;
  gizmo?: Record<string, THREE.Object3D>;
  picker?: Record<string, THREE.Object3D>;
  getHelper?: () => THREE.Object3D;
  _root?: THREE.Object3D;
};

export type GizmoControl = {
  /** Imperatively enable or disable both gizmos (body-drag must win on the same click). */
  setEnabled: (enabled: boolean) => void;
};

const ROTATE_DROP = new Set(['XYZE']);
const TRANSLATE_DROP = new Set(['XY', 'YZ', 'XZ', 'XYZ']);

function dropHandles(root: THREE.Object3D | undefined, names: Set<string>) {
  if (!root) return;
  for (const child of [...root.children]) {
    if (names.has(child.name)) child.removeFromParent();
  }
}

/** Widen ring pickers in place so the gimbal is grabbable without covering the device. */
function thickenTorus(geometry: THREE.BufferGeometry, major: number, tube: number) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const normal = new THREE.Vector3(1, 0, 0);
  if (size.y <= size.x && size.y <= size.z) normal.set(0, 1, 0);
  else if (size.z <= size.x && size.z <= size.y) normal.set(0, 0, 1);

  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const center = new THREE.Vector3();
  const radial = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
    const along = normal.dot(vertex);
    center.copy(vertex).addScaledVector(normal, -along);
    if (center.lengthSq() < 1e-8) continue;
    center.setLength(major);
    radial.copy(vertex).sub(center);
    if (radial.lengthSq() < 1e-8) continue;
    radial.setLength(tube);
    vertex.copy(center).add(radial);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function markGizmoHandles(root: THREE.Object3D | undefined) {
  root?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const line = child as THREE.Line;
    if (mesh.isMesh || line.isLine) child.userData.isGizmoHandle = true;
  });
}

function addVisibleRing(
  root: THREE.Object3D,
  name: string,
  radius: number,
  tube: number,
  color: number,
  rotation: [number, number, number] | null,
) {
  const geometry = new THREE.TorusGeometry(radius, tube, 10, 64);
  if (rotation) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    ));
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
    toneMapped: false,
    side: THREE.DoubleSide,
    fog: false,
  }));
  mesh.name = name;
  mesh.renderOrder = 1000;
  mesh.userData.isGizmoHandle = true;
  mesh.userData.customRing = true;
  root.add(mesh);
}

function gizmoGroups(controls: ControlsHandle | null) {
  const root = controls?.gizmo as (THREE.Object3D & {
    gizmo?: Record<string, THREE.Object3D>;
    picker?: Record<string, THREE.Object3D>;
  }) | undefined;
  return {
    gizmo: root?.gizmo,
    picker: root?.picker,
  };
}

/**
 * The stock gizmo hides a grab sphere in the middle and thin 1px rings.
 * Drop the center ball and translate planes so the device body can be dragged,
 * and draw rings fat enough to hit.
 */
function prepareGizmos(rotate: ControlsHandle | null, translate: ControlsHandle | null) {
  const rotateGroups = gizmoGroups(rotate);
  const rotateRoot = rotateGroups.gizmo?.rotate;
  const rotatePicker = rotateGroups.picker?.rotate;
  if (rotate && rotateRoot && rotatePicker && !rotate.userData.gizmoPrepared) {
    dropHandles(rotateRoot, ROTATE_DROP);
    dropHandles(rotatePicker, ROTATE_DROP);
    for (const child of rotatePicker.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      // Wide enough to grab, still a band so the arrow tips stay reachable.
      const major = child.name === 'E' ? 1.2 : 1;
      const tube = child.name === 'E' ? 0.11 : 0.16;
      thickenTorus(mesh.geometry, major, tube);
      mesh.userData.isGizmoHandle = true;
    }
    // Match the picker tori. The gizmo rewrites each handle's quaternion
    // every frame, so a ring stays under the cursor only when its baked
    // shape matches the invisible picker of the same name.
    addVisibleRing(rotateRoot, 'X', 1, 0.04, 0xff3355, [0, -Math.PI / 2, -Math.PI / 2]);
    addVisibleRing(rotateRoot, 'Y', 1, 0.04, 0x35d36a, [Math.PI / 2, 0, 0]);
    addVisibleRing(rotateRoot, 'Z', 1, 0.04, 0x3c7dff, [0, 0, -Math.PI / 2]);
    addVisibleRing(rotateRoot, 'E', 1.25, 0.026, 0xf0c84b, null);
    for (const child of [...rotateRoot.children]) {
      if (!child.userData.customRing) child.removeFromParent();
    }
    markGizmoHandles(rotateRoot);
    rotate.userData.gizmoPrepared = true;
  }

  const translateGroups = gizmoGroups(translate);
  const translateRoot = translateGroups.gizmo?.translate;
  const translatePicker = translateGroups.picker?.translate;
  if (translate && translateRoot && translatePicker && !translate.userData.gizmoPrepared) {
    dropHandles(translateRoot, TRANSLATE_DROP);
    dropHandles(translatePicker, TRANSLATE_DROP);
    for (const child of translatePicker.children) {
      child.userData.isGizmoHandle = true;
    }
    markGizmoHandles(translateRoot);
    translate.userData.gizmoPrepared = true;
  }
}

/**
 * Clean up picker planes and keep axis handles readable.
 * Avoid non-uniform scale boosts — fat overlapping pickers make
 * one-axis moves feel like free multi-angle dragging.
 */
function styleGizmo(controls: ControlsHandle | null | undefined, kind: Tool) {
  if (!controls) return;
  const root = controls.getHelper?.() ?? controls._root ?? controls;

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
    }

    const line = child as THREE.LineSegments;
    if (line.isLineSegments || (child as THREE.Line).isLine) {
      const mat = line.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.depthTest = false;
        mat.transparent = true;
        mat.opacity = 1;
        mat.linewidth = 2;
        mat.needsUpdate = true;
      }
    }
  });
}

function setControlsEnabled(controls: ControlsHandle | null, enabled: boolean) {
  if (!controls) return;
  controls.enabled = enabled;
}

type RotateRig = ControlsHandle & {
  pointerMove?: (pointer: { x: number; y: number; button: number }) => void;
  pointStart?: THREE.Vector3;
  pointEnd?: THREE.Vector3;
  quaternionStart?: THREE.Quaternion;
  worldQuaternionStart?: THREE.Quaternion;
  worldPosition?: THREE.Vector3;
  cameraPosition?: THREE.Vector3;
  camera?: THREE.Camera;
  eye?: THREE.Vector3;
  object?: THREE.Object3D;
  axis?: string | null;
  mode?: string;
  dragging?: boolean;
  space?: string;
  size?: number;
  rotationAngle?: number;
  unit?: { X: THREE.Vector3; Y: THREE.Vector3; Z: THREE.Vector3 };
};

const easedQuat = new THREE.Quaternion();
const worldAxis = new THREE.Vector3();
const arcStart = new THREE.Vector3();
const arcEnd = new THREE.Vector3();

/**
 * Stock axis rings spin from a fixed gain (20 / camera distance), so a short
 * drag whips the device. Scale that gain down to about one radian per
 * ring-radius of travel, and fall back to the pointer's arc when the axis
 * faces the camera (the linear gain blows up there).
 */
function easeGimbalRotation(controls: RotateRig | null) {
  if (!controls?.pointerMove || controls.userData.gimbalEased) return;
  controls.userData.gimbalEased = true;
  const original = controls.pointerMove.bind(controls);
  controls.pointerMove = (pointer) => {
    original(pointer);
    const axis = controls.axis;
    const object = controls.object;
    if (controls.mode !== 'rotate' || !controls.dragging || !object) return;
    if (axis !== 'X' && axis !== 'Y' && axis !== 'Z') return;
    if (controls.space !== 'local') return;
    const unit = controls.unit?.[axis];
    const quatStart = controls.quaternionStart;
    const worldQuat = controls.worldQuaternionStart;
    const eye = controls.eye;
    if (!unit || !quatStart || !worldQuat || !eye) return;

    worldAxis.copy(unit).applyQuaternion(worldQuat);
    const facing = Math.abs(worldAxis.dot(eye));
    const raw = controls.rotationAngle ?? 0;
    let angle = raw;

    const start = controls.pointStart;
    const end = controls.pointEnd;
    const linearBroken = !Number.isFinite(raw) || facing > 0.99;
    if (linearBroken && start && end && start.lengthSq() > 1e-6 && end.lengthSq() > 1e-6) {
      const arc = start.angleTo(end);
      arcStart.copy(start);
      arcEnd.copy(end);
      const sign = arcStart.cross(arcEnd).dot(worldAxis) >= 0 ? 1 : -1;
      angle = Number.isFinite(arc) ? sign * arc : 0;
    } else if (Number.isFinite(raw) && raw !== 0) {
      const distance = controls.worldPosition && controls.cameraPosition
        ? Math.max(0.5, controls.worldPosition.distanceTo(controls.cameraPosition))
        : 6;
      const fov = (controls.camera as THREE.PerspectiveCamera | undefined)?.fov ?? 38;
      const zoom = (controls.camera as THREE.PerspectiveCamera | undefined)?.zoom || 1;
      const k = 1.9 * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      const factor = distance * Math.min(k / zoom, 7);
      // three-stdlib scales rotate handles by factor * size / 7.
      const ringRadius = Math.max(0.2, factor * (controls.size ?? 1) / 7);
      // Current angle is offset * 20 / distance. Want about offset / ringRadius.
      const scale = THREE.MathUtils.clamp(distance / (20 * ringRadius), 0.2, 0.6);
      angle = raw * scale;
    } else {
      return;
    }

    object.quaternion.copy(quatStart);
    object.quaternion.multiply(easedQuat.setFromAxisAngle(unit, angle)).normalize();
    controls.rotationAngle = angle;
    controls.dispatchEvent({ type: 'objectChange' });
  };
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
  controlRef,
}: Props) {
  const { controls } = useThree();
  const rotateRef = useRef<ControlsHandle | null>(null);
  const translateRef = useRef<ControlsHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [dragTool, setDragTool] = useState<Tool | null>(null);
  const [listening, setListening] = useState(true);
  const dragToolRef = useRef<Tool | null>(null);
  const listeningRef = useRef(true);
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
      prepareGizmos(rotateRef.current, translateRef.current);
      easeGimbalRotation(rotateRef.current);
      styleGizmo(rotateRef.current, 'rotate');
      styleGizmo(translateRef.current, 'translate');
      if (!dragToolRef.current) {
        const on = listeningRef.current;
        setControlsEnabled(translateRef.current, on);
        setControlsEnabled(rotateRef.current, on);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [ready, mode, targets, dragTool, listening]);

  useEffect(() => {
    if (!controlRef) return undefined;
    controlRef.current = {
      setEnabled(enabled: boolean) {
        listeningRef.current = enabled;
        setListening(enabled);
        if (dragToolRef.current) return;
        setControlsEnabled(translateRef.current, enabled);
        setControlsEnabled(rotateRef.current, enabled);
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

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

  const translateEnabled = listening && (dragTool === null || dragTool === 'translate');
  const rotateEnabled = listening && (dragTool === null || dragTool === 'rotate');

  // Arrow tips stay just past the rings so a move and a turn are different grabs.
  const translateSize = mode === 'translate' || dragTool === 'translate' ? 1.38 : 1.26;
  const rotateSize = mode === 'rotate' || dragTool === 'rotate' ? 1.18 : 1.08;

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
