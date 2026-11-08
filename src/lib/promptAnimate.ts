import { createKeyframe, createTrack, defaultCameraPosition, isCameraProperty, readProperty, sampleTrack } from './animation';
import { applyAnimationPreset, getAnimationPreset } from './animationPresets';
import type {
  AnimEase,
  AnimKeyframe,
  AnimProperty,
  AnimTrack,
  AnimationClip,
  DeviceInstance,
  EaseBezier,
} from '../types';
import { CAMERA_TARGET_ID } from '../types';

export interface PromptAnimateResult {
  clip: AnimationClip;
  label: string;
  summary: string;
}

export const PROMPT_SUGGESTIONS = [
  'slow spin while floating',
  'orbit, then settle',
  'luxury product shot',
  'fan out, staggered',
  'close pan then a soft wobble',
  'playful bounce and tilt',
  'corkscrew rise',
  'pull back and reveal',
  'gentle breathe loop',
  'spin once, no loop',
  'rotate left slowly',
  'dramatic slam down',
  'hero intro then breathe',
  'clear animation',
  'reset animation',
] as const;

type MotionKind =
  | 'turntable'
  | 'spin'
  | 'float'
  | 'tilt'
  | 'swing'
  | 'orbit'
  | 'zoom'
  | 'present'
  | 'wobble'
  | 'bounce'
  | 'flip'
  | 'fan'
  | 'closePan'
  | 'pullBack'
  | 'breathe'
  | 'rise'
  | 'drop'
  | 'slide'
  | 'peek'
  | 'drift'
  | 'clear'
  | 'custom';

interface PromptIntent {
  kind: MotionKind;
  intensity: number;
  duration: number | null;
  loop: boolean | null;
  ease: AnimEase;
  easeBezier?: EaseBezier;
  direction: number;
  label: string;
}

function kf(time: number, value: number, ease: AnimEase = 'easeInOut', easeBezier?: EaseBezier): AnimKeyframe {
  const key = createKeyframe(time, value, ease);
  if (ease === 'custom' && easeBezier) key.easeBezier = easeBezier;
  return key;
}

function track(device: DeviceInstance, property: AnimProperty, keys: AnimKeyframe[]): AnimTrack {
  return createTrack(device.id, property, keys);
}

function scaleAround(base: number, delta: number, intensity: number) {
  return base + delta * intensity;
}

function parseDuration(text: string): number | null {
  const sec = text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (sec) return Math.min(30, Math.max(1, Number(sec[1])));
  const over = text.match(/(?:over|for|in)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?\b/);
  if (over) return Math.min(30, Math.max(1, Number(over[1])));
  return null;
}

function parseIntensity(text: string): number {
  if (/\b(extreme|wild|crazy|huge|max)\b/.test(text)) return 2;
  if (/\b(dramatic|bold|strong|sharp|punchy|aggressive|big)\b/.test(text)) return 1.55;
  if (/\b(subtle|gentle|soft|slight|light|tiny|delicate|calm)\b/.test(text)) return 0.55;
  if (/\b(medium|normal|moderate)\b/.test(text)) return 1;
  return 1;
}

function parseEase(text: string): { ease: AnimEase; easeBezier?: EaseBezier } {
  if (/\b(linear|constant)\b/.test(text)) return { ease: 'linear' };
  if (/\b(snappy|punchy|sharp)\b/.test(text)) return { ease: 'custom', easeBezier: [0.2, 0.9, 0.2, 1] };
  if (/\b(bounce|bouncy|elastic)\b/.test(text)) return { ease: 'custom', easeBezier: [0.34, 1.56, 0.64, 1] };
  if (/\b(ease[\s-]?in)\b/.test(text) && !/\bease[\s-]?in[\s-]?out\b/.test(text)) return { ease: 'easeIn' };
  if (/\b(ease[\s-]?out|smooth out)\b/.test(text)) return { ease: 'easeOut' };
  if (/\b(smooth|cinematic|ease[\s-]?in[\s-]?out)\b/.test(text)) return { ease: 'easeInOut' };
  return { ease: 'easeInOut' };
}

function parseDirection(text: string): number {
  if (/\b(left|counter[\s-]?clockwise|ccw)\b/.test(text)) return -1;
  if (/\b(right|clockwise|cw)\b/.test(text)) return 1;
  return 1;
}

