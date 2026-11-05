import type { CompositionTemplate } from './templates';
import {
  CAMERA_LENSES, CAMERA_TARGET_ID, DEVICE_COLORS, EXPORT_SIZE_LIMITS, SCENE_PROP_KINDS,
  normalizeGradientColors,
  type AnimProperty, type AnimationClip, type CameraLens, type CameraView, type DeviceColor,
  type GradientColors, type MockupProject, type Vec3,
} from '../types';
import type { DeviceId } from './devices';

const SIZE_KEY = 'mockup-studio.saved-sizes';
const ANGLE_KEY = 'mockup-studio.saved-angles';
const COMP_KEY = 'mockup-studio.saved-compositions';
const MAX_ITEMS = 24;

export const COMPOSITION_SLOT = (index: number) => `slot-${index}`;

export interface SavedAssetSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface SavedAngle {
  id: string;
  label: string;
  hint: string;
  rotation: Vec3;
}

const CAMERA_VIEWS = new Set<CameraView>(['front', 'left', 'right', 'top']);
const CAMERA_LENS_IDS = new Set<CameraLens>(CAMERA_LENSES.map((item) => item.id));
const DEVICE_COLOR_IDS = new Set<DeviceColor>(DEVICE_COLORS.map((item) => item.id));
const PROP_KINDS = new Set<string>(SCENE_PROP_KINDS);
const ANIM_PROPS = new Set<AnimProperty>([
  'rotation.x', 'rotation.y', 'rotation.z',
  'position.x', 'position.y', 'position.z',
  'scale', 'camera.x', 'camera.y', 'camera.z',
]);

function readList(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: unknown[]) {
  localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

function evenSize(n: number) {
  const v = Math.max(EXPORT_SIZE_LIMITS.min, Math.min(EXPORT_SIZE_LIMITS.max, Math.round(n)));
  return v % 2 === 0 ? v : v - 1;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function vec3(value: unknown, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (!value || typeof value !== 'object') return { ...fallback };
  const entry = value as Partial<Vec3>;
  return {
    x: finite(entry.x, fallback.x),
    y: finite(entry.y, fallback.y),
    z: finite(entry.z, fallback.z),
  };
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function loadSavedSizes(): SavedAssetSize[] {
  return readList(SIZE_KEY).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<SavedAssetSize>;
    if (typeof entry.id !== 'string' || !entry.id.startsWith('size-')) return [];
    if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
    const width = evenSize(finite(entry.width, 0));
    const height = evenSize(finite(entry.height, 0));
    if (width < EXPORT_SIZE_LIMITS.min || height < EXPORT_SIZE_LIMITS.min) return [];
    return [{
      id: entry.id,
      label: entry.label.trim().slice(0, 40),
      width,
      height,
    }];
  }).slice(0, MAX_ITEMS);
}

export function saveAssetSize(label: string, width: number, height: number): SavedAssetSize {
  const sizes = loadSavedSizes();
  const nextWidth = evenSize(width);
  const nextHeight = evenSize(height);
  const saved: SavedAssetSize = {
    id: newId('size'),
    label: label.trim().slice(0, 40) || `${nextWidth}×${nextHeight}`,
    width: nextWidth,
    height: nextHeight,
  };
  writeList(SIZE_KEY, [saved, ...sizes]);
  return saved;
}

export function deleteSavedSize(id: string): SavedAssetSize[] {
  const next = loadSavedSizes().filter((item) => item.id !== id);
  writeList(SIZE_KEY, next);
  return next;
}

export function loadSavedAngles(): SavedAngle[] {
  return readList(ANGLE_KEY).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<SavedAngle>;
    if (typeof entry.id !== 'string' || !entry.id.startsWith('angle-')) return [];
    if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
    const rotation = vec3(entry.rotation);
    return [{
      id: entry.id,
      label: entry.label.trim().slice(0, 24),
      hint: typeof entry.hint === 'string' && entry.hint.trim()
        ? entry.hint.trim().slice(0, 80)
        : angleHint(rotation),
      rotation: {
        x: round1(clamp(rotation.x, -180, 180)),
        y: round1(clamp(rotation.y, -180, 180)),
        z: round1(clamp(rotation.z, -180, 180)),
      },
    }];
  }).slice(0, MAX_ITEMS);
}

