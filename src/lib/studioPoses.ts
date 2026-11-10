/** One-click product angles. Degrees, same axes as the device transform. */
export interface StudioPose {
  id: string;
  label: string;
  hint: string;
  rotation: { x: number; y: number; z: number };
}

/**
 * Studio angles in the Rotato sense: a finished product shot, not a raw axis.
 * Negative X reclines the top edge away from camera. Positive Y shows the right edge.
 */
export const STUDIO_POSES: StudioPose[] = [
  {
    id: 'front',
    label: 'Front',
    hint: 'Straight-on product shot',
    rotation: { x: 0, y: 0, z: 0 },
  },
  {
    id: 'three-left',
    label: '¾ Left',
    hint: 'Left three-quarter, top edge back',
    rotation: { x: -12, y: -32, z: 0 },
  },
  {
    id: 'three-right',
    label: '¾ Right',
    hint: 'Right three-quarter, top edge back',
    rotation: { x: -12, y: 32, z: 0 },
  },
  {
    id: 'hero',
    label: 'Hero',
    hint: 'Marketing three-quarter',
    rotation: { x: -8, y: 22, z: 0 },
  },
  {
    id: 'iso',
    label: 'Iso',
    hint: 'Even isometric studio angle',
    // Keep Z near 0 so the product stays right-side up in frame.
    rotation: { x: -22, y: 34, z: 2 },
  },
  {
    id: 'float',
    label: 'Float',
    hint: 'Hover with a soft roll',
    rotation: { x: -8, y: 16, z: -2 },
  },
  {
    id: 'lean',
    label: 'Lean',
    hint: 'Reclined onto a surface',
    rotation: { x: -18, y: 12, z: 0 },
  },
  {
    id: 'side',
    label: 'Side',
    hint: 'Edge profile',
    rotation: { x: -4, y: 72, z: 0 },
  },
];

export function getStudioPose(id: string, extra: StudioPose[] = []): StudioPose | undefined {
  return STUDIO_POSES.find((pose) => pose.id === id) ?? extra.find((pose) => pose.id === id);
}

function poseMatches(pose: StudioPose, rotation: { x: number; y: number; z: number }) {
  return Math.abs(pose.rotation.x - rotation.x) < 0.75
    && Math.abs(pose.rotation.y - rotation.y) < 0.75
    && Math.abs(pose.rotation.z - rotation.z) < 0.75;
}

/** Match a rest pose so the angle button stays selected after a click. */
export function studioPoseIdFor(
  rotation: { x: number; y: number; z: number },
  extra: StudioPose[] = [],
): string | null {
  const saved = extra.find((pose) => poseMatches(pose, rotation));
  if (saved) return saved.id;
  return STUDIO_POSES.find((pose) => poseMatches(pose, rotation))?.id ?? null;
}