function parseLoop(text: string, kind: MotionKind): boolean | null {
  // Explicit off first so "don't loop" / "no loop" win over bare "loop".
  if (
    /\b(don'?t\s+loop|do\s+not\s+loop|no[\s-]?loop|without\s+loop(?:ing)?|not\s+looping|one[\s-]?shot|play\s+once|\bonce\b|no\s+repeat)\b/.test(text)
  ) {
    return false;
  }
  // Explicit on — also overrides one-shot motion kinds like present / close pan.
  if (/\b(loop|looping|seamless|infinite|repeat)\b/.test(text)) return true;
  // Soft one-shot cues when the user didn't ask to loop.
  if (/\b(reveal|settle|land|present)\b/.test(text)) return false;
  if (kind === 'present' || kind === 'closePan') return false;
  if (kind === 'clear') return null;
  return null;
}

function detectKind(text: string): { kind: MotionKind; label: string } {
  if (isClearPrompt(text)) {
    return { kind: 'clear', label: 'Clear' };
  }
  if (
    /\b(close\s*pan|pan\s*(in|to|clos|toward)|dolly\s*(in|clos)|camera\s*(push|dolly|close|pan)|push[\s-]?in)\b/.test(text)
  ) {
    return { kind: 'closePan', label: 'Close Pan' };
  }
  if (/\b(pull\s*backs?|dolly\s*outs?|widen|wide\s*shots?|camera\s*outs?|reveal\s*wide)\b/.test(text)) {
    return { kind: 'pullBack', label: 'Pull Back' };
  }
  if (/\b(fan(?:ning|ned|s)?|fan\s*(out|open|spread)|hand\s*of\s*cards)\b/.test(text)) {
    return { kind: 'fan', label: 'Fan' };
  }
  if (/\b(360|full\s*spin|revolv|twirl|whirl|spin)\b/.test(text)) return { kind: 'spin', label: 'Spin 360' };
  if (/\b(turntable|product\s*spin|showcase\s*spin|y[\s-]?spin|rotat\w*|turns?|turning)\b/.test(text)) {
    return { kind: 'turntable', label: 'Turntable' };
  }
  if (/\b(orbit|diagonal|3d\s*peek)\b/.test(text)) return { kind: 'orbit', label: 'Orbit' };
  if (/\b(wobble|wiggle|jiggle|shake|shaking|attention|tremor)\b/.test(text)) return { kind: 'wobble', label: 'Wobble' };
  if (/\b(swing|pendulum|roll(?:ing)?)\b/.test(text)) return { kind: 'swing', label: 'Swing' };
  if (/\b(flip)\b/.test(text)) return { kind: 'flip', label: 'Flip' };
  if (/\b(tilt|pitch|lean|nod)\b/.test(text)) return { kind: 'tilt', label: 'Tilt' };
  if (/\b(zoom|punch|scale\s*in|close[\s-]?up)\b/.test(text)) return { kind: 'zoom', label: 'Zoom In' };
  if (/\b(slam|drop|fall|falling|land(?:ing)?\s*hard|crash)\b/.test(text)) return { kind: 'drop', label: 'Drop' };
  if (/\b(present|reveal|intro|entrance|settle)\b/.test(text)) return { kind: 'present', label: 'Present' };
  if (/\b(bounce)\b/.test(text)) return { kind: 'bounce', label: 'Bounce' };
  if (/\b(float|hover|bob|levitat)\b/.test(text)) return { kind: 'float', label: 'Float' };
  if (/\b(breathe|breathing|pulse|pulsing)\b/.test(text)) return { kind: 'breathe', label: 'Breathe' };
  if (/\b(rise|rising|lift|lifting|ascend)\b/.test(text)) return { kind: 'rise', label: 'Rise' };
  if (/\b(slide|glide)\b/.test(text)) return { kind: 'slide', label: 'Slide' };
  if (/\b(peek|glance)\b/.test(text)) return { kind: 'peek', label: 'Peek' };
  if (/\b(drift|drifting)\b/.test(text)) return { kind: 'drift', label: 'Drift' };
  return { kind: 'custom', label: 'Custom motion' };
}

function parseSpeedBias(text: string, base: number): number {
  if (/\b(very\s*slow|ultra\s*slow|sluggish)\b/.test(text)) return base * 1.75;
  if (/\b(slow|leisurely|relaxed)\b/.test(text)) return base * 1.35;
  if (/\b(fast|quick|snappy|rapid)\b/.test(text)) return base * 0.7;
  if (/\b(very\s*fast|instant|flash)\b/.test(text)) return base * 0.45;
  return base;
}

function defaultDuration(kind: MotionKind): number {
  switch (kind) {
    case 'spin': return 5;
    case 'orbit': return 4.5;
    case 'float': return 3.5;
    case 'present': return 2.2;
    case 'zoom': return 2.5;
    case 'wobble': return 2;
    case 'bounce': return 2.4;
    case 'flip': return 2.8;
    case 'fan': return 3.2;
    case 'closePan': return 2.8;
    case 'pullBack': return 3.4;
    case 'breathe': return 3.2;
    case 'rise': return 2.8;
    case 'drop': return 2.2;
    case 'slide': return 3;
    case 'peek': return 2.6;
    case 'drift': return 5.5;
    case 'tilt':
    case 'swing': return 3;
    case 'turntable': return 4;
    case 'clear': return 4;
    default: return 3.5;
  }
}

export function parseAnimationPrompt(prompt: string): PromptIntent {
  const text = prompt.trim().toLowerCase().replace(/[^\w\s.+-]/g, ' ');
  const { kind, label } = detectKind(text);
  const intensity = parseIntensity(text);
  const { ease, easeBezier } = parseEase(text);
  const direction = parseDirection(text);
  const loop = parseLoop(text, kind);
  const explicitDuration = parseDuration(text);
  const duration = explicitDuration ?? parseSpeedBias(text, defaultDuration(kind));

  return {
    kind,
    intensity,
    duration: kind === 'clear' ? null : Math.round(duration * 20) / 20,
    loop,
    ease,
    easeBezier,
    direction,
    label,
  };
}

function applyEaseToTracks(tracks: AnimTrack[], ease: AnimEase, easeBezier?: EaseBezier): AnimTrack[] {
  return tracks.map((t) => ({
    ...t,
    keyframes: t.keyframes.map((k, i) => {
      if (i >= t.keyframes.length - 1) return k;
      const next = { ...k, ease };
      if (ease === 'custom' && easeBezier) next.easeBezier = easeBezier;
      else delete next.easeBezier;
      return next;
    }),
  }));
}

function scalePresetTracks(tracks: AnimTrack[], device: DeviceInstance, intensity: number, direction: number): AnimTrack[] {
  return tracks.map((t) => {
    const base = (() => {
      switch (t.property) {
        case 'rotation.x': return device.rotation.x;
        case 'rotation.y': return device.rotation.y;
        case 'rotation.z': return device.rotation.z;
        case 'position.x': return device.position.x;
        case 'position.y': return device.position.y;
        case 'position.z': return device.position.z;
        case 'scale': return device.scale;
        case 'lidOpen': return device.lidOpen ?? 1;
        default: return 0;
      }
    })();
    const dir = t.property.includes('rotation') || t.property === 'position.x' ? direction : 1;
    return {
      ...t,
      keyframes: t.keyframes.map((k) => ({
        ...k,
        value: t.property === 'scale'
          ? base + (k.value - base) * (0.5 + intensity * 0.5)
          : base + (k.value - base) * intensity * dir,
      })),
    };
  });
}

function retargetDuration(tracks: AnimTrack[], fromDuration: number, toDuration: number): AnimTrack[] {
  if (fromDuration <= 0 || Math.abs(fromDuration - toDuration) < 0.01) return tracks;
  const ratio = toDuration / fromDuration;
  return tracks.map((t) => ({
    ...t,
    keyframes: t.keyframes.map((k) => ({ ...k, time: Math.round(k.time * ratio * 100) / 100 })),
  }));
}

function buildCustom(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 3.5;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y, z } = device.rotation;
  const { x: px, y: py } = device.position;
  const s = device.scale;
  const ease = intent.ease;
  const bez = intent.easeBezier;

  const mid = d / 2;
  return [
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -22 * dir, i), ease, bez),
      kf(mid, scaleAround(y, 22 * dir, i), ease, bez),
      kf(d, scaleAround(y, -22 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -4, i), ease, bez),
      kf(mid, scaleAround(x, 6, i), ease, bez),
      kf(d, scaleAround(x, -4, i), ease, bez),
    ]),
    track(device, 'position.y', [
      kf(0, py, ease, bez),
      kf(mid, scaleAround(py, 0.12, i), ease, bez),
      kf(d, py, ease, bez),
    ]),
    track(device, 'scale', [
      kf(0, s, ease, bez),
      kf(d, s, ease, bez),
    ]),
  ];
}

