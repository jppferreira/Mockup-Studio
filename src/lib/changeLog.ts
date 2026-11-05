import { isPlaceholderScreenshot } from './demo';
import { getDevice } from './devices';
import type { SceneOverlay } from './overlays';
import type {
  AnimationClip, CompositionLayer, DeviceInstance, MockupProject, SceneProp, Vec3,
} from '../types';

/** One undo step. `before` is the composition as it was when the edit started. */
export interface ChangeLogEntry {
  id: string;
  at: number;
  touchedAt: number;
  summary: string;
  before: MockupProject;
}

const COALESCE_MS = 800;
const MAX_ENTRIES = 30;

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function numClose(a: number | undefined, b: number | undefined, epsilon = 0.001) {
  return Math.abs((a ?? 0) - (b ?? 0)) < epsilon;
}

function vecClose(a: Vec3 | undefined, b: Vec3 | undefined, epsilon = 0.001) {
  if (!a || !b) return a === b;
  return numClose(a.x, b.x, epsilon) && numClose(a.y, b.y, epsilon) && numClose(a.z, b.z, epsilon);
}

function shotChanged(before: string | null | undefined, after: string | null | undefined) {
  if ((before ?? null) === (after ?? null)) return false;
  if (isPlaceholderScreenshot(before) && isPlaceholderScreenshot(after)) return false;
  return true;
}

function deviceLabel(device: DeviceInstance) {
  return getDevice(device.deviceId).label;
}

function describeDevices(before: MockupProject, after: MockupProject): string[] {
  const notes: string[] = [];
  const beforeById = new Map(before.devices.map((device) => [device.id, device]));
  const afterById = new Map(after.devices.map((device) => [device.id, device]));
  for (const device of after.devices) {
    if (!beforeById.has(device.id)) notes.push(`Added ${deviceLabel(device)}`);
  }
  for (const device of before.devices) {
    if (!afterById.has(device.id)) notes.push(`Removed ${deviceLabel(device)}`);
  }

  let moved = 0;
  let restyled = 0;
  let screens = 0;
  for (const device of after.devices) {
    const prev = beforeById.get(device.id);
    if (!prev) continue;
    if (prev.deviceId !== device.deviceId) notes.push(`Switched to ${deviceLabel(device)}`);
    const movedPose = !vecClose(prev.rotation, device.rotation, 0.05)
      || !vecClose(prev.position, device.position)
      || !numClose(prev.scale, device.scale)
      || !numClose(prev.lidOpen ?? 1, device.lidOpen ?? 1);
    if (movedPose) moved += 1;
    const prevColor = prev.deviceColor ?? before.deviceColor;
    const nextColor = device.deviceColor ?? after.deviceColor;
    const prevClay = prev.clayMode ?? before.clayMode;
    const nextClay = device.clayMode ?? after.clayMode;
    if (prevColor !== nextColor || prevClay !== nextClay || !numClose(prev.glassReflection, device.glassReflection)) {
      restyled += 1;
    }
    if (shotChanged(prev.screenshot, device.screenshot)) screens += 1;
  }

  if (moved === 1) notes.push('Adjusted the device');
  else if (moved > 1) notes.push('Adjusted the devices');
  if (restyled > 0) notes.push('Changed the finish');
  if (screens > 0) notes.push('Updated the screen');
  return notes;
}

function propSig(props: SceneProp[] | undefined) {
  return JSON.stringify((props ?? []).map((prop) => ({
    kind: prop.kind,
    position: { x: round(prop.position.x), y: round(prop.position.y), z: round(prop.position.z) },
    rotation: { x: round(prop.rotation.x), y: round(prop.rotation.y), z: round(prop.rotation.z) },
    scale: typeof prop.scale === 'number'
      ? round(prop.scale)
      : { x: round(prop.scale.x), y: round(prop.scale.y), z: round(prop.scale.z) },
    color: prop.color ?? '',
  })));
}

function overlaySig(overlays: SceneOverlay[] | undefined) {
  return JSON.stringify((overlays ?? []).map((overlay) => ({
    kind: overlay.kind,
    x: round(overlay.x),
    y: round(overlay.y),
    scale: round(overlay.scale),
    opacity: round(overlay.opacity),
    text: overlay.text ?? '',
    color: overlay.color ?? '',
    fontSize: overlay.fontSize ?? 0,
    extrusion: overlay.extrusion ?? 0,
    image: overlay.imageData ? overlay.imageData.length : 0,
    start: round(overlay.startTime),
    end: round(overlay.endTime),
  })));
}

function animSig(clip: AnimationClip | undefined) {
  if (!clip) return '';
  return JSON.stringify({
    duration: clip.duration,
    fps: clip.fps,
    loop: clip.loop,
    tracks: clip.tracks.map((track) => ({
      targetId: track.targetId,
      property: track.property,
      keyframes: track.keyframes.map((key) => ({
        time: round(key.time),
        value: round(key.value),
        ease: key.ease ?? 'easeInOut',
        bezier: key.easeBezier ?? null,
      })),
    })),
  });
}

function layerSig(layers: CompositionLayer[] | undefined) {
  return JSON.stringify((layers ?? []).map((layer) => `${layer.kind}:${layer.refId}:${layer.visible ? 1 : 0}`));
}