function angleHint(rotation: Vec3) {
  return `${round1(rotation.x)}°  ${round1(rotation.y)}°  ${round1(rotation.z)}°`;
}

export function saveAngle(label: string, rotation: Vec3): SavedAngle {
  const angles = loadSavedAngles();
  const next = {
    x: round1(clamp(rotation.x, -180, 180)),
    y: round1(clamp(rotation.y, -180, 180)),
    z: round1(clamp(rotation.z, -180, 180)),
  };
  const saved: SavedAngle = {
    id: newId('angle'),
    label: label.trim().slice(0, 24) || `Angle ${angles.length + 1}`,
    hint: angleHint(next),
    rotation: next,
  };
  writeList(ANGLE_KEY, [saved, ...angles]);
  return saved;
}

export function deleteSavedAngle(id: string): SavedAngle[] {
  const next = loadSavedAngles().filter((item) => item.id !== id);
  writeList(ANGLE_KEY, next);
  return next;
}

function cleanAnimation(clip: unknown, deviceCount: number): AnimationClip | undefined {
  if (!clip || typeof clip !== 'object') return undefined;
  const entry = clip as Partial<AnimationClip>;
  const allowed = new Set(Array.from({ length: deviceCount }, (_, index) => COMPOSITION_SLOT(index)));
  allowed.add(CAMERA_TARGET_ID);
  const tracks = Array.isArray(entry.tracks) ? entry.tracks.flatMap((track) => {
    if (!track || typeof track !== 'object') return [];
    const row = track as AnimationClip['tracks'][number];
    if (typeof row.targetId !== 'string' || !allowed.has(row.targetId)) return [];
    if (!ANIM_PROPS.has(row.property)) return [];
    const keyframes = Array.isArray(row.keyframes) ? row.keyframes.flatMap((frame) => {
      if (!frame || typeof frame !== 'object') return [];
      const key = frame as AnimationClip['tracks'][number]['keyframes'][number];
      if (!Number.isFinite(key.time) || !Number.isFinite(key.value)) return [];
      return [{
        id: typeof key.id === 'string' ? key.id : newId('kf'),
        time: clamp(key.time, 0, 120),
        value: key.value,
        ease: key.ease,
        easeBezier: key.easeBezier,
      }];
    }).slice(0, 48) : [];
    if (!keyframes.length) return [];
    return [{
      id: typeof row.id === 'string' ? row.id : newId('track'),
      targetId: row.targetId,
      property: row.property,
      keyframes,
    }];
  }).slice(0, 64) : [];
  return {
    duration: clamp(finite(entry.duration, 4), 0.2, 120),
    fps: [24, 30, 60].includes(finite(entry.fps, 30)) ? finite(entry.fps, 30) as 24 | 30 | 60 : 30,
    loop: entry.loop !== false,
    tracks,
  };
}

function previewForCount(count: number, mode: MockupProject['compositionMode']): CompositionTemplate['preview'] {
  if (mode === 'split') return 'split';
  if (count <= 1) return 'solo';
  if (count === 2) return 'pair';
  return 'trio';
}