function buildBounce(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.4;
  const i = intent.intensity;
  const { x, y, z } = device.rotation;
  const { y: py } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier ?? [0.34, 1.56, 0.64, 1];
  const useBez = intent.ease === 'custom' || /\bbounce/.test(intent.label.toLowerCase());
  const e: AnimEase = useBez ? 'custom' : ease;
  const b = useBez ? bez : intent.easeBezier;
  return [
    track(device, 'position.y', [
      kf(0, py, e, b),
      kf(d * 0.35, scaleAround(py, 0.28, i), e, b),
      kf(d * 0.55, scaleAround(py, -0.04, i), e, b),
      kf(d * 0.75, scaleAround(py, 0.14, i), e, b),
      kf(d, py, e, b),
    ]),
    track(device, 'rotation.x', [
      kf(0, x, e, b),
      kf(d * 0.35, scaleAround(x, 8, i), e, b),
      kf(d, x, e, b),
    ]),
    track(device, 'rotation.z', [
      kf(0, z, e, b),
      kf(d * 0.35, scaleAround(z, 4 * intent.direction, i), e, b),
      kf(d * 0.75, scaleAround(z, -3 * intent.direction, i), e, b),
      kf(d, z, e, b),
    ]),
    track(device, 'rotation.y', [kf(0, y, e, b), kf(d, y, e, b)]),
  ];
}

function buildFlip(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.8;
  const i = intent.intensity;
  const { x, y, z } = device.rotation;
  const s = device.scale;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  return [
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -90 * intent.direction, Math.min(i, 1.2)), ease, bez),
      kf(d * 0.55, scaleAround(x, 12, i), ease, bez),
      kf(d, x, ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -20 * intent.direction, i), ease, bez),
      kf(d, y, ease, bez),
    ]),
    track(device, 'rotation.z', [
      kf(0, scaleAround(z, 8 * intent.direction, i), ease, bez),
      kf(d, z, ease, bez),
    ]),
    track(device, 'scale', [
      kf(0, s * (0.85 - (i - 1) * 0.05), ease, bez),
      kf(d * 0.6, s * 1.04, ease, bez),
      kf(d, s, ease, bez),
    ]),
  ];
}

/** Card-fan sweep — Z roll with Y yaw and a little lateral drift. */
function buildFan(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 3.2;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y, z } = device.rotation;
  const { x: px, y: py } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const mid = d / 2;
  return [
    track(device, 'rotation.z', [
      kf(0, scaleAround(z, -22 * dir, i), ease, bez),
      kf(mid, scaleAround(z, 22 * dir, i), ease, bez),
      kf(d, scaleAround(z, -22 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -28 * dir, i), ease, bez),
      kf(mid, scaleAround(y, 28 * dir, i), ease, bez),
      kf(d, scaleAround(y, -28 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -6, i), ease, bez),
      kf(mid, scaleAround(x, 4, i), ease, bez),
      kf(d, scaleAround(x, -6, i), ease, bez),
    ]),
    track(device, 'position.x', [
      kf(0, scaleAround(px, -0.22 * dir, i), ease, bez),
      kf(mid, scaleAround(px, 0.22 * dir, i), ease, bez),
      kf(d, scaleAround(px, -0.22 * dir, i), ease, bez),
    ]),
    track(device, 'position.y', [
      kf(0, py, ease, bez),
      kf(mid, scaleAround(py, 0.06, i), ease, bez),
      kf(d, py, ease, bez),
    ]),
  ];
}

/** Camera dolly + lateral pan closing in on the device, with a soft settle. */
function buildClosePan(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.8;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y, z } = device.rotation;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const cam = defaultCameraPosition('front', false);
  const startZ = cam.z + 1.35 * (0.55 + i * 0.45);
  const endZ = Math.max(3.2, cam.z - 1.15 * (0.55 + i * 0.45));
  const panX = 1.15 * dir * (0.55 + i * 0.45);

  const camTrack = (property: AnimProperty, keys: AnimKeyframe[]): AnimTrack =>
    createTrack(CAMERA_TARGET_ID, property, keys);

  return [
    camTrack('camera.z', [
      kf(0, startZ, ease, bez),
      kf(d * 0.7, endZ + 0.12, ease, bez),
      kf(d, endZ, ease, bez),
    ]),
    camTrack('camera.x', [
      kf(0, panX, ease, bez),
      kf(d * 0.55, panX * 0.2, ease, bez),
      kf(d, 0, ease, bez),
    ]),
    camTrack('camera.y', [
      kf(0, cam.y + 0.18 * i, ease, bez),
      kf(d, cam.y, ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -16 * dir, i), ease, bez),
      kf(d * 0.65, scaleAround(y, 4 * dir, i), ease, bez),
      kf(d, y, ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -8, i), ease, bez),
      kf(d, x, ease, bez),
    ]),
    track(device, 'rotation.z', [
      kf(0, scaleAround(z, 4 * dir, i), ease, bez),
      kf(d, z, ease, bez),
    ]),
  ];
}

/** Scale pulse — a living hold, useful under another move. */
function buildBreathe(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 3.2;
  const i = intent.intensity;
  const { y } = device.rotation;
  const s = device.scale;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const mid = d / 2;
  return [
    track(device, 'scale', [
      kf(0, s, ease, bez),
      kf(mid, s * (1 + 0.045 * i), ease, bez),
      kf(d, s, ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, y, ease, bez),
      kf(mid, scaleAround(y, 3 * intent.direction, i), ease, bez),
      kf(d, y, ease, bez),
    ]),
  ];
}

/** Lift off the ground and settle back. */
function buildRise(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.8;
  const i = intent.intensity;
  const { x } = device.rotation;
  const { y: py } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  return [
    track(device, 'position.y', [
      kf(0, py, ease, bez),
      kf(d * 0.45, scaleAround(py, 0.34, i), ease, bez),
      kf(d, py, ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, x, ease, bez),
      kf(d * 0.45, scaleAround(x, -7, i), ease, bez),
      kf(d, x, ease, bez),
    ]),
  ];
}

