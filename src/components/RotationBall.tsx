import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { TransformControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
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
  /**
   * Empty-canvas / floor taps: kill any in-flight handle drag before
   * TransformControls can teleport the device from a fat picker behind the hit.
   */
  suppressGesture: () => void;
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

function markGizmoHandles(root: THREE.Object3D | undefined, tool: Tool) {
  root?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const line = child as THREE.Line;
    if (mesh.isMesh || line.isLine) {
      child.userData.isGizmoHandle = true;
      child.userData.gizmoTool = tool;
    }
  });
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
 * Keep stock TransformControls ring Lines (correct camera-facing bake) and only
 * thicken invisible pickers for hit area. Earlier custom full tori used picker
 * orientations under TC's line quaternions, so rings floated beside the device.
 */
function prepareGizmos(rotate: ControlsHandle | null, translate: ControlsHandle | null) {
  const rotateGroups = gizmoGroups(rotate);
  const rotateRoot = rotateGroups.gizmo?.rotate;
  const rotatePicker = rotateGroups.picker?.rotate;
  // Versioned so HMR clears leftover custom torus meshes / picker sizes.
  const PREP = 'stock-arcs-v5';
  if (rotate && rotateRoot && rotatePicker && rotate.userData.gizmoPrepared !== PREP) {
    for (const child of [...rotateRoot.children]) {
      if (child.userData.customRing) child.removeFromParent();
    }
    dropHandles(rotateRoot, ROTATE_DROP);
    dropHandles(rotatePicker, ROTATE_DROP);
    for (const child of rotatePicker.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      // Keep pickers tight — fat tubes steal empty-canvas / floor taps and
      // make the gimbal jump when TransformControls still wins the raycast.
      const major = child.name === 'E' ? 1.15 : 1;
      const tube = child.name === 'E' ? 0.04 : 0.05;
      if (!mesh.userData.torusThickened) {
        thickenTorus(mesh.geometry, major, tube);
        mesh.userData.torusThickened = true;
      }
    }
    markGizmoHandles(rotatePicker, 'rotate');
    markGizmoHandles(rotateRoot, 'rotate');
    rotate.userData.gizmoPrepared = PREP;
  }

  const translateGroups = gizmoGroups(translate);
  const translateRoot = translateGroups.gizmo?.translate;
  const translatePicker = translateGroups.picker?.translate;
  if (translate && translateRoot && translatePicker && translate.userData.gizmoPrepared !== PREP) {
    dropHandles(translateRoot, TRANSLATE_DROP);
    dropHandles(translatePicker, TRANSLATE_DROP);
    // Stock cones are thin in screen space; fatten invisible pickers so
    // coloured arrows stay grabbable without needing to zoom in. Keep the
    // boost radial (X/Z) so shafts don't overlap into free multi-axis drags.
    for (const handle of translatePicker.children) {
      handle.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.pickerEnlarged) return;
        mesh.scale.x *= 2.2;
        mesh.scale.z *= 2.2;
        mesh.scale.y *= 1.15;
        mesh.userData.pickerEnlarged = true;
      });
    }
    // Mark the whole picker tree (handle groups + cylinder meshes) so scene
    // raycasts classify arrow grabs as gizmo hits, not empty canvas / body.
    markGizmoHandles(translatePicker, 'translate');
    markGizmoHandles(translateRoot, 'translate');
    translate.userData.gizmoPrepared = PREP;
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
        const m = mat as THREE.MeshBasicMaterial & { tempOpacity?: number; userData: { gimbalBaseOpacity?: number } };
        m.depthTest = false;
        m.transparent = true;
        m.toneMapped = false;
        // TransformControls fades rings that are not under the pointer. Remember
        // the authored opacity so that fade cannot permanently hide the gimbal.
        const sample = Math.max(m.tempOpacity ?? 0, m.opacity ?? 0);
        if (m.userData.gimbalBaseOpacity == null && sample >= 0.4) {
          m.userData.gimbalBaseOpacity = sample;
        }
        const base = m.userData.gimbalBaseOpacity ?? sample;
        if (base < 0.4) {
          m.opacity = 0;
          m.visible = false;
        } else {
          m.visible = true;
        }
        m.needsUpdate = true;
      }
    }

    // Stock helper AXIS lines are 1e6 units long — with depthTest off they read
    // as red/blue streaks shooting off the device ("gizmo left the center").
    if ((child as THREE.Object3D & { tag?: string }).tag === 'helper' || child.name === 'AXIS') {
      child.visible = false;
      return;
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

/**
 * Dual TransformControls on one canvas: both can start a drag on the same
 * pointerdown before beginDrag disables the loser. The disabled control then
 * skips pointerup (enabled gate), leaving dragging=true + a document move
 * listener. Re-enable later and the next move teleports the device.
 *
 * @param restoreStart When true, snap the object back to the drag-start pose
 * (cancel / fat-picker false start). When false, only clear listeners — used
 * after a real endDrag commit so we do not wipe the rotation the user just made.
 */
function abortControlsDrag(controls: ControlsHandle | null, restoreStart = true) {
  if (!controls) return;
  const rig = controls as RotateRig & {
    onPointerMove?: (event: PointerEvent) => void;
    onPointerUp?: (event: PointerEvent) => void;
    domElement?: HTMLElement | null;
    positionStart?: THREE.Vector3;
    quaternionStart?: THREE.Quaternion;
    scaleStart?: THREE.Vector3;
  };
  // Empty-canvas taps that grazed a fat picker must not leave the device
  // teleported — but a finished axis drag already wrote the pose to React;
  // restoring here snaps the phone back to front and the layout sync skips
  // re-applying because rotation deps did not change.
  if (
    restoreStart
    && rig.dragging
    && rig.object
    && rig.positionStart
    && rig.quaternionStart
    && rig.scaleStart
  ) {
    rig.object.position.copy(rig.positionStart);
    rig.object.quaternion.copy(rig.quaternionStart);
    rig.object.scale.copy(rig.scaleStart);
  }
  rig.dragging = false;
  rig.axis = null;
  const doc = rig.domElement?.ownerDocument;
  if (doc && rig.onPointerMove) {
    doc.removeEventListener('pointermove', rig.onPointerMove);
  }
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
 * drag whips the device. Prefer the pointer's arc around the ring (Spline-like
 * 1:1), and only scale the linear gain when the arc is unavailable.
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
    const unit = controls.unit?.[axis];
    const quatStart = controls.quaternionStart;
    const worldQuat = controls.worldQuaternionStart;
    if (!unit || !quatStart || !worldQuat) return;

    worldAxis.copy(unit).applyQuaternion(worldQuat);
    const raw = controls.rotationAngle ?? 0;
    let angle = raw;

    const start = controls.pointStart;
    const end = controls.pointEnd;
    if (start && end && start.lengthSq() > 1e-6 && end.lengthSq() > 1e-6) {
      const arc = start.angleTo(end);
      arcStart.copy(start);
      arcEnd.copy(end);
      const sign = arcStart.cross(arcEnd).dot(worldAxis) >= 0 ? 1 : -1;
      if (Number.isFinite(arc)) angle = sign * arc;
    } else if (Number.isFinite(raw) && raw !== 0) {
      const distance = controls.worldPosition && controls.cameraPosition
        ? Math.max(0.5, controls.worldPosition.distanceTo(controls.cameraPosition))
        : 6;
      const fov = (controls.camera as THREE.PerspectiveCamera | undefined)?.fov ?? 38;
      const zoom = (controls.camera as THREE.PerspectiveCamera | undefined)?.zoom || 1;
      const k = 1.9 * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      const factor = distance * Math.min(k / zoom, 7);
      const ringRadius = Math.max(0.2, factor * (controls.size ?? 1) / 7);
      const scale = THREE.MathUtils.clamp(distance / (20 * ringRadius), 0.35, 0.85);
      angle = raw * scale;
    } else {
      return;
    }

    object.quaternion.copy(quatStart);
    object.quaternion.multiply(easedQuat.setFromAxisAngle(unit, angle)).normalize();
    controls.rotationAngle = angle;
    (controls.dispatchEvent as (event: { type: 'objectChange' }) => void)({ type: 'objectChange' });
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
  const [suppressed, setSuppressed] = useState(false);
  const dragToolRef = useRef<Tool | null>(null);
  const listeningRef = useRef(true);
  const suppressedRef = useRef(false);
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

  // Keep the rotate pivot glued to the translate origin every frame so a
  // leftover local offset cannot park the rings beside the device.
  useFrame(() => {
    if (!rotationObject) return;
    if (rotationObject.position.lengthSq() > 1e-12) {
      rotationObject.position.set(0, 0, 0);
    }
  });

  // Keep OrbitControls off for the whole gimbal drag — beginDrag alone can lose
  // the race to OrbitControls on the same pointerdown.
  useEffect(() => {
    if (!ready) return undefined;
    const lockOrbit = (event: { value?: boolean }) => {
      if (orbitRef.current) orbitRef.current.enabled = !event.value;
    };
    const rotate = rotateRef.current as (ControlsHandle & {
      addEventListener?: (type: string, fn: (e: { value?: boolean }) => void) => void;
      removeEventListener?: (type: string, fn: (e: { value?: boolean }) => void) => void;
    }) | null;
    const translate = translateRef.current as (ControlsHandle & {
      addEventListener?: (type: string, fn: (e: { value?: boolean }) => void) => void;
      removeEventListener?: (type: string, fn: (e: { value?: boolean }) => void) => void;
    }) | null;
    rotate?.addEventListener?.('dragging-changed', lockOrbit);
    translate?.addEventListener?.('dragging-changed', lockOrbit);
    return () => {
      rotate?.removeEventListener?.('dragging-changed', lockOrbit);
      translate?.removeEventListener?.('dragging-changed', lockOrbit);
      if (orbitRef.current) orbitRef.current.enabled = true;
    };
  }, [ready, targets]);

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
      suppressGesture() {
        const wasDragging = Boolean(dragToolRef.current);
        abortControlsDrag(translateRef.current);
        abortControlsDrag(rotateRef.current);
        dragToolRef.current = null;
        setDragTool(null);
        suppressedRef.current = true;
        setSuppressed(true);
        setControlsEnabled(translateRef.current, false);
        setControlsEnabled(rotateRef.current, false);
        if (wasDragging) {
          onDraggingChange?.(false);
          if (orbitRef.current) orbitRef.current.enabled = true;
        }
        // Re-arm after this pointer finishes so the next handle grab works.
        const rearm = () => {
          window.removeEventListener('pointerup', rearm, true);
          window.removeEventListener('pointercancel', rearm, true);
          suppressedRef.current = false;
          setSuppressed(false);
          if (!listeningRef.current || dragToolRef.current) return;
          setControlsEnabled(translateRef.current, true);
          setControlsEnabled(rotateRef.current, true);
        };
        window.addEventListener('pointerup', rearm, true);
        window.addEventListener('pointercancel', rearm, true);
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, onDraggingChange]);

  if (!ready || !positionObject || !rotationObject) return null;

  const beginDrag = (tool: Tool) => {
    // Axis arrows share space with the rings. Prefer translate when both fire
    // on the same click — otherwise rotate wins the listener race and the
    // arrows feel dead for left/right/up/down moves.
    if (dragToolRef.current && dragToolRef.current !== tool) {
      if (!(tool === 'translate' && dragToolRef.current === 'rotate')) return;
      abortControlsDrag(rotateRef.current);
      setControlsEnabled(rotateRef.current, false);
    }
    dragToolRef.current = tool;
    setDragTool(tool);
    onDraggingChange?.(true);
    if (orbitRef.current) orbitRef.current.enabled = false;

    if (tool === 'translate') {
      abortControlsDrag(rotateRef.current);
      setControlsEnabled(rotateRef.current, false);
      setControlsEnabled(translateRef.current, true);
    } else {
      abortControlsDrag(translateRef.current);
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
      // Rings must not leave a local offset on the rotate pivot.
      rotationObject.position.set(0, 0, 0);
    }
    dragToolRef.current = null;
    setDragTool(null);
    // Pose already committed — clear TC listeners without restoring drag-start.
    abortControlsDrag(translateRef.current, false);
    abortControlsDrag(rotateRef.current, false);
    setControlsEnabled(translateRef.current, true);
    setControlsEnabled(rotateRef.current, true);
    onDraggingChange?.(false);
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  const translateEnabled = listening && !suppressed && (dragTool === null || dragTool === 'translate');
  const rotateEnabled = listening && !suppressed && (dragTool === null || dragTool === 'rotate');

  // Keep sizes stable during a drag — resizing mid-gesture breaks TC's plane math
  // and makes axis arrows feel like they stopped working.
  const translateSize = mode === 'translate' ? 1.35 : 1.2;
  const rotateSize = mode === 'rotate' ? 0.48 : 0.42;

  return (
    <>
      {/* Translate mounts first so its pointerdown runs before rotate when an
          arrow shaft crosses a ring — otherwise rotate disables translate and
          the coloured arrows never get the gesture. */}
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
          const rig = translateRef.current as (ControlsHandle & { dragging?: boolean }) | null;
          // Trust the control's own drag flag — snapping back whenever
          // dragToolRef lagged killed real arrow moves mid-gesture.
          if (rig?.dragging) {
            if (dragToolRef.current !== 'translate') beginDrag('translate');
            onMove(readPosition(positionObject), { recordKeys: false });
            return;
          }
          if (dragToolRef.current !== 'translate') {
            abortControlsDrag(translateRef.current);
            return;
          }
          onMove(readPosition(positionObject), { recordKeys: false });
        }}
      />
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
          const rig = rotateRef.current as (ControlsHandle & { dragging?: boolean }) | null;
          if (rig?.dragging) {
            if (dragToolRef.current !== 'rotate') beginDrag('rotate');
            onRotate(readRotation(rotationObject), { recordKeys: false });
            return;
          }
          // Spurious dual-control / fat-picker drags move the pivot without
          // beginDrag — snap back so the gimbal cannot teleport off-body.
          if (dragToolRef.current !== 'rotate') {
            abortControlsDrag(rotateRef.current);
            return;
          }
          onRotate(readRotation(rotationObject), { recordKeys: false });
        }}
      />
    </>
  );
}
