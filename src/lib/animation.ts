import type {
  AnimEase,
  AnimKeyframe,
  AnimProperty,
  AnimTrack,
  AnimationClip,
  CameraView,
  DeviceInstance,
  EaseBezier,
  Vec3,
} from '../types';
import { CAMERA_TARGET_ID, DEFAULT_CUSTOM_BEZIER, PRESET_BEZIERS } from '../types';

export function isCameraProperty(property: AnimProperty) {
  return property === 'camera.x' || property === 'camera.y' || property === 'camera.z';
}

export function defaultCameraPosition(view: CameraView, split: boolean): Vec3 {
  const z = split ? 7.4 : 5.7;
  const positions: Record<CameraView, Vec3> = {
    front: { x: 0, y: 0, z },
    left: { x: split ? -3.4 : -2.7, y: 0.1, z: split ? 6.6 : 5.1 },
    right: { x: split ? 3.4 : 2.7, y: 0.1, z: split ? 6.6 : 5.1 },
    top: { x: 0, y: split ? 2.6 : 2.2, z: split ? 6.8 : 5.4 },
  };
  return { ...positions[view] };
}

/** Evaluate camera tracks; falls back to the view preset when no keys exist. */
export function evaluateCamera(
  clip: AnimationClip,
  time: number,
  view: CameraView,
  split: boolean,
): Vec3 {
  const base = defaultCameraPosition(view, split);
  const t = clip.loop
    ? ((time % clip.duration) + clip.duration) % clip.duration
    : Math.min(Math.max(time, 0), clip.duration);

  let next = { ...base };
  let touched = false;
  for (const track of clip.tracks) {
    if (track.targetId !== CAMERA_TARGET_ID && !isCameraProperty(track.property)) continue;
    if (!isCameraProperty(track.property)) continue;
    const value = sampleTrack(track, t);
    if (value == null) continue;
    touched = true;
    if (track.property === 'camera.x') next.x = value;
    if (track.property === 'camera.y') next.y = value;
    if (track.property === 'camera.z') next.z = value;
  }
  return touched ? next : base;
}

export function createKeyframe(time: number, value: number, ease: AnimEase = 'easeInOut'): AnimKeyframe {
  return { id: `kf-${Math.random().toString(36).slice(2, 9)}`, time, value, ease };
}

export function resolveBezier(ease: AnimEase | undefined, bezier?: EaseBezier): EaseBezier {
  if (ease === 'custom') {
    return normalizeBezier(bezier ?? DEFAULT_CUSTOM_BEZIER);
  }
  return PRESET_BEZIERS[(ease ?? 'easeInOut') as Exclude<AnimEase, 'custom'>] ?? PRESET_BEZIERS.easeInOut;
}

export function normalizeBezier(bezier: EaseBezier): EaseBezier {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const clampY = (n: number) => Math.min(2, Math.max(-1, Number.isFinite(n) ? n : 0));
  return [clamp01(bezier[0]), clampY(bezier[1]), clamp01(bezier[2]), clampY(bezier[3])];
}