/** Drop / slam from above with a short settle. */
function buildDrop(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.2;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, z } = device.rotation;
  const { y: py } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const slam: EaseBezier = [0.15, 0.85, 0.35, 1];
  return [
    track(device, 'position.y', [
      kf(0, scaleAround(py, 0.52, i), ease, bez),
      kf(d * 0.42, scaleAround(py, -0.05, i), 'custom', slam),
      kf(d * 0.62, scaleAround(py, 0.07, i), ease, bez),
      kf(d, py, ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -10, i), ease, bez),
      kf(d * 0.42, scaleAround(x, 6, i), 'custom', slam),
      kf(d, x, ease, bez),
    ]),
    track(device, 'rotation.z', [
      kf(0, scaleAround(z, -5 * dir, i), ease, bez),
      kf(d * 0.42, scaleAround(z, 4 * dir, i), 'custom', slam),
      kf(d, z, ease, bez),
    ]),
  ];
}

/** Lateral glide. */
function buildSlide(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 3;
  const i = intent.intensity;
  const dir = intent.direction;
  const { y } = device.rotation;
  const { x: px } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const mid = d / 2;
  return [
    track(device, 'position.x', [
      kf(0, scaleAround(px, -0.28 * dir, i), ease, bez),
      kf(mid, scaleAround(px, 0.28 * dir, i), ease, bez),
      kf(d, scaleAround(px, -0.28 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -8 * dir, i), ease, bez),
      kf(mid, scaleAround(y, 8 * dir, i), ease, bez),
      kf(d, y, ease, bez),
    ]),
  ];
}

/** Small yaw, like the device glancing toward camera. */
function buildPeek(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 2.6;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y } = device.rotation;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  return [
    track(device, 'rotation.y', [
      kf(0, y, ease, bez),
      kf(d * 0.55, scaleAround(y, 16 * dir, i), ease, bez),
      kf(d, y, ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, x, ease, bez),
      kf(d * 0.55, scaleAround(x, -5, i), ease, bez),
      kf(d, x, ease, bez),
    ]),
  ];
}

/** Slow editorial drift — yaw, a little travel, a little lift. */
function buildDrift(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 5.5;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y, z } = device.rotation;
  const { x: px, y: py } = device.position;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  return [
    track(device, 'rotation.y', [
      kf(0, scaleAround(y, -10 * dir, i), ease, bez),
      kf(d * 0.55, scaleAround(y, 12 * dir, i), ease, bez),
      kf(d, scaleAround(y, -10 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -3, i), ease, bez),
      kf(d * 0.4, scaleAround(x, 4, i), ease, bez),
      kf(d, scaleAround(x, -3, i), ease, bez),
    ]),
    track(device, 'rotation.z', [
      kf(0, z, ease, bez),
      kf(d * 0.5, scaleAround(z, 2 * dir, i), ease, bez),
      kf(d, z, ease, bez),
    ]),
    track(device, 'position.x', [
      kf(0, scaleAround(px, -0.12 * dir, i), ease, bez),
      kf(d * 0.55, scaleAround(px, 0.12 * dir, i), ease, bez),
      kf(d, scaleAround(px, -0.12 * dir, i), ease, bez),
    ]),
    track(device, 'position.y', [
      kf(0, py, ease, bez),
      kf(d * 0.5, scaleAround(py, 0.08, i), ease, bez),
      kf(d, py, ease, bez),
    ]),
  ];
}

/** Camera pulls wide while the device eases into its pose. */
function buildPullBack(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  const d = intent.duration ?? 3.4;
  const i = intent.intensity;
  const dir = intent.direction;
  const { x, y } = device.rotation;
  const ease = intent.ease;
  const bez = intent.easeBezier;
  const cam = defaultCameraPosition('front', false);
  const startZ = Math.max(3.1, cam.z - 0.85);
  const endZ = cam.z + 1.55 * (0.6 + i * 0.4);
  const camTrack = (property: AnimProperty, keys: AnimKeyframe[]): AnimTrack =>
    createTrack(CAMERA_TARGET_ID, property, keys);

  return [
    camTrack('camera.z', [
      kf(0, startZ, ease, bez),
      kf(d * 0.72, endZ - 0.08, ease, bez),
      kf(d, endZ, ease, bez),
    ]),
    camTrack('camera.x', [
      kf(0, 0, ease, bez),
      kf(d * 0.4, 0.35 * dir * i, ease, bez),
      kf(d, 0.7 * dir * i, ease, bez),
    ]),
    camTrack('camera.y', [
      kf(0, cam.y, ease, bez),
      kf(d, cam.y + 0.22 * i, ease, bez),
    ]),
    track(device, 'rotation.y', [
      kf(0, y, ease, bez),
      kf(d, scaleAround(y, 10 * dir, i), ease, bez),
    ]),
    track(device, 'rotation.x', [
      kf(0, scaleAround(x, -6, i), ease, bez),
      kf(d, x, ease, bez),
    ]),
  ];
}

function buildForDevice(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  if (intent.kind === 'clear') return [];
  if (intent.kind === 'bounce') return buildBounce(device, intent);
  if (intent.kind === 'flip') return buildFlip(device, intent);
  if (intent.kind === 'fan') return buildFan(device, intent);
  if (intent.kind === 'closePan') return buildClosePan(device, intent);
  if (intent.kind === 'pullBack') return buildPullBack(device, intent);
  if (intent.kind === 'breathe') return buildBreathe(device, intent);
  if (intent.kind === 'rise') return buildRise(device, intent);
  if (intent.kind === 'drop') return buildDrop(device, intent);
  if (intent.kind === 'slide') return buildSlide(device, intent);
  if (intent.kind === 'peek') return buildPeek(device, intent);
  if (intent.kind === 'drift') return buildDrift(device, intent);
  if (intent.kind === 'custom') return buildCustom(device, intent);

  const preset = getAnimationPreset(intent.kind);
  if (!preset) return buildCustom(device, intent);

  const duration = intent.duration ?? preset.duration;
  let tracks = preset.build(device);
  tracks = scalePresetTracks(tracks, device, intent.intensity, intent.direction);
  tracks = retargetDuration(tracks, preset.duration, duration);
  tracks = applyEaseToTracks(tracks, intent.ease, intent.easeBezier);
  return tracks;
}

function intensityWord(n: number) {
  if (n >= 1.8) return 'extreme';
  if (n >= 1.3) return 'dramatic';
  if (n <= 0.7) return 'gentle';
  return null;
}