function describeScenes(before: MockupProject, after: MockupProject): string | null {
  const previous = before.scenes ?? [];
  const next = after.scenes ?? [];
  if (previous.length < next.length) return 'Added a scene';
  if (previous.length > next.length) return 'Removed a scene';
  if (next.some((scene) => {
    const prior = previous.find((item) => item.id === scene.id);
    return prior != null && prior.name !== scene.name;
  })) return 'Renamed a scene';
  if (next.some((scene) => {
    const prior = previous.find((item) => item.id === scene.id);
    if (!prior) return true;
    return prior.background !== scene.background
      || JSON.stringify(prior.gradientColors) !== JSON.stringify(scene.gradientColors);
  })) return 'Updated a scene';
  if ((before.activeSceneId ?? '') !== (after.activeSceneId ?? '')) return 'Switched scene';
  if (before.background !== after.background) return 'Changed the background';
  if (JSON.stringify(before.gradientColors) !== JSON.stringify(after.gradientColors)) return 'Changed the background';
  return null;
}

/** Human label for a composition edit. `null` when nothing worth restoring changed. */
export function describeProjectChange(before: MockupProject, after: MockupProject): string | null {
  if (before === after) return null;
  const notes: string[] = [];
  const push = (note: string | null) => {
    if (note && !notes.includes(note)) notes.push(note);
  };

  if (before.name !== after.name) push(`Renamed to “${after.name.trim() || 'Untitled'}”`);
  notes.push(...describeDevices(before, after).filter((note) => !notes.includes(note)));
  push(describeScenes(before, after));

  const lighting = !numClose(before.lightIntensity, after.lightIntensity)
    || !numClose(before.fillIntensity, after.fillIntensity)
    || !numClose(before.shadowOpacity, after.shadowOpacity)
    || !numClose(before.shadowSoftness, after.shadowSoftness)
    || before.lightColor !== after.lightColor
    || !vecClose(before.lightPosition, after.lightPosition, 0.01);
  if (lighting) push('Adjusted the lighting');

  if (before.cameraView !== after.cameraView || before.cameraLens !== after.cameraLens) push('Changed the camera');
  if (before.compositionMode !== after.compositionMode) {
    push(after.compositionMode === 'split' ? 'Split the composition' : 'Switched to a single device');
  }
  if ((before.linkSplitTransform !== false) !== (after.linkSplitTransform !== false)) {
    push(after.linkSplitTransform === false ? 'Unlinked the devices' : 'Linked the devices');
  }
  if (before.publishTarget !== after.publishTarget) {
    push(after.publishTarget === 'ios' ? 'Switched to iOS' : 'Switched to Android');
  }
  if (
    before.edgeBlurTop !== after.edgeBlurTop
    || before.edgeBlurBottom !== after.edgeBlurBottom
    || !numClose(before.edgeBlurAmount, after.edgeBlurAmount)
  ) push('Adjusted the edge blur');
  if (before.reflectionMap !== after.reflectionMap || (before.reflectionMapImage ?? null) !== (after.reflectionMapImage ?? null)) {
    push('Changed reflections');
  }
  if (propSig(before.sceneProps) !== propSig(after.sceneProps)) push('Updated the set');

  const overlaysChanged = overlaySig(before.overlays) !== overlaySig(after.overlays);
  if (overlaysChanged) {
    const previous = before.overlays?.length ?? 0;
    const next = after.overlays?.length ?? 0;
    if (next > previous) push('Added an overlay');
    else if (next < previous) push('Removed an overlay');
    else push('Edited an overlay');
  }

  if (animSig(before.animation) !== animSig(after.animation)) push('Edited the timeline');

  const structureChanged = before.devices.length !== after.devices.length
    || propSig(before.sceneProps) !== propSig(after.sceneProps)
    || overlaysChanged;
  if (!structureChanged && layerSig(before.layers) !== layerSig(after.layers)) push('Updated layers');

  if ((before.soundtrackName ?? null) !== (after.soundtrackName ?? null) || (before.soundtrackData ?? null) !== (after.soundtrackData ?? null)) {
    push(after.soundtrackName ? 'Updated the soundtrack' : 'Removed the soundtrack');
  } else if (
    !numClose(before.soundtrackStart, after.soundtrackStart)
    || !numClose(before.soundtrackOffset, after.soundtrackOffset)
    || !numClose(before.soundtrackDuration, after.soundtrackDuration)
    || !numClose(before.soundtrackFadeIn, after.soundtrackFadeIn)
    || !numClose(before.soundtrackFadeOut, after.soundtrackFadeOut)
  ) push('Adjusted the soundtrack');

  if (!shotChanged(before.screenshot, after.screenshot)) {
    /* mirrored with the device shot */
  } else if (!notes.includes('Updated the screen')) {
    push('Updated the screen');
  }

  if (!notes.length) return null;
  if (notes.length > 3) return 'Updated the composition';
  return notes.join(' · ');
}

/**
 * Push a restorable step. A burst of the same edit (a drag) stays one step
 * whose snapshot is the composition from before the burst started.
 */
export function recordProjectChange(
  entries: ChangeLogEntry[],
  before: MockupProject,
  after: MockupProject,
  now = Date.now(),
): ChangeLogEntry[] {
  const summary = describeProjectChange(before, after);
  if (!summary) return entries;
  const latest = entries[0];
  if (latest && latest.summary === summary && now - latest.touchedAt < COALESCE_MS) {
    const next = entries.slice();
    next[0] = { ...latest, at: now, touchedAt: now };
    return next;
  }
  return [{
    id: `chg-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: now,
    touchedAt: now,
    summary,
    before,
  }, ...entries].slice(0, MAX_ENTRIES);
}

export function formatChangeTime(at: number, now = Date.now()) {
  const delta = Math.max(0, now - at);
  if (delta < 20_000) return 'Just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
