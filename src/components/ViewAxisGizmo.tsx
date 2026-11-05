import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CameraView, Vec3 } from '../types';

const VIEWS: CameraView[] = ['front', 'right', 'top', 'left'];

const AXIS_COLOR = {
  x: '#f04b4b',
  y: '#63c45a',
  z: '#3c8dff',
} as const;

const NEGATIVE = '#8d939b';
const HUB = '#8b9286';
const ARM = 17.5;

type AxisId = keyof typeof AXIS_COLOR;

const VIEW_FOR_POLE: Record<string, CameraView | null> = {
  'x+': 'right',
  'x-': 'left',
  'y+': 'top',
  'y-': null,
  'z+': 'front',
  'z-': null,
};

const AXIS_VECTOR: Record<AxisId, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function cameraOffset(view: CameraView): Vec3 {
  if (view === 'left') return { x: -1, y: 0, z: 0 };
  if (view === 'right') return { x: 1, y: 0, z: 0 };
  if (view === 'top') return { x: 0, y: 1, z: 0.04 };
  return { x: 0, y: 0, z: 1 };
}

export function nextCameraView(view: CameraView): CameraView {
  const index = VIEWS.indexOf(view);
  return VIEWS[(index + 1) % VIEWS.length];
}

function viewQuaternion(view: CameraView, orbitOffset: Vec3 | null | undefined, deviceRotation: Vec3) {
  const source = orbitOffset && (orbitOffset.x || orbitOffset.y || orbitOffset.z)
    ? orbitOffset
    : cameraOffset(view);
  const cam = new THREE.Vector3(source.x, source.y, source.z);
  if (cam.lengthSq() < 1e-6) cam.set(0, 0, 1);
  const up = Math.abs(cam.y) > cam.length() * 0.92
    ? new THREE.Vector3(0, 0, -1)
    : new THREE.Vector3(0, 1, 0);
  const qView = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(cam, new THREE.Vector3(0, 0, 0), up),
  ).invert();
  const qDevice = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(deviceRotation.x),
    THREE.MathUtils.degToRad(deviceRotation.y),
    THREE.MathUtils.degToRad(deviceRotation.z),
    'XYZ',
  ));
  return qView.multiply(qDevice);
}

interface Props {
  view: CameraView;
  deviceRotation: Vec3;
  orbitOffset?: Vec3 | null;
  onSelectView: (view: CameraView) => void;
}

interface Pole {
  id: string;
  axis: AxisId;
  sign: 1 | -1;
  color: string;
  view: CameraView | null;
  x: number;
  y: number;
  z: number;
}

/** Corner axis. Tap a stem to face that direction. */
export default function ViewAxisGizmo({ view, deviceRotation, orbitOffset, onSelectView }: Props) {
  const targetQ = useMemo(
    () => viewQuaternion(view, orbitOffset, deviceRotation),
    [
      view,
      orbitOffset?.x, orbitOffset?.y, orbitOffset?.z,
      deviceRotation.x, deviceRotation.y, deviceRotation.z,
    ],
  );
  const displayRef = useRef(targetQ.clone());
  const animGen = useRef(0);
  const animateNext = useRef(false);
  const [, setFrame] = useState(0);
  const [pressed, setPressed] = useState<string | null>(null);

  useEffect(() => {
    const to = targetQ;
    const from = displayRef.current.clone();
    const gen = ++animGen.current;
    if (!animateNext.current || from.angleTo(to) < 0.03) {
      animateNext.current = false;
      displayRef.current.copy(to);
      setFrame((n) => n + 1);
      return;
    }
    animateNext.current = false;
    const start = performance.now();
    const duration = 520;
    const step = (now: number) => {
      if (animGen.current !== gen) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      displayRef.current.copy(from).slerp(to, eased);
      setFrame((n) => n + 1);
      if (t < 1) requestAnimationFrame(step);
    };
    const handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [targetQ]);

  const poles = (() => {
    const q = displayRef.current;
    const built: Pole[] = (Object.keys(AXIS_COLOR) as AxisId[]).flatMap((axis) => (
      ([1, -1] as const).map((sign) => {
        const id = `${axis}${sign > 0 ? '+' : '-'}`;
        const dir = AXIS_VECTOR[axis].clone().multiplyScalar(sign).applyQuaternion(q);
        return {
          id,
          axis,
          sign,
          color: sign > 0 ? AXIS_COLOR[axis] : NEGATIVE,
          view: VIEW_FOR_POLE[id] ?? null,
          x: dir.x,
          y: -dir.y,
          z: dir.z,
        };
      })
    ));
    built.sort((a, b) => a.z - b.z);
    return built;
  })();

  const nudge = (axis: AxisId) => {
    const gen = ++animGen.current;
    const from = displayRef.current.clone();
    const swing = new THREE.Quaternion().setFromAxisAngle(AXIS_VECTOR[axis], 0.7);
    const mid = swing.multiply(from.clone());
    const start = performance.now();
    const step = (now: number) => {
      if (animGen.current !== gen) return;
      const t = Math.min(1, (now - start) / 480);
      const ping = Math.sin(t * Math.PI);
      displayRef.current.copy(from).slerp(mid, ping);
      setFrame((n) => n + 1);
      if (t < 1) requestAnimationFrame(step);
      else displayRef.current.copy(from);
    };
    requestAnimationFrame(step);
  };

  const activate = (pole: Pole) => {
    setPressed(pole.id);
    window.setTimeout(() => setPressed((current) => (current === pole.id ? null : current)), 480);
    if (pole.view && pole.view !== view) {
      animateNext.current = true;
      onSelectView(pole.view);
      return;
    }
    nudge(pole.axis);
  };

  return (
    <div className="view-axis" role="group" aria-label="Camera axis">
      <svg viewBox="0 0 64 64" width="74" height="74">
        {poles.map((pole) => {
          const sx = pole.x * ARM;
          const sy = pole.y * ARM;
          const dist = Math.hypot(sx, sy);
          if (dist < 5.5) return null;
          const ux = sx / dist;
          const uy = sy / dist;
          const dot = pole.sign > 0 ? 3.15 : 2.85;
          const stem = Math.max(0, dist - dot - 0.6);
          const label = pole.view
            ? `${pole.view[0].toUpperCase()}${pole.view.slice(1)} view`
            : `${pole.axis.toUpperCase()} ${pole.sign > 0 ? 'positive' : 'negative'} axis`;
          return (
            <g
              key={pole.id}
              className={`view-axis-pole ${pressed === pole.id ? 'is-pressed' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              onClick={() => activate(pole)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Spacebar') {
                  event.preventDefault();
                  return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                activate(pole);
              }}
            >
              <line
                x1={32}
                y1={32}
                x2={32 + ux * stem}
                y2={32 + uy * stem}
                stroke={pole.color}
                strokeWidth={pole.sign > 0 ? 1.8 : 1.45}
                strokeLinecap="round"
              />
              <line
                x1={32}
                y1={32}
                x2={32 + sx}
                y2={32 + sy}
                stroke="transparent"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <circle cx={32 + sx} cy={32 + sy} r={dot + 4.5} fill="transparent" />
              <circle className="view-axis-dot" cx={32 + sx} cy={32 + sy} r={dot} fill={pole.color} />
            </g>
          );
        })}
        <circle cx="32" cy="32" r="4.5" fill={HUB} style={{ pointerEvents: 'none' }} />
      </svg>
    </div>
  );
}