/** Sample cubic Bezier B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³ P3 with P0=0, P3=1 */
function cubicBezier1D(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function cubicBezierDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Solve for parameter t given x on a unit cubic-bezier (CSS cubic-bezier semantics). */
function solveCubicBezierX(x: number, x1: number, x2: number): number {
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const xEst = cubicBezier1D(t, x1, x2) - x;
    const d = cubicBezierDerivative(t, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    t -= xEst / d;
    if (t < 0 || t > 1) {
      t = Math.min(1, Math.max(0, t));
      break;
    }
  }
  // Binary refine for stubborn cases
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 12; i += 1) {
    const xEst = cubicBezier1D(t, x1, x2);
    if (Math.abs(xEst - x) < 1e-6) return t;
    if (xEst < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

export function sampleCubicBezier(bezier: EaseBezier, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = normalizeBezier(bezier);
  const s = solveCubicBezierX(u, x1, x2);
  return cubicBezier1D(s, y1, y2);
}

export function applyEase(kind: AnimEase | undefined, t: number, bezier?: EaseBezier): number {
  const u = Math.min(1, Math.max(0, t));
  if (kind === 'custom') {
    return sampleCubicBezier(bezier ?? DEFAULT_CUSTOM_BEZIER, u);
  }
  switch (kind ?? 'easeInOut') {
    case 'linear':
      return u;
    case 'easeIn':
      return u * u;
    case 'easeOut': {
      const inv = 1 - u;
      return 1 - inv * inv;
    }
    case 'easeInOut':
    default:
      return u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
  }
}

export function createTrack(targetId: string, property: AnimProperty, keyframes: AnimKeyframe[] = []): AnimTrack {
  return {
    id: `track-${targetId}-${property}-${Math.random().toString(36).slice(2, 6)}`,
    targetId,
    property,
    keyframes: [...keyframes].sort((a, b) => a.time - b.time),
  };
}

/** Smoothstep interpolate a sorted keyframe list at time t */
export function sampleTrack(track: AnimTrack, time: number): number | null {
  const keys = track.keyframes;
  if (!keys.length) return null;
  if (keys.length === 1 || time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time || 1;
      const u = applyEase(a.ease, (time - a.time) / span, a.easeBezier);
      return a.value + (b.value - a.value) * u;
    }
  }
  return last.value;
}

export function readProperty(device: DeviceInstance, property: AnimProperty): number {
  switch (property) {
    case 'rotation.x': return device.rotation.x;
    case 'rotation.y': return device.rotation.y;
    case 'rotation.z': return device.rotation.z;
    case 'position.x': return device.position.x;
    case 'position.y': return device.position.y;
    case 'position.z': return device.position.z;
    case 'scale': return device.scale;
    case 'camera.x':
    case 'camera.y':
    case 'camera.z':
      return 0;
    default: return 0;
  }
}

export function writeProperty(device: DeviceInstance, property: AnimProperty, value: number): DeviceInstance {
  if (isCameraProperty(property)) return device;
  const next = {
    ...device,
    rotation: { ...device.rotation },
    position: { ...device.position },
  };
  switch (property) {
    case 'rotation.x': next.rotation.x = value; break;
    case 'rotation.y': next.rotation.y = value; break;
    case 'rotation.z': next.rotation.z = value; break;
    case 'position.x': next.position.x = value; break;
    case 'position.y': next.position.y = value; break;
    case 'position.z': next.position.z = value; break;
    case 'scale': next.scale = value; break;
    default: break;
  }
  return next;
}

/** Evaluate all device tracks onto device instances at a given time */
export function evaluateAnimation(
  devices: DeviceInstance[],
  clip: AnimationClip,
  time: number,
): DeviceInstance[] {
  const t = clip.loop
    ? ((time % clip.duration) + clip.duration) % clip.duration
    : Math.min(Math.max(time, 0), clip.duration);

  return devices.map((device) => {
    let next = device;
    for (const track of clip.tracks) {
      if (track.targetId !== device.id) continue;
      if (isCameraProperty(track.property)) continue;
      const value = sampleTrack(track, t);
      if (value == null) continue;
      next = writeProperty(next, track.property, value);
    }
    return next === device
      ? device
      : { ...next, rotation: { ...next.rotation } as Vec3, position: { ...next.position } as Vec3 };
  });
}

export function hasCameraAnimation(clip: AnimationClip) {
  return clip.tracks.some((t) => isCameraProperty(t.property) && t.keyframes.length > 0);
}

export function upsertKeyframe(track: AnimTrack, time: number, value: number, snap = 0.05): AnimTrack {
  const rounded = Math.round(time / snap) * snap;
  const existing = track.keyframes.find((k) => Math.abs(k.time - rounded) < snap / 2);
  const keyframes = existing
    ? track.keyframes.map((k) => (k.id === existing.id ? { ...k, time: rounded, value } : k))
    : [...track.keyframes, createKeyframe(rounded, value)];
  return { ...track, keyframes: keyframes.sort((a, b) => a.time - b.time) };
}

export function moveKeyframe(track: AnimTrack, keyframeId: string, time: number, duration: number): AnimTrack {
  const clamped = Math.min(Math.max(time, 0), duration);
  return {
    ...track,
    keyframes: track.keyframes
      .map((k) => (k.id === keyframeId ? { ...k, time: clamped } : k))
      .sort((a, b) => a.time - b.time),
  };
}

/** Move many keyframes by a shared delta, clamping each into [0, duration]. */
export function moveKeyframesByDelta(
  clip: AnimationClip,
  keys: { trackId: string; keyframeId: string; startTime: number }[],
  deltaTime: number,
  duration: number,
): AnimationClip {
  if (!keys.length) return clip;
  const byTrack = new Map<string, { keyframeId: string; startTime: number }[]>();
  for (const key of keys) {
    const list = byTrack.get(key.trackId) ?? [];
    list.push(key);
    byTrack.set(key.trackId, list);
  }
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      const moves = byTrack.get(track.id);
      if (!moves?.length) return track;
      const nextTimes = new Map(moves.map((m) => [
        m.keyframeId,
        Math.min(Math.max(m.startTime + deltaTime, 0), duration),
      ]));
      return {
        ...track,
        keyframes: track.keyframes
          .map((k) => (nextTimes.has(k.id) ? { ...k, time: nextTimes.get(k.id)! } : k))
          .sort((a, b) => a.time - b.time),
      };
    }),
  };
}

export function setKeyframeEase(
  track: AnimTrack,
  keyframeId: string,
  ease: AnimEase,
  easeBezier?: EaseBezier,
): AnimTrack {
  return {
    ...track,
    keyframes: track.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      if (ease === 'custom') {
        const bezier = normalizeBezier(
          easeBezier
            ?? k.easeBezier
            ?? (k.ease && k.ease !== 'custom' ? PRESET_BEZIERS[k.ease] : DEFAULT_CUSTOM_BEZIER),
        );
        return { ...k, ease, easeBezier: bezier };
      }
      const next = { ...k, ease };
      delete next.easeBezier;
      return next;
    }),
  };
}

export function removeKeyframe(track: AnimTrack, keyframeId: string): AnimTrack {
  return { ...track, keyframes: track.keyframes.filter((k) => k.id !== keyframeId) };
}

export function removeKeyframes(
  clip: AnimationClip,
  keys: { trackId: string; keyframeId: string }[],
): AnimationClip {
  if (!keys.length) return clip;
  const remove = new Set(keys.map((k) => `${k.trackId}::${k.keyframeId}`));
  return {
    ...clip,
    tracks: clip.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.filter((k) => !remove.has(`${track.id}::${k.id}`)),
    })),
  };
}

export function formatTimecode(seconds: number, fps = 30) {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const mins = Math.floor(totalFrames / (fps * 60));
  const secs = Math.floor((totalFrames % (fps * 60)) / fps);
  const frames = totalFrames % fps;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function hasAnimation(clip: AnimationClip) {
  return clip.tracks.some((t) => t.keyframes.length > 0);
}