const MOTION_CATALOG: { kind: MotionKind; label: string; re: RegExp }[] = [
  { kind: 'closePan', label: 'Close pan', re: /\b(close\s*pans?|dolly\s*ins?|push[\s-]?ins?|camera\s*(?:push|dolly|close)|pans?\s*(?:in|clos|toward)|push(?:es|ing)?\s*(?:in|clos))\b/ },
  { kind: 'pullBack', label: 'Pull back', re: /\b(pull\s*backs?|dolly\s*outs?|widen|wide\s*shots?|camera\s*outs?|reveal\s*wide|zoom\s*outs?)\b/ },
  { kind: 'fan', label: 'Fan', re: /\b(fan(?:ning|ned|s)?|fan\s*(?:out|open|spread)|hand\s*of\s*cards|spread\s*out)\b/ },
  { kind: 'spin', label: 'Spin', re: /\b(360|full\s*spins?|revolv\w*|twirls?|twirling|whirls?|spins?|spinning)\b/ },
  { kind: 'turntable', label: 'Turntable', re: /\b(turntables?|product\s*spins?|showcase\s*spins?|y[\s-]?spins?|rotat\w*|turning)\b|(?<!\bin\s)\bturns?\b/ },
  { kind: 'orbit', label: 'Orbit', re: /\b(orbits?|orbiting|diagonals?|3d\s*peeks?)\b/ },
  { kind: 'wobble', label: 'Wobble', re: /\b(wobbles?|wiggles?|jiggles?|shakes?|shaking|attention|tremors?|vibrat\w*)\b/ },
  { kind: 'swing', label: 'Swing', re: /\b(swings?|swinging|pendulums?|rolls?|rolling)\b/ },
  { kind: 'flip', label: 'Flip', re: /\b(flips?|flipping|tumbles?|tumbling)\b/ },
  { kind: 'tilt', label: 'Tilt', re: /\b(tilts?|tilting|pitch\w*|leans?|leaning|nods?|nodding)\b/ },
  { kind: 'zoom', label: 'Zoom', re: /\b(zooms?|zooming|punch(?:es|\s*in)?|scale\s*ins?|close[\s-]?ups?)\b/ },
  { kind: 'drop', label: 'Drop', re: /\b(drops?|dropping|slams?|slamming|falls?|falling|lands?\s*hard|crashes?|crash(?:ing)?)\b/ },
  { kind: 'present', label: 'Settle', re: /\b(presents?|reveals?|intros?|entrances?|settles?|settling|lands?|landing)\b/ },
  { kind: 'bounce', label: 'Bounce', re: /\b(bounces?|bouncing)\b/ },
  { kind: 'float', label: 'Float', re: /\b(floats?|floating|hovers?|hovering|bobs?|bobbing|levitat\w*)\b/ },
  { kind: 'breathe', label: 'Breathe', re: /\b(breathes?|breathing|pulses?|pulsing|idles?|idling)\b/ },
  { kind: 'rise', label: 'Rise', re: /\b(rises?|rising|lifts?|lifting|ascends?|ascending|soars?|soaring)\b/ },
  { kind: 'slide', label: 'Slide', re: /\b(slides?|sliding|glides?|gliding|sweeps?|sweeping)\b/ },
  { kind: 'peek', label: 'Peek', re: /\b(peeks?|peeking|glances?|glancing|looks?\s+(?:left|right|over))\b/ },
  { kind: 'drift', label: 'Drift', re: /\b(drifts?|drifting|editorial)\b/ },
];

const CAMERA_KINDS = new Set<MotionKind>(['closePan', 'pullBack']);
const ONE_SHOT_KINDS = new Set<MotionKind>(['present', 'flip', 'closePan', 'pullBack', 'drop']);

export interface PromptMotionBeat {
  kinds: MotionKind[];
  intensity: number;
  duration: number;
  ease: AnimEase;
  easeBezier?: EaseBezier;
  direction: number;
}

export interface PromptMotionPlan {
  beats: PromptMotionBeat[];
  loop: boolean;
  stagger: boolean;
  ensemble: boolean;
  clear: boolean;
  /** True when the phrase named no known move, so a local model may reinterpret it. */
  fallback: boolean;
  label: string;
}

function roundTime(value: number) {
  return Math.round(value * 100) / 100;
}

function kindLabel(kind: MotionKind) {
  return MOTION_CATALOG.find((item) => item.kind === kind)?.label ?? 'Motion';
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost,
      );
    }
  }
  return grid[a.length][b.length];
}

function fuzzyHas(words: string[], targets: string[], maxDist = 2): boolean {
  for (const word of words) {
    if (word.length < 3) continue;
    for (const target of targets) {
      if (word === target || word.startsWith(target) || target.startsWith(word)) return true;
      const limit = Math.min(maxDist, target.length <= 4 ? 1 : 2);
      if (Math.abs(word.length - target.length) <= limit && editDistance(word, target) <= limit) return true;
    }
  }
  return false;
}

