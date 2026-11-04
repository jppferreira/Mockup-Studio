import { createKeyframe, createTrack } from './animation';
import type { AnimProperty, AnimTrack, AnimationClip, DeviceInstance } from '../types';

export interface AnimationPreset {
  id: string;
  label: string;
  description: string;
  duration: number;
  loop: boolean;
  build: (device: DeviceInstance) => AnimTrack[];
}

function track(device: DeviceInstance, property: AnimProperty, values: Array<[number, number]>): AnimTrack {
  return createTrack(
    device.id,
    property,
    values.map(([time, value]) => createKeyframe(time, value)),
  );
}

/** Classic product turntable — gentle Y swing with a little X lift (Rotato-style). */
const turntable: AnimationPreset = {
  id: 'turntable',
  label: 'Turntable',
  description: 'Soft left–right product spin',
  duration: 4,
  loop: true,
  build: (device) => {
    const { x, y } = device.rotation;
    return [
      track(device, 'rotation.y', [[0, y - 28], [2, y + 28], [4, y - 28]]),
      track(device, 'rotation.x', [[0, x], [2, x - 4], [4, x]]),
    ];
  },
};

/** Full 360° showcase spin around Y. */
const spin: AnimationPreset = {
  id: 'spin',
  label: 'Spin 360',
  description: 'Full revolution around Y',
  duration: 5,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    return [
      track(device, 'rotation.y', [[0, y], [2.5, y + 180], [5, y + 360]]),
      track(device, 'rotation.x', [[0, x], [2.5, x - 6], [5, x]]),
      track(device, 'rotation.z', [[0, z], [5, z]]),
    ];
  },
};

/** Floating hover with a slight tilt — good for hero loops. */
const floatPreset: AnimationPreset = {
  id: 'float',
  label: 'Float',
  description: 'Gentle bob with soft tilt',
  duration: 3.5,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    const { x: px, y: py } = device.position;
    return [
      track(device, 'position.y', [[0, py], [1.75, py + 0.18], [3.5, py]]),
      track(device, 'rotation.x', [[0, x - 2], [1.75, x + 5], [3.5, x - 2]]),
      track(device, 'rotation.y', [[0, y - 6], [1.75, y + 6], [3.5, y - 6]]),
      track(device, 'rotation.z', [[0, z], [1.75, z + 2], [3.5, z]]),
      track(device, 'position.x', [[0, px], [3.5, px]]),
    ];
  },
};

/** Dramatic pitch tilt, like flipping the phone toward camera. */
const tilt: AnimationPreset = {
  id: 'tilt',
  label: 'Tilt',
  description: 'Pitch toward the camera',
  duration: 3,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    return [
      track(device, 'rotation.x', [[0, x - 22], [1.5, x + 10], [3, x - 22]]),
      track(device, 'rotation.y', [[0, y - 8], [1.5, y + 8], [3, y - 8]]),
      track(device, 'rotation.z', [[0, z], [3, z]]),
    ];
  },
};

/** Pendulum swing on Z — playful mockup motion. */
const swing: AnimationPreset = {
  id: 'swing',
  label: 'Swing',
  description: 'Pendulum roll on Z',
  duration: 3,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    return [
      track(device, 'rotation.z', [[0, z - 14], [1.5, z + 14], [3, z - 14]]),
      track(device, 'rotation.y', [[0, y - 10], [1.5, y + 10], [3, y - 10]]),
      track(device, 'rotation.x', [[0, x], [3, x]]),
    ];
  },
};

/** Combined orbit peek — Rotato “3D showcase” feel. */
const orbit: AnimationPreset = {
  id: 'orbit',
  label: 'Orbit',
  description: 'Diagonal 3D orbit peek',
  duration: 4.5,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    return [
      track(device, 'rotation.y', [[0, y - 36], [2.25, y + 36], [4.5, y - 36]]),
      track(device, 'rotation.x', [[0, x - 14], [1.2, x + 2], [2.25, x + 10], [3.4, x - 4], [4.5, x - 14]]),
      track(device, 'rotation.z', [[0, z + 6], [2.25, z - 6], [4.5, z + 6]]),
    ];
  },
};

/** Scale punch / zoom into frame. */
const zoom: AnimationPreset = {
  id: 'zoom',
  label: 'Zoom In',
  description: 'Punch scale into frame',
  duration: 2.5,
  loop: true,
  build: (device) => {
    const s = device.scale;
    const { x, y } = device.rotation;
    return [
      track(device, 'scale', [[0, s * 0.72], [1.4, s * 1.04], [2.5, s]]),
      track(device, 'rotation.y', [[0, y - 18], [1.4, y + 8], [2.5, y]]),
      track(device, 'rotation.x', [[0, x - 6], [2.5, x]]),
    ];
  },
};

/** One-shot hero present — settle into the current pose. */
const present: AnimationPreset = {
  id: 'present',
  label: 'Present',
  description: 'One-shot reveal into place',
  duration: 2.2,
  loop: false,
  build: (device) => {
    const { x, y, z } = device.rotation;
    const s = device.scale;
    const { y: py } = device.position;
    return [
      track(device, 'rotation.y', [[0, y - 55], [1.2, y + 8], [2.2, y]]),
      track(device, 'rotation.x', [[0, x - 18], [1.2, x + 4], [2.2, x]]),
      track(device, 'rotation.z', [[0, z + 10], [2.2, z]]),
      track(device, 'scale', [[0, s * 0.78], [1.35, s * 1.03], [2.2, s]]),
      track(device, 'position.y', [[0, py - 0.12], [2.2, py]]),
    ];
  },
};

/** Soft wiggle — attention-grabbing micro-motion. */
const wobble: AnimationPreset = {
  id: 'wobble',
  label: 'Wobble',
  description: 'Quick attention wiggle',
  duration: 2,
  loop: true,
  build: (device) => {
    const { x, y, z } = device.rotation;
    return [
      track(device, 'rotation.z', [[0, z], [0.35, z + 8], [0.7, z - 7], [1.1, z + 5], [1.5, z - 3], [2, z]]),
      track(device, 'rotation.y', [[0, y], [0.5, y + 6], [1.2, y - 5], [2, y]]),
      track(device, 'rotation.x', [[0, x], [0.8, x - 3], [2, x]]),
    ];
  },
};

const clear: AnimationPreset = {
  id: 'clear',
  label: 'Clear',
  description: 'Remove animation on device',
  duration: 4,
  loop: true,
  build: () => [],
};

export const ANIMATION_PRESETS: AnimationPreset[] = [
  turntable,
  spin,
  floatPreset,
  tilt,
  swing,
  orbit,
  zoom,
  present,
  wobble,
  clear,
];

export function getAnimationPreset(id: string): AnimationPreset | undefined {
  return ANIMATION_PRESETS.find((item) => item.id === id);
}

/** Replace tracks for the given device(s) with a Rotato-style preset. */
export function applyAnimationPreset(
  clip: AnimationClip,
  devices: DeviceInstance | DeviceInstance[],
  preset: AnimationPreset,
): AnimationClip {
  const targets = Array.isArray(devices) ? devices : [devices];
  const targetIds = new Set(targets.map((d) => d.id));
  const kept = clip.tracks.filter((t) => !targetIds.has(t.targetId));
  const built = targets.flatMap((device) => preset.build(device));
  return {
    ...clip,
    duration: preset.id === 'clear' ? clip.duration : preset.duration,
    loop: preset.id === 'clear' ? clip.loop : preset.loop,
    tracks: [...kept, ...built],
  };
}