export function loadSavedCompositions(): CompositionTemplate[] {
  return readList(COMP_KEY).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<CompositionTemplate>;
    if (typeof entry.id !== 'string' || !entry.id.startsWith('comp-')) return [];
    if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
    if (!Array.isArray(entry.devices) || entry.devices.length === 0) return [];
    const devices = entry.devices.flatMap((device) => {
      if (!device || typeof device !== 'object' || typeof device.deviceId !== 'string') return [];
      return [{
        deviceId: device.deviceId as DeviceId,
        rotation: vec3(device.rotation),
        position: vec3(device.position),
        scale: clamp(finite(device.scale, 1), 0.2, 3),
      }];
    }).slice(0, 6);
    if (!devices.length) return [];
    const mode = entry.compositionMode === 'split' ? 'split' as const : 'single' as const;
    const gradient = entry.gradient && typeof entry.gradient === 'object'
      ? normalizeGradientColors(entry.gradient as Partial<GradientColors>)
      : undefined;
    const sceneProps = Array.isArray(entry.sceneProps) ? entry.sceneProps.flatMap((prop) => {
      if (!prop || typeof prop !== 'object' || !PROP_KINDS.has(prop.kind)) return [];
      return [{
        kind: prop.kind,
        position: vec3(prop.position),
        rotation: vec3(prop.rotation),
        scale: typeof prop.scale === 'number'
          ? clamp(prop.scale, 0.05, 8)
          : vec3(prop.scale, { x: 1, y: 1, z: 1 }),
        color: typeof prop.color === 'string' ? prop.color.slice(0, 16) : undefined,
      }];
    }).slice(0, 24) : [];
    const template: CompositionTemplate = {
      id: entry.id,
      label: entry.label.trim().slice(0, 40),
      description: typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim().slice(0, 80)
        : `${devices.length} device${devices.length === 1 ? '' : 's'}`,
      badge: 'Saved',
      category: 'saved',
      preview: previewForCount(devices.length, mode),
      background: typeof entry.background === 'string' ? entry.background : 'midnight',
      gradient,
      compositionMode: mode,
      devices,
      sceneProps,
      lightIntensity: finite(entry.lightIntensity, 1),
      fillIntensity: finite(entry.fillIntensity, 0.5),
      shadowOpacity: finite(entry.shadowOpacity, 0.35),
      shadowSoftness: finite(entry.shadowSoftness, 2),
      showGroundBase: entry.showGroundBase !== false,
      linkSplitTransform: entry.linkSplitTransform !== false,
      cameraView: CAMERA_VIEWS.has(entry.cameraView as CameraView) ? entry.cameraView : undefined,
      cameraLens: CAMERA_LENS_IDS.has(entry.cameraLens as CameraLens) ? entry.cameraLens : undefined,
      lightPosition: entry.lightPosition ? vec3(entry.lightPosition) : undefined,
      lightColor: typeof entry.lightColor === 'string' ? entry.lightColor.slice(0, 16) : undefined,
      deviceExtras: Array.isArray(entry.deviceExtras)
        ? entry.deviceExtras.slice(0, devices.length).map((extra) => ({
          glassReflection: extra && typeof extra.glassReflection === 'number'
            ? clamp(extra.glassReflection, 0, 1)
            : undefined,
          lidOpen: extra && typeof extra.lidOpen === 'number' ? clamp(extra.lidOpen, 0, 1) : undefined,
          deviceColor: extra && DEVICE_COLOR_IDS.has(extra.deviceColor as DeviceColor)
            ? extra.deviceColor
            : undefined,
          clayMode: extra?.clayMode === true,
        }))
        : undefined,
      overlays: Array.isArray(entry.overlays) ? entry.overlays.flatMap((overlay) => {
        if (!overlay || (overlay.kind !== 'text' && overlay.kind !== 'comment')) return [];
        return [{
          id: typeof overlay.id === 'string' ? overlay.id : newId('overlay'),
          kind: overlay.kind === 'comment' ? 'comment' as const : 'text' as const,
          x: clamp(finite(overlay.x, 0.5), 0, 1),
          y: clamp(finite(overlay.y, 0.2), 0, 1),
          scale: clamp(finite(overlay.scale, 1), 0.2, 4),
          opacity: clamp(finite(overlay.opacity, 1), 0, 1),
          startTime: clamp(finite(overlay.startTime, 0), 0, 120),
          endTime: clamp(finite(overlay.endTime, 30), 0, 120),
          text: typeof overlay.text === 'string' ? overlay.text.slice(0, 240) : '',
          color: typeof overlay.color === 'string' ? overlay.color.slice(0, 16) : '#ffffff',
          fontSize: clamp(finite(overlay.fontSize, 0.055), 0.01, 0.3),
          extrusion: clamp(finite(overlay.extrusion, 0), 0, 1),
        }];
      }).slice(0, 12) : undefined,
      animation: cleanAnimation(entry.animation, devices.length),
      edgeBlurTop: entry.edgeBlurTop === true,
      edgeBlurBottom: entry.edgeBlurBottom === true,
      edgeBlurAmount: clamp(finite(entry.edgeBlurAmount, 0), 0, 80),
    };
    return [template];
  }).slice(0, MAX_ITEMS);
}

