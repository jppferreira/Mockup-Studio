import { createKeyframe, createTrack } from './animation';
import { ANIMATION_PRESETS, applyAnimationPreset, getAnimationPreset } from './animationPresets';
import type {
  AnimEase,
  AnimKeyframe,
  AnimProperty,
  AnimTrack,
  AnimationClip,
  DeviceInstance,
  EaseBezier,
} from '../types';

export interface PromptAnimateResult {
  clip: AnimationClip;
  label: string;
  summary: string;
}

export const PROMPT_SUGGESTIONS = [
  'gentle floating turntable',
  'dramatic 360 spin',
  'slow product orbit',
  'quick attention wobble',
  'present and settle',
  'soft tilt toward camera',
  'bounce float loop',
  'clear animation',
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
  if (/\b(one[\s-]?shot|once|reveal|settle|land|present)\b/.test(text) || kind === 'present') return false;
  if (/\b(loop|looping|seamless|infinite|repeat)\b/.test(text)) return true;
  if (kind === 'clear') return null;
  return null;
}

function detectKind(text: string): { kind: MotionKind; label: string } {
  if (
    /^(clear|reset|none)$/.test(text.trim())
    || /\b(clear|reset|remove|delete)\b.*\b(anim|motion|key|clip)/.test(text)
    || /\b(anim|motion|key|clip).*\b(clear|reset|remove|delete)\b/.test(text)
  ) {
    return { kind: 'clear', label: 'Clear' };
  }
  if (/\b(360|full\s*spin|revolv|spin)\b/.test(text)) return { kind: 'spin', label: 'Spin 360' };
  if (/\b(turntable|product\s*spin|showcase\s*spin|y[\s-]?spin)\b/.test(text)) return { kind: 'turntable', label: 'Turntable' };
  if (/\b(orbit|diagonal|3d\s*peek)\b/.test(text)) return { kind: 'orbit', label: 'Orbit' };
  if (/\b(wobble|wiggle|jiggle|shake|attention)\b/.test(text)) return { kind: 'wobble', label: 'Wobble' };
  if (/\b(swing|pendulum|roll)\b/.test(text)) return { kind: 'swing', label: 'Swing' };
  if (/\b(flip)\b/.test(text)) return { kind: 'flip', label: 'Flip' };
  if (/\b(tilt|pitch|lean)\b/.test(text)) return { kind: 'tilt', label: 'Tilt' };
  if (/\b(zoom|punch|scale\s*in|close[\s-]?up)\b/.test(text)) return { kind: 'zoom', label: 'Zoom In' };
  if (/\b(present|reveal|intro|entrance|settle)\b/.test(text)) return { kind: 'present', label: 'Present' };
  if (/\b(bounce)\b/.test(text)) return { kind: 'bounce', label: 'Bounce' };
  if (/\b(float|hover|bob|levitat)\b/.test(text)) return { kind: 'float', label: 'Float' };
  if (/\b(rotate|rotation|spinning|turn)\b/.test(text)) return { kind: 'turntable', label: 'Turntable' };
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

function buildForDevice(device: DeviceInstance, intent: PromptIntent): AnimTrack[] {
  if (intent.kind === 'clear') return [];
  if (intent.kind === 'bounce') return buildBounce(device, intent);
  if (intent.kind === 'flip') return buildFlip(device, intent);
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

function summarize(intent: PromptIntent): string {
  if (intent.kind === 'clear') return 'Cleared animation on the selected device';
  const bits = [
    intensityWord(intent.intensity),
    intent.label.toLowerCase(),
    intent.duration ? `${intent.duration}s` : null,
    intent.loop === false ? 'one-shot' : intent.loop ? 'looping' : null,
  ].filter(Boolean);
  return `Applied ${bits.join(' · ')}`;
}

/** Turn a natural-language prompt into keyframed device motion. Local, no network. */
export function promptToAnimation(
  prompt: string,
  clip: AnimationClip,
  devices: DeviceInstance | DeviceInstance[],
): PromptAnimateResult {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { clip, label: '', summary: 'Enter a motion prompt' };
  }

  const targets = Array.isArray(devices) ? devices : [devices];
  const intent = parseAnimationPrompt(trimmed);

  if (intent.kind === 'clear') {
    const clearPreset = getAnimationPreset('clear')!;
    return {
      clip: applyAnimationPreset(clip, targets, clearPreset),
      label: 'Clear',
      summary: summarize(intent),
    };
  }

  // Exact preset phrase → stock preset (still honour intensity / duration overrides)
  const exact = ANIMATION_PRESETS.find((p) => {
    const id = p.id.toLowerCase();
    const label = p.label.toLowerCase();
    const q = trimmed.toLowerCase();
    return q === id || q === label || q.includes(id) && q.split(/\s+/).length <= 3;
  });

  const duration = intent.duration ?? exact?.duration ?? defaultDuration(intent.kind);
  const loop = intent.loop ?? (intent.kind === 'present' || intent.kind === 'flip' ? false : true);

  const kept = clip.tracks.filter((t) => !targets.some((d) => d.id === t.targetId));
  const built = targets.flatMap((device) => buildForDevice(device, { ...intent, duration }));

  return {
    clip: {
      ...clip,
      duration,
      loop,
      tracks: [...kept, ...built],
    },
    label: intent.label,
    summary: summarize({ ...intent, duration, loop }),
  };
}
