import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec3 } from '../types';

/**
 * Spherical light pose relative to the device.
 * Azimuth 0° = in front of the screen (device local +Z after yaw).
 */
export function lightToSpherical(
  position: Vec3,
  focus: Vec3 = { x: 0, y: 0, z: 0 },
  /** Device yaw in degrees — keeps “Front” locked to the screen. */
  deviceYawDeg = 0,
) {
  const dx = position.x - focus.x;
  const dy = position.y - focus.y;
  const dz = position.z - focus.z;
  const distance = Math.max(0.5, Math.hypot(dx, dy, dz));

  const ry = (deviceYawDeg * Math.PI) / 180;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  // World → device local (undo yaw) so +Z is always screen-front
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;

  const azimuth = (Math.atan2(lx, lz) * 180) / Math.PI;
  const elevation = (Math.asin(Math.min(1, Math.max(-1, dy / distance))) * 180) / Math.PI;
  return { azimuth, elevation, distance };
}

/** Device-relative orbit → world light position. */
export function sphericalToLight(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
  focus: Vec3 = { x: 0, y: 0, z: 0 },
  deviceYawDeg = 0,
): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const r = Math.max(0.5, distance);
  const cosEl = Math.cos(el);
  const lx = Math.sin(az) * cosEl * r;
  const ly = Math.sin(el) * r;
  const lz = Math.cos(az) * cosEl * r;

  const ry = (deviceYawDeg * Math.PI) / 180;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  // Device local → world (apply yaw)
  return {
    x: Number((focus.x + lx * cos + lz * sin).toFixed(3)),
    y: Number((focus.y + ly).toFixed(3)),
    z: Number((focus.z - lx * sin + lz * cos).toFixed(3)),
  };
}

interface Props {
  position: Vec3;
  color?: string;
  /** Scene point the key light aims at (usually the selected device). */
  focus?: Vec3;
  /** Selected device yaw in degrees — Front on the pad = screen facing. */
  deviceYawDeg?: number;
  onChange: (position: Vec3) => void;
}