/** True for wipe/clear/reset/stop-style prompts, including common typos. */
function isClearPrompt(text: string) {
  const t = text.trim().toLowerCase().replace(/[^\w\s.+-]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return false;

  if (/^(clear|reset|none|stop|wipe|erase|empty)$/.test(t)) return true;
  if (/^(clear|reset|wipe|erase|remove|delete|stop)\s+(all|it|everything|this|that)?$/.test(t)) return true;
  if (/\b(no|without|without\s+any)\s+(anim\w*|motio?\w*|keyframe\w*|timeline)\b/.test(t)) return true;
  if (/\b(clear|reset|wipe|erase|remove|delete|stop)\s+all\b/.test(t)) return true;

  const clearRe = /\b(clear|clears|cleared|clearing|reset|resets|resetting|remove|removes|removed|removing|delete|deletes|deleted|deleting|wipe|wipes|wiped|wiping|erase|erases|erased|erasing|stop|stops|stopped|stopping|kill|kills|cancel|cancels|scrub|scrubs|empty|empties|unset)\b/;
  const animRe = /\b(anim\w*|motio?\w*|key(?:s|frame\w*)?|clip\w*|timeline|tracks?|keyframes?)\b/;
  if (clearRe.test(t) && animRe.test(t)) return true;
  if (animRe.test(t) && clearRe.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  const hasClear = fuzzyHas(words, ['clear', 'reset', 'remove', 'delete', 'wipe', 'erase', 'stop', 'scrub', 'empty']);
  const hasAnim = fuzzyHas(words, ['animation', 'animations', 'anim', 'motion', 'motions', 'keyframe', 'keyframes', 'clip', 'timeline', 'tracks']);
  if (hasClear && hasAnim) return true;
  if (hasClear && words.length <= 3 && /\b(all|everything|it|this|that)?\b/.test(t)) {
    // Short imperative in the animation prompt box: "reset all", "clear it", "wipe".
    if (words.length <= 2 || fuzzyHas(words, ['all', 'everything', 'it', 'this', 'that'])) return true;
  }
  return false;
}

function wantsEnsemble(text: string) {
  return /\b(all|every|each|both|together|stagger(?:ed)?|cascade|ripple|one after another|one by one|in turn|devices|phones?|mockups?)\b/.test(text);
}

function normalizePromptText(prompt: string) {
  return prompt.trim().toLowerCase().replace(/[^\w\s.+-]/g, ' ').replace(/\s+/g, ' ');
}

/** Sequence delimiters: "then", "next", "after that", semicolons, "and then". */
function splitSequenceSegments(text: string): string[] {
  return text
    .split(/\s*(?:;\s*|(?:,\s*)?(?:and\s+)?(?:then|next|afterwards|after\s+that|after\s+which|followed\s+by)\s+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * "spin, float, settle" → three beats. Keep "spin while floating" / "bounce and tilt"
 * as one layered beat.
 */
function expandCommaMotionLists(segments: string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (/\b(while|as\s+it|with\s+a|alongside)\b/.test(segment)) {
      out.push(segment);
      continue;
    }
    const parts = segment.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      out.push(segment);
      continue;
    }
    const motionParts = parts.filter((part) => findMotions(part).length > 0 || moodKinds(part) != null);
    if (motionParts.length === parts.length && parts.length >= 2) {
      out.push(...parts);
    } else {
      out.push(segment);
    }
  }
  return out;
}

function findMotions(text: string): MotionKind[] {
  const found = MOTION_CATALOG
    .map((item) => ({ kind: item.kind, index: text.search(item.re) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.kind);

  const unique: MotionKind[] = [];
  for (const kind of found) {
    if (!unique.includes(kind)) unique.push(kind);
  }

  if (!unique.length) {
    for (const kind of fuzzyMotionKinds(text)) {
      if (!unique.includes(kind)) unique.push(kind);
    }
  }

  if (unique.includes('spin') && unique.includes('turntable')) {
    const full = /\b(360|full\s*spin|revolv|twirl|whirl)/.test(text);
    const dropKind = full ? 'turntable' : 'spin';
    return unique.filter((kind) => kind !== dropKind);
  }
  if (unique.includes('drop') && unique.includes('present') && /\b(slam|drop|fall|crash|hard)\b/.test(text)) {
    return unique.filter((kind) => kind !== 'present');
  }
  if (/\b(corkscrew|spiral|helix)\b/.test(text)) {
    if (!unique.includes('spin')) unique.unshift('spin');
    if (!unique.includes('rise')) unique.push('rise');
  }
  if (/\b(while|as\s+it|with\s+a)\s+(?:a\s+)?(?:soft\s+|gentle\s+|slow\s+)?(float|hover|bob)/.test(text) && !unique.includes('float')) {
    unique.push('float');
  }
  return unique;
}

function moodKinds(text: string): MotionKind[][] | null {
  if (/\b(luxury|premium|editorial|high[\s-]?end|expensive|apple[\s-]?style|commercial|product\s+(?:ad|shot|film|video))\b/.test(text)) {
    return [['drift', 'float']];
  }
  if (/\b(cinematic|filmic|movie|widescreen|trailer)\b/.test(text)) {
    return [['pullBack', 'orbit']];
  }
  if (/\b(playful|cheeky|fun|goofy|silly)\b/.test(text)) {
    return [['bounce', 'wobble']];
  }
  if (/\b(hero\s+intro|hero\s+shot|product\s+intro|launch\s+shot)\b/.test(text)) {
    return [['present'], ['breathe']];
  }
  if (/\b(hero|showcase|spotlight)\b/.test(text)) {
    return [['present'], ['float']];
  }
  if (/\b(calm|quiet|barely\s+moving|subtle\s+hold|soft\s+hold)\b/.test(text)) {
    return [['breathe']];
  }
  if (/\b(tech|saas|startup|modern\s+app)\b/.test(text)) {
    return [['closePan'], ['float']];
  }
  if (/\b(unbox|unboxing|unpack)\b/.test(text)) {
    return [['rise', 'spin'], ['present']];
  }
  if (/\b(attention|hey|look\s+here|notice\s+me)\b/.test(text)) {
    return [['wobble']];
  }
  if (/\b(dramatic\s+enter|big\s+enter|power\s+enter)\b/.test(text)) {
    return [['drop'], ['present']];
  }
  return null;
}

/** Soft synonym / typo rescue when regex catalog misses a verb. */
function fuzzyMotionKinds(text: string): MotionKind[] {
  const words = text.split(/\s+/).filter((word) => word.length >= 3);
  const guesses: { kind: MotionKind; targets: string[] }[] = [
    { kind: 'spin', targets: ['spin', 'spins', 'spinning', 'twirl', 'whirl', 'revolve'] },
    { kind: 'turntable', targets: ['rotate', 'rotation', 'rotating', 'turn', 'turning', 'turntable'] },
    { kind: 'float', targets: ['float', 'floating', 'hover', 'hovering', 'levitate'] },
    { kind: 'bounce', targets: ['bounce', 'bouncing', 'bouncy'] },
    { kind: 'wobble', targets: ['wobble', 'wiggle', 'jiggle', 'shake', 'shaking'] },
    { kind: 'tilt', targets: ['tilt', 'tilting', 'lean', 'leaning', 'nod'] },
    { kind: 'flip', targets: ['flip', 'flipping', 'tumble'] },
    { kind: 'orbit', targets: ['orbit', 'orbiting'] },
    { kind: 'zoom', targets: ['zoom', 'zooming'] },
    { kind: 'present', targets: ['settle', 'settling', 'reveal', 'present', 'intro', 'entrance'] },
    { kind: 'rise', targets: ['rise', 'rising', 'lift', 'lifting', 'ascend'] },
    { kind: 'drop', targets: ['drop', 'dropping', 'slam', 'slamming', 'fall', 'falling'] },
    { kind: 'slide', targets: ['slide', 'sliding', 'glide', 'gliding'] },
    { kind: 'breathe', targets: ['breathe', 'breathing', 'pulse', 'pulsing', 'idle'] },
    { kind: 'fan', targets: ['fan', 'fanning', 'spread'] },
    { kind: 'peek', targets: ['peek', 'peeking', 'glance'] },
    { kind: 'drift', targets: ['drift', 'drifting'] },
    { kind: 'swing', targets: ['swing', 'swinging', 'pendulum'] },
    { kind: 'closePan', targets: ['dolly', 'pushin'] },
    { kind: 'pullBack', targets: ['pullback', 'widen'] },
  ];
  const found: MotionKind[] = [];
  for (const guess of guesses) {
    if (fuzzyHas(words, guess.targets, 2) && !found.includes(guess.kind)) found.push(guess.kind);
  }
  return found;
}

function beatDuration(segment: string, kinds: MotionKind[], explicit: number | null): number {
  if (explicit != null) return explicit;
  const primary = kinds[0] ?? 'drift';
  return parseSpeedBias(segment, defaultDuration(primary));
}

/** Read a prompt as layered beats ("spin while floating, then settle"). */
export function planAnimationPrompt(prompt: string): PromptMotionPlan {
  const text = normalizePromptText(prompt);
  const ensemble = wantsEnsemble(text);
  const stagger = /\b(stagger(?:ed)?|cascade|ripple|one after another|one by one|in turn)\b/.test(text);

  if (isClearPrompt(text)) {
    return {
      beats: [],
      loop: false,
      stagger: false,
      ensemble,
      clear: true,
      fallback: false,
      label: 'Clear',
    };
  }

  const segments = expandCommaMotionLists(splitSequenceSegments(text));
  const globalDuration = parseDuration(text);
  const segmentDurations = segments.map((segment) => parseDuration(segment));
  const explicitCount = segmentDurations.filter((value) => value != null).length;

  const drafted = segments.map((segment, index) => {
    let kinds = findMotions(segment);
    let fallback = false;
    if (!kinds.length) {
      const mood = moodKinds(segment);
      if (mood) return { mood, segment, fallback: false };
      // Whole-prompt moods still apply when a middle beat is vague.
      if (segments.length === 1) {
        const globalMood = moodKinds(text);
        if (globalMood) return { mood: globalMood, segment, fallback: false };
      }
      kinds = ['drift'];
      fallback = true;
    }
    return { kinds, segment, fallback, explicit: segmentDurations[index] };
  });

  const moodOnly = drafted.length === 1 && 'mood' in drafted[0] && drafted[0].mood;
  const beatSources: { kinds: MotionKind[]; segment: string; explicit: number | null; fallback: boolean }[] = moodOnly
    ? drafted[0].mood!.map((kinds) => ({
      kinds,
      segment: segments[0],
      explicit: segmentDurations[0],
      fallback: false,
    }))
    : drafted.map((item) => ({
      kinds: 'kinds' in item && item.kinds ? item.kinds : ['drift'],
      segment: item.segment,
      explicit: 'explicit' in item ? item.explicit ?? null : null,
      fallback: item.fallback,
    }));

  let beats: PromptMotionBeat[] = beatSources.map((source) => {
    const { ease, easeBezier } = parseEase(source.segment);
    return {
      kinds: source.kinds,
      intensity: parseIntensity(source.segment),
      duration: beatDuration(source.segment, source.kinds, source.explicit),
      ease,
      easeBezier,
      direction: parseDirection(source.segment),
    };
  });

  if (globalDuration != null && explicitCount <= 1) {
    const sum = beats.reduce((total, beat) => total + beat.duration, 0) || 1;
    beats = beats.map((beat) => ({
      ...beat,
      duration: roundTime(Math.min(20, Math.max(0.8, beat.duration * (globalDuration / sum)))),
    }));
  } else {
    beats = beats.map((beat) => ({ ...beat, duration: roundTime(Math.min(20, Math.max(0.8, beat.duration))) }));
  }

  const loopHint = parseLoop(text, beats[0]?.kinds[0] ?? 'drift');
  const last = beats[beats.length - 1]?.kinds ?? [];
  const endsOneShot = last.length > 0 && last.every((kind) => ONE_SHOT_KINDS.has(kind));
  const loop = loopHint ?? !endsOneShot;

  const label = beats
    .map((beat) => beat.kinds.map(kindLabel).join(' + '))
    .join(' → ');

  return {
    beats,
    loop,
    stagger,
    ensemble,
    clear: false,
    fallback: beatSources.every((source) => source.fallback),
    label,
  };
}

function shiftTracks(tracks: AnimTrack[], offset: number): AnimTrack[] {
  if (Math.abs(offset) < 0.001) return tracks;
  return tracks.map((item) => createTrack(
    item.targetId,
    item.property,
    item.keyframes.map((key) => kf(roundTime(key.time + offset), key.value, key.ease, key.easeBezier)),
  ));
}

function trackEnd(tracks: AnimTrack[]) {
  return tracks.reduce((max, item) => {
    const last = item.keyframes[item.keyframes.length - 1];
    return Math.max(max, last?.time ?? 0);
  }, 0);
}

/** Add motion deltas when two moves share a property, so "spin while floating" stacks. */
function layerTracks(
  groups: AnimTrack[][],
  devices: DeviceInstance[],
  ease: AnimEase,
  easeBezier?: EaseBezier,
): AnimTrack[] {
  const buckets = new Map<string, AnimTrack[]>();
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.targetId}|${item.property}`;
      const list = buckets.get(key);
      if (list) list.push(item);
      else buckets.set(key, [item]);
    }
  }

  const camera = defaultCameraPosition('front', false);
  const layered: AnimTrack[] = [];
  for (const [key, tracks] of buckets) {
    if (tracks.length === 1) {
      layered.push(tracks[0]);
      continue;
    }
    const [targetId, property] = key.split('|') as [string, AnimProperty];
    const device = devices.find((item) => item.id === targetId);
    const base = property === 'camera.x' ? camera.x
      : property === 'camera.y' ? camera.y
        : property === 'camera.z' ? camera.z
          : device ? readProperty(device, property) : 0;
    const times = new Set<number>([0]);
    for (const item of tracks) {
      for (const frame of item.keyframes) times.add(roundTime(frame.time));
    }
    const keys = [...times].sort((a, b) => a - b).map((time) => {
      let delta = 0;
      for (const item of tracks) {
        const value = sampleTrack(item, time);
        if (value == null) continue;
        delta += value - base;
      }
      return kf(time, Math.round((base + delta) * 1000) / 1000, ease, easeBezier);
    });
    layered.push(createTrack(targetId, property, keys));
  }
  return layered;
}

function cyclicReturn(property: AnimProperty, first: number, last: number) {
  if (property.startsWith('rotation')) {
    const wrapped = Math.abs(first - last) % 360;
    return Math.min(wrapped, 360 - wrapped) < 1.5;
  }
  if (property === 'scale') return Math.abs(first - last) < 0.03;
  return Math.abs(first - last) < 0.04;
}

/** Continue the next beat from the pose the previous beat landed on. */
function appendTracks(existing: AnimTrack[], incoming: AnimTrack[]): AnimTrack[] {
  const next = existing.map((item) => ({ ...item, keyframes: [...item.keyframes] }));
  for (const track of incoming) {
    const index = next.findIndex((item) => item.targetId === track.targetId && item.property === track.property);
    if (index < 0) {
      next.push(track);
      continue;
    }
    const prev = next[index];
    const last = prev.keyframes[prev.keyframes.length - 1];
    const first = track.keyframes[0];
    const landing = track.keyframes[track.keyframes.length - 1];
    let delta = 0;
    let pinStart = false;
    if (last && first && landing) {
      if (cyclicReturn(track.property, first.value, landing.value)) {
        delta = last.value - first.value;
      } else if (track.property.startsWith('rotation')) {
        delta = Math.round((last.value - landing.value) / 360) * 360;
        const joined = Math.abs((first.value + delta) - last.value) % 360;
        pinStart = Math.min(joined, 360 - joined) > 18;
      } else {
        const gap = track.property === 'scale' ? 0.04 : 0.05;
        pinStart = Math.abs(first.value - last.value) > gap;
      }
    }
    const shifted = track.keyframes.map((key, keyIndex) => ({
      ...key,
      value: pinStart && keyIndex === 0 && last ? last.value : key.value + delta,
    }));
    const rest = shifted.filter((key, keyIndex) => !(keyIndex === 0 && last && Math.abs(key.time - last.time) < 0.05));
    prev.keyframes = [...prev.keyframes, ...rest].sort((a, b) => a.time - b.time);
  }
  return next;
}

function buildBeat(devices: DeviceInstance[], beat: PromptMotionBeat, stagger: boolean): AnimTrack[] {
  const intensity = beat.kinds.length > 1 ? beat.intensity * 0.85 : beat.intensity;
  const intentBase: Omit<PromptIntent, 'kind' | 'label'> = {
    intensity,
    duration: beat.duration,
    loop: null,
    ease: beat.ease,
    easeBezier: beat.easeBezier,
    direction: beat.direction,
  };
  const gap = stagger && devices.length > 1
    ? roundTime(Math.min(0.65, Math.max(0.2, beat.duration * 0.18)))
    : 0;
  const groups: AnimTrack[][] = [];

  for (const kind of beat.kinds) {
    const intent: PromptIntent = { ...intentBase, kind, label: kindLabel(kind) };
    if (CAMERA_KINDS.has(kind)) {
      groups.push(buildForDevice(devices[0], intent));
      continue;
    }
    groups.push(devices.flatMap((device, index) => {
      const built = buildForDevice(device, intent);
      return gap ? shiftTracks(built, gap * index) : built;
    }));
  }

  return layerTracks(groups, devices, beat.ease, beat.easeBezier);
}

function compileTracks(plan: PromptMotionPlan, devices: DeviceInstance[]): AnimTrack[] {
  let tracks: AnimTrack[] = [];
  let cursor = 0;
  for (const beat of plan.beats) {
    const built = shiftTracks(buildBeat(devices, beat, plan.stagger), cursor);
    tracks = appendTracks(tracks, built);
    cursor = trackEnd(tracks);
  }
  return tracks;
}

/** Turn a motion plan into a clip. `ensemblePool` is the whole scene, used for stagger/fan phrasing. */
export function compileMotionPlan(
  plan: PromptMotionPlan,
  clip: AnimationClip,
  devices: DeviceInstance | DeviceInstance[],
  ensemblePool?: DeviceInstance[],
): PromptAnimateResult {
  const primary = Array.isArray(devices) ? devices : [devices];
  const pool = ensemblePool?.length ? ensemblePool : primary;
  const targets = plan.ensemble && pool.length > 1 ? pool : primary;

  if (plan.clear || !plan.beats.length) {
    const clearPreset = getAnimationPreset('clear')!;
    return {
      clip: applyAnimationPreset(clip, targets, clearPreset),
      label: 'Clear',
      summary: targets.length > 1 ? `Cleared animation on ${targets.length} devices` : 'Cleared animation on the selected device',
    };
  }

  const built = compileTracks(plan, targets);
  const duration = roundTime(Math.max(trackEnd(built), 0.8));
  const replaceCamera = built.some((item) => item.targetId === CAMERA_TARGET_ID || isCameraProperty(item.property));
  const kept = clip.tracks.filter((item) => {
    if (replaceCamera && (item.targetId === CAMERA_TARGET_ID || isCameraProperty(item.property))) return false;
    return !targets.some((device) => device.id === item.targetId);
  });

  const feel = intensityWord(plan.beats[0]?.intensity ?? 1);
  const bits = [
    feel,
    plan.label.toLowerCase(),
    `${duration}s`,
    plan.loop ? 'looping' : 'one-shot',
    plan.stagger && targets.length > 1 ? 'staggered' : null,
    targets.length > 1 ? `${targets.length} devices` : null,
  ].filter(Boolean);

  return {
    clip: {
      ...clip,
      duration,
      loop: plan.loop,
      tracks: [...kept, ...built],
    },
    label: plan.label,
    summary: `Applied ${bits.join(' · ')}`,
  };
}

/** Turn a natural-language prompt into keyframed device motion. Local, no network. */
export function promptToAnimation(
  prompt: string,
  clip: AnimationClip,
  devices: DeviceInstance | DeviceInstance[],
  ensemblePool?: DeviceInstance[],
): PromptAnimateResult {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { clip, label: '', summary: 'Enter a motion prompt' };
  }
  return compileMotionPlan(planAnimationPrompt(trimmed), clip, devices, ensemblePool);
}