export function saveComposition(label: string, project: MockupProject): CompositionTemplate {
  const compositions = loadSavedCompositions();
  const devices = project.devices.slice(0, 6);
  const mode = project.compositionMode === 'split' ? 'split' as const : 'single' as const;
  const indexById = new Map(devices.map((device, index) => [device.id, index]));
  const saved: CompositionTemplate = {
    id: newId('comp'),
    label: label.trim().slice(0, 40) || project.name.trim().slice(0, 40) || `Composition ${compositions.length + 1}`,
    description: `${devices.length} device${devices.length === 1 ? '' : 's'} · ${mode === 'split' ? 'Split' : 'Single'}`,
    badge: 'Saved',
    category: 'saved',
    preview: previewForCount(devices.length, mode),
    background: project.background,
    gradient: { ...project.gradientColors },
    compositionMode: mode,
    linkSplitTransform: project.linkSplitTransform !== false,
    devices: devices.map((device) => ({
      deviceId: device.deviceId,
      rotation: { ...device.rotation },
      position: { ...device.position },
      scale: device.scale,
    })),
    deviceExtras: devices.map((device) => ({
      glassReflection: device.glassReflection,
      lidOpen: device.lidOpen,
      deviceColor: device.deviceColor,
      clayMode: device.clayMode,
    })),
    sceneProps: (project.sceneProps ?? []).slice(0, 24).map((prop) => ({
      kind: prop.kind,
      position: { ...prop.position },
      rotation: { ...prop.rotation },
      scale: typeof prop.scale === 'number' ? prop.scale : { ...prop.scale },
      color: prop.color,
    })),
    lightIntensity: project.lightIntensity,
    fillIntensity: project.fillIntensity,
    shadowOpacity: project.shadowOpacity,
    shadowSoftness: project.shadowSoftness,
    showGroundBase: project.showGroundBase !== false,
    lightPosition: { ...project.lightPosition },
    lightColor: project.lightColor,
    cameraView: project.cameraView,
    cameraLens: project.cameraLens,
    edgeBlurTop: project.edgeBlurTop,
    edgeBlurBottom: project.edgeBlurBottom,
    edgeBlurAmount: project.edgeBlurAmount,
    overlays: (project.overlays ?? []).filter((overlay) => overlay.kind === 'text' || overlay.kind === 'comment').slice(0, 12).map((overlay) => ({
      ...overlay,
      imageData: null,
    })),
    animation: {
      duration: project.animation.duration,
      fps: project.animation.fps,
      loop: project.animation.loop,
      tracks: project.animation.tracks.flatMap((track) => {
        if (track.targetId === CAMERA_TARGET_ID) {
          return [{ ...track, targetId: CAMERA_TARGET_ID }];
        }
        const index = indexById.get(track.targetId);
        if (index == null) return [];
        return [{ ...track, targetId: COMPOSITION_SLOT(index) }];
      }),
    },
  };
  writeList(COMP_KEY, [saved, ...compositions]);
  return saved;
}

export function deleteSavedComposition(id: string): CompositionTemplate[] {
  const next = loadSavedCompositions().filter((item) => item.id !== id);
  writeList(COMP_KEY, next);
  return next;
}