const MAX_DIST = 14;
const MIN_DIST = 2;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function LightDirectionControl({
  position,
  color = '#ffffff',
  focus = { x: 0, y: 0, z: 0 },
  deviceYawDeg = 0,
  onChange,
}: Props) {
  const spherical = useMemo(
    () => lightToSpherical(position, focus, deviceYawDeg),
    [position, focus, deviceYawDeg],
  );
  const topRef = useRef<HTMLDivElement>(null);
  const elevRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'top' | 'elev' | null>(null);

  const commitSpherical = useCallback((azimuth: number, elevation: number, distance: number) => {
    onChange(sphericalToLight(azimuth, elevation, distance, focus, deviceYawDeg));
  }, [deviceYawDeg, focus, onChange]);

  const updateFromTop = useCallback((clientX: number, clientY: number) => {
    const el = topRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Pad up = device front (local +Z); pad right = device local +X
    const nx = (clientX - cx) / (rect.width / 2);
    const nz = -(clientY - cy) / (rect.height / 2);
    const len = Math.hypot(nx, nz);
    if (len < 0.02) return;
    const capped = Math.min(1, len);
    const ux = (nx / len) * capped;
    const uz = (nz / len) * capped;
    const azimuth = (Math.atan2(ux, uz) * 180) / Math.PI;
    const distance = clamp(MIN_DIST + capped * (MAX_DIST - MIN_DIST), MIN_DIST, MAX_DIST);
    commitSpherical(azimuth, spherical.elevation, distance);
  }, [commitSpherical, spherical.elevation]);

  const updateFromElev = useCallback((clientY: number) => {
    const el = elevRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (clientY - rect.top) / rect.height;
    // Top of strip = +80°, bottom = -10°
    const elevation = clamp(80 - t * 90, -10, 80);
    commitSpherical(spherical.azimuth, elevation, spherical.distance);
  }, [commitSpherical, spherical.azimuth, spherical.distance]);

  const onTopPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging('top');
    updateFromTop(e.clientX, e.clientY);
  };
  const onElevPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging('elev');
    updateFromElev(e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragging === 'top') updateFromTop(e.clientX, e.clientY);
    if (dragging === 'elev') updateFromElev(e.clientY);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (dragging) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setDragging(null);
    }
  };

  // Azimuth 0 (device front) → top of pad; device silhouette always faces Front
  const topRadiusFrac = (spherical.distance - MIN_DIST) / (MAX_DIST - MIN_DIST);
  const azRad = (spherical.azimuth * Math.PI) / 180;
  const lightTopX = 50 + Math.sin(azRad) * topRadiusFrac * 42;
  const lightTopY = 50 - Math.cos(azRad) * topRadiusFrac * 42;
  const elevT = (80 - spherical.elevation) / 90;
  const lightElevY = clamp(elevT, 0, 1) * 100;

  return (
    <div className="light-direction">
      <div className="light-direction-diagrams" aria-label="Light direction relative to device">
        <div className="light-direction-pane">
          <div className="light-direction-pane-label">Top</div>
          <div
            ref={topRef}
            className={`light-direction-pad light-direction-top ${dragging === 'top' ? 'is-dragging' : ''}`}
            onPointerDown={onTopPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="slider"
            aria-label="Light azimuth and distance"
            aria-valuemin={-180}
            aria-valuemax={180}
            aria-valuenow={Math.round(spherical.azimuth)}
            tabIndex={0}
          >
            <svg viewBox="0 0 100 100" className="light-direction-svg" aria-hidden>
              <circle cx="50" cy="50" r="46" className="light-pad-ring" />
              <circle cx="50" cy="50" r="30" className="light-pad-ring light-pad-ring-mid" />
              <circle cx="50" cy="50" r="14" className="light-pad-ring light-pad-ring-inner" />
              <line x1="50" y1="4" x2="50" y2="10" className="light-pad-tick" />
              <line x1="50" y1="90" x2="50" y2="96" className="light-pad-tick" />
              <line x1="4" y1="50" x2="10" y2="50" className="light-pad-tick" />
              <line x1="90" y1="50" x2="96" y2="50" className="light-pad-tick" />
              <text x="50" y="16" textAnchor="middle" className="light-pad-compass">Front</text>
              <line
                x1={lightTopX}
                y1={lightTopY}
                x2="50"
                y2="50"
                className="light-pad-beam"
                style={{ stroke: color }}
              />
              {/* Top-down phone: thin depth, front edge always toward Front */}
              <rect x="42" y="46.5" width="16" height="7" rx="1.4" className="light-pad-device" />
              <rect x="43.5" y="46.5" width="13" height="2.2" rx="0.4" className="light-pad-screen" />
            </svg>
            <span
              className="light-pad-sun"
              style={{
                left: `${lightTopX}%`,
                top: `${lightTopY}%`,
                background: color,
                boxShadow: `0 0 10px ${color}aa, 0 0 2px ${color}`,
              }}
              aria-hidden
            />
          </div>
        </div>

        <div className="light-direction-pane">
          <div className="light-direction-pane-label">Side</div>
          <div
            ref={elevRef}
            className={`light-direction-pad light-direction-elev ${dragging === 'elev' ? 'is-dragging' : ''}`}
            onPointerDown={onElevPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="slider"
            aria-label="Light elevation"
            aria-valuemin={-10}
            aria-valuemax={80}
            aria-valuenow={Math.round(spherical.elevation)}
            tabIndex={0}
          >
            <svg viewBox="0 0 44 100" className="light-direction-svg" aria-hidden>
              <line x1="22" y1="8" x2="22" y2="92" className="light-pad-ring" />
              <line
                x1="22"
                y1={lightElevY}
                x2="22"
                y2="72"
                className="light-pad-beam"
                style={{ stroke: color }}
              />
              {/* Side view: screen faces right (toward typical camera / front) */}
              <rect x="14" y="64" width="5" height="20" rx="1.2" className="light-pad-device" />
              <rect x="18.2" y="66" width="2" height="16" rx="0.5" className="light-pad-screen" />
              <text x="6" y="14" className="light-pad-compass">Up</text>
            </svg>
            <span
              className="light-pad-sun"
              style={{
                left: '50%',
                top: `${lightElevY}%`,
                background: color,
                boxShadow: `0 0 10px ${color}aa, 0 0 2px ${color}`,
              }}
              aria-hidden
            />
          </div>
        </div>
      </div>

      <div className="light-direction-sliders">
        <label className="slider-field">
          <span className="slider-label">Angle</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={Math.round(spherical.azimuth)}
            style={{ ['--slider-fill' as string]: `${((spherical.azimuth + 180) / 360) * 100}%` }}
            onChange={(e) => commitSpherical(Number(e.target.value), spherical.elevation, spherical.distance)}
            aria-label="Light angle around device"
          />
          <span className="slider-number" data-scrub title="Drag left or right to adjust. Shift for finer steps.">
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              value={Math.round(spherical.azimuth)}
              aria-label="Light angle around device"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                commitSpherical(next, spherical.elevation, spherical.distance);
              }}
            />
            <span className="slider-number-unit">°</span>
          </span>
        </label>
        <label className="slider-field">
          <span className="slider-label">Height</span>
          <input
            type="range"
            min={-10}
            max={80}
            step={1}
            value={Math.round(spherical.elevation)}
            style={{ ['--slider-fill' as string]: `${((spherical.elevation + 10) / 90) * 100}%` }}
            onChange={(e) => commitSpherical(spherical.azimuth, Number(e.target.value), spherical.distance)}
            aria-label="Light height angle"
          />
          <span className="slider-number" data-scrub title="Drag left or right to adjust. Shift for finer steps.">
            <input
              type="number"
              min={-10}
              max={80}
              step={1}
              value={Math.round(spherical.elevation)}
              aria-label="Light height angle"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                commitSpherical(spherical.azimuth, next, spherical.distance);
              }}
            />
            <span className="slider-number-unit">°</span>
          </span>
        </label>
        <label className="slider-field">
          <span className="slider-label">Distance</span>
          <input
            type="range"
            min={MIN_DIST}
            max={MAX_DIST}
            step={0.1}
            value={Number(spherical.distance.toFixed(1))}
            style={{ ['--slider-fill' as string]: `${((spherical.distance - MIN_DIST) / (MAX_DIST - MIN_DIST)) * 100}%` }}
            onChange={(e) => commitSpherical(spherical.azimuth, spherical.elevation, Number(e.target.value))}
            aria-label="Light distance"
          />
          <span className="slider-number" data-scrub title="Drag left or right to adjust. Shift for finer steps.">
            <input
              type="number"
              min={MIN_DIST}
              max={MAX_DIST}
              step={0.1}
              value={spherical.distance.toFixed(1)}
              aria-label="Light distance"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                commitSpherical(spherical.azimuth, spherical.elevation, next);
              }}
            />
          </span>
        </label>
      </div>
    </div>
  );
}
