import type { CompositionTemplate } from './templates';
import {
  CAMERA_LENSES, CAMERA_TARGET_ID, DEVICE_COLORS, EXPORT_SIZE_LIMITS, MAX_SCENE_LIGHTS,
  SCENE_LIGHT_KINDS, SCENE_PROP_KINDS, createSceneLight, normalizeGradientColors,
  type AnimProperty, type AnimationClip, type CameraLens, type CameraView, type DeviceColor,
  type GradientColors, type MaterialTweak, type MockupProject, type SceneLightKind, type Vec3,
} from '../types';
import type { DeviceId } from './devices';
import { normalizeReflectionStyle } from './reflectionStyle';
import { REFLECTION_MAPS } from './reflectionMaps';
import {
  DEFAULT_SHADOW_COLOR,
  isShadowColor,
  SHADOW_DISTANCE_MAX,
  SHADOW_DISTANCE_MIN,
  SHADOW_SOFTNESS_MAX,
  SHADOW_SOFTNESS_MIN,
} from './studioShadows';

const SCENE_LIGHT_KIND_SET = new Set<string>(SCENE_LIGHT_KINDS);
const REFLECTION_MAP_IDS = new Set<string>(REFLECTION_MAPS.map((item) => item.id));

const SIZE_KEY = 'mockup-studio.saved-sizes';
const ANGLE_KEY = 'mockup-studio.saved-angles';
const CAMERA_ANGLE_KEY = 'mockup-studio.saved-camera-angles';
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

/** Bookmarked camera orbit (offset from the framed device). */
export interface SavedCameraAngle {
  id: string;
  label: string;
  hint: string;
  offset: Vec3;
  lookOffset?: Vec3;
  cameraView: CameraView;
  cameraLens: CameraLens;
}

const CAMERA_VIEWS = new Set<CameraView>(['front', 'left', 'right', 'top']);
const CAMERA_LENS_IDS = new Set<CameraLens>(CAMERA_LENSES.map((item) => item.id));
const DEVICE_COLOR_IDS = new Set<DeviceColor>(DEVICE_COLORS.map((item) => item.id));
const PROP_KINDS = new Set<string>(SCENE_PROP_KINDS);
const ANIM_PROPS = new Set<AnimProperty>([
  'rotation.x', 'rotation.y', 'rotation.z',
  'position.x', 'position.y', 'position.z',
  'scale', 'lidOpen', 'camera.x', 'camera.y', 'camera.z',
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

/** Matches types.EYE_CAMERA_DISTANCE — kept local to avoid a circular import. */
const EYE_CAMERA_DISTANCE_FALLBACK = 8.175;

function cameraAngleHint(offset: Vec3, view: CameraView) {
  const dist = Math.sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z);
  return `${view[0].toUpperCase()}${view.slice(1)} · ${dist.toFixed(1)}u`;
}

export function loadSavedCameraAngles(): SavedCameraAngle[] {
  return readList(CAMERA_ANGLE_KEY).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<SavedCameraAngle>;
    if (typeof entry.id !== 'string' || !entry.id.startsWith('cam-')) return [];
    if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
    const offset = vec3(entry.offset, { x: 0, y: 0, z: EYE_CAMERA_DISTANCE_FALLBACK });
    const cameraView = CAMERA_VIEWS.has(entry.cameraView as CameraView)
      ? (entry.cameraView as CameraView)
      : 'front';
    const cameraLens = CAMERA_LENS_IDS.has(entry.cameraLens as CameraLens)
      ? (entry.cameraLens as CameraLens)
      : 'standard';
    const lookOffset = entry.lookOffset ? vec3(entry.lookOffset) : undefined;
    return [{
      id: entry.id,
      label: entry.label.trim().slice(0, 24),
      hint: typeof entry.hint === 'string' && entry.hint.trim()
        ? entry.hint.trim().slice(0, 80)
        : cameraAngleHint(offset, cameraView),
      offset: {
        x: Number(offset.x.toFixed(4)),
        y: Number(offset.y.toFixed(4)),
        z: Number(offset.z.toFixed(4)),
      },
      lookOffset: lookOffset
        ? {
          x: Number(lookOffset.x.toFixed(4)),
          y: Number(lookOffset.y.toFixed(4)),
          z: Number(lookOffset.z.toFixed(4)),
        }
        : undefined,
      cameraView,
      cameraLens,
    }];
  }).slice(0, MAX_ITEMS);
}

export function saveCameraAngle(
  label: string,
  pose: {
    offset: Vec3;
    lookOffset?: Vec3;
    cameraView: CameraView;
    cameraLens: CameraLens;
  },
): SavedCameraAngle {
  const angles = loadSavedCameraAngles();
  const offset = {
    x: Number(pose.offset.x.toFixed(4)),
    y: Number(pose.offset.y.toFixed(4)),
    z: Number(pose.offset.z.toFixed(4)),
  };
  const lookOffset = pose.lookOffset
    ? {
      x: Number(pose.lookOffset.x.toFixed(4)),
      y: Number(pose.lookOffset.y.toFixed(4)),
      z: Number(pose.lookOffset.z.toFixed(4)),
    }
    : undefined;
  const saved: SavedCameraAngle = {
    id: newId('cam'),
    label: label.trim().slice(0, 24) || `Cam ${angles.length + 1}`,
    hint: cameraAngleHint(offset, pose.cameraView),
    offset,
    lookOffset,
    cameraView: pose.cameraView,
    cameraLens: pose.cameraLens,
  };
  writeList(CAMERA_ANGLE_KEY, [saved, ...angles]);
  return saved;
}

export function deleteSavedCameraAngle(id: string): SavedCameraAngle[] {
  const next = loadSavedCameraAngles().filter((item) => item.id !== id);
  writeList(CAMERA_ANGLE_KEY, next);
  return next;
}

function cleanCameraOrbit(value: unknown): CompositionTemplate['cameraOrbit'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as { offset?: unknown; lookOffset?: unknown };
  const offset = vec3(entry.offset, { x: 0, y: 0, z: EYE_CAMERA_DISTANCE_FALLBACK });
  const lookOffset = entry.lookOffset ? vec3(entry.lookOffset) : undefined;
  return {
    offset: {
      x: Number(offset.x.toFixed(4)),
      y: Number(offset.y.toFixed(4)),
      z: Number(offset.z.toFixed(4)),
    },
    ...(lookOffset
      ? {
        lookOffset: {
          x: Number(lookOffset.x.toFixed(4)),
          y: Number(lookOffset.y.toFixed(4)),
          z: Number(lookOffset.z.toFixed(4)),
        },
      }
      : {}),
  };
}

function cleanSceneLights(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const lights = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as { kind?: unknown; id?: unknown };
    if (!SCENE_LIGHT_KIND_SET.has(String(entry.kind))) return [];
    return [createSceneLight({
      ...(item as object),
      kind: entry.kind as SceneLightKind,
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : undefined,
    })];
  }).slice(0, MAX_SCENE_LIGHTS);
  return lights;
}

function cleanMaterialTweaks(value: unknown): Record<string, MaterialTweak> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([name, tweak]) => {
    if (!name.trim() || !tweak || typeof tweak !== 'object') return [];
    return [[name, { ...(tweak as MaterialTweak) }] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function cleanHiddenMeshes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = [...new Set(
    value.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim().slice(0, 120)),
  )];
  return names.length ? names : undefined;
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

export function normalizeCompositions(items: unknown[]): CompositionTemplate[] {
  return items.flatMap((item) => {
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
      badge: 'Template',
      category: 'saved',
      preview: previewForCount(devices.length, mode),
      background: typeof entry.background === 'string' ? entry.background : 'midnight',
      gradient,
      compositionMode: mode,
      devices,
      sceneProps,
      lightIntensity: finite(entry.lightIntensity, 1),
      fillIntensity: finite(entry.fillIntensity, 0.5),
      shadowOpacity: clamp(finite(entry.shadowOpacity, 1), 0, 2),
      shadowSoftness: clamp(finite(entry.shadowSoftness, 7.2), SHADOW_SOFTNESS_MIN, SHADOW_SOFTNESS_MAX),
      shadowType: (['contact', 'soft', 'sharp', 'off'] as const).includes(entry.shadowType as never)
        ? entry.shadowType
        : undefined,
      shadowContact: typeof entry.shadowContact === 'number'
        ? clamp(finite(entry.shadowContact, 0.12), 0, 1)
        : undefined,
      shadowContactEnabled: entry.shadowContactEnabled !== false,
      shadowDistance: typeof entry.shadowDistance === 'number'
        ? clamp(finite(entry.shadowDistance, 3.6), SHADOW_DISTANCE_MIN, SHADOW_DISTANCE_MAX)
        : undefined,
      shadowColor: isShadowColor(entry.shadowColor) ? entry.shadowColor : undefined,
      ambientOcclusion: typeof entry.ambientOcclusion === 'number'
        ? clamp(finite(entry.ambientOcclusion, 0.28), 0, 1)
        : undefined,
      shadowQuality: (['auto', 'high', 'ultra'] as const).includes(entry.shadowQuality as never)
        ? entry.shadowQuality
        : undefined,
      ...(typeof entry.environmentIntensity === 'number'
        ? { environmentIntensity: clamp(finite(entry.environmentIntensity, 1), 0, 4) }
        : {}),
      ...(typeof entry.toneMappingExposure === 'number'
        ? { toneMappingExposure: clamp(finite(entry.toneMappingExposure, 1.45), 0.2, 4) }
        : {}),
      showGroundBase: entry.showGroundBase !== false,
      linkSplitTransform: entry.linkSplitTransform !== false,
      cameraView: CAMERA_VIEWS.has(entry.cameraView as CameraView) ? entry.cameraView : undefined,
      cameraLens: CAMERA_LENS_IDS.has(entry.cameraLens as CameraLens) ? entry.cameraLens : undefined,
      lightPosition: entry.lightPosition ? vec3(entry.lightPosition) : undefined,
      lightColor: typeof entry.lightColor === 'string' ? entry.lightColor.slice(0, 16) : undefined,
      cameraOrbit: cleanCameraOrbit(entry.cameraOrbit),
      sceneLights: cleanSceneLights(entry.sceneLights),
      ...(typeof entry.reflectionMap === 'string' && REFLECTION_MAP_IDS.has(entry.reflectionMap)
        ? { reflectionMap: entry.reflectionMap as CompositionTemplate['reflectionMap'] }
        : {}),
      deviceExtras: Array.isArray(entry.deviceExtras)
        ? entry.deviceExtras.slice(0, devices.length).map((extra) => {
          const materialTweaks = cleanMaterialTweaks(extra?.materialTweaks);
          const hiddenMeshes = cleanHiddenMeshes(extra?.hiddenMeshes);
          return {
            glassReflection: extra && typeof extra.glassReflection === 'number'
              ? clamp(extra.glassReflection, 0, 1)
              : undefined,
            reflectionStyle: normalizeReflectionStyle(extra?.reflectionStyle) ?? undefined,
            lidOpen: extra && typeof extra.lidOpen === 'number' ? clamp(extra.lidOpen, 0, 1) : undefined,
            deviceColor: extra && DEVICE_COLOR_IDS.has(extra.deviceColor as DeviceColor)
              ? extra.deviceColor
              : undefined,
            clayMode: extra?.clayMode === true,
            ...(materialTweaks ? { materialTweaks } : {}),
            ...(hiddenMeshes ? { hiddenMeshes } : {}),
          };
        })
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
      depthOfField: entry.depthOfField === true,
      depthOfFieldAmount: clamp(finite(entry.depthOfFieldAmount, 0.48), 0.05, 1),
    };
    return [template];
  }).slice(0, MAX_ITEMS);
}

export function loadSavedCompositions(): CompositionTemplate[] {
  return normalizeCompositions(readList(COMP_KEY));
}

export function replaceSavedCompositions(templates: CompositionTemplate[]): CompositionTemplate[] {
  const next = normalizeCompositions(templates).slice(0, MAX_ITEMS);
  writeList(COMP_KEY, next);
  return next;
}

export function mergeSavedCompositions(
  local: CompositionTemplate[],
  remote: CompositionTemplate[],
): CompositionTemplate[] {
  const byId = new Map<string, CompositionTemplate>();
  for (const item of remote) byId.set(item.id, item);
  for (const item of local) byId.set(item.id, item);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of [...local, ...remote]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    order.push(item.id);
  }
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  }).slice(0, MAX_ITEMS);
}

export interface TemplatesLibraryPayload {
  kind: 'mockup-studio-templates';
  version: 1;
  updatedAt: number;
  templates: CompositionTemplate[];
}

export function serializeTemplatesLibrary(templates: CompositionTemplate[]): string {
  const payload: TemplatesLibraryPayload = {
    kind: 'mockup-studio-templates',
    version: 1,
    updatedAt: Date.now(),
    templates: normalizeCompositions(templates),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseTemplatesLibrary(raw: string): CompositionTemplate[] {
  try {
    const parsed = JSON.parse(raw) as Partial<TemplatesLibraryPayload> | unknown[];
    if (Array.isArray(parsed)) return normalizeCompositions(parsed);
    if (!parsed || typeof parsed !== 'object') return [];
    if (parsed.kind !== 'mockup-studio-templates') return [];
    return normalizeCompositions(Array.isArray(parsed.templates) ? parsed.templates : []);
  } catch {
    return [];
  }
}

export function canonicalTemplatesJson(templates: CompositionTemplate[]): string {
  return JSON.stringify(normalizeCompositions(templates));
}

function slugifyCompositionId(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'composition';
}

function roundExportValue(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round(value * 10000) / 10000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(roundExportValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      out[key] = roundExportValue(nested);
    }
    return out;
  }
  return value;
}

/** Snapshot the open project as a composition template (does not persist). */
export function compositionFromProject(
  label: string,
  project: MockupProject,
  options?: {
    id?: string;
    category?: CompositionTemplate['category'];
    description?: string;
    badge?: string;
    preview?: CompositionTemplate['preview'];
    cameraOrbit?: CompositionTemplate['cameraOrbit'] | null;
  },
): CompositionTemplate {
  const devices = project.devices.slice(0, 6);
  const mode = project.compositionMode === 'split' ? 'split' as const : 'single' as const;
  const indexById = new Map(devices.map((device, index) => [device.id, index]));
  const resolvedLabel = label.trim().slice(0, 40)
    || project.name.trim().slice(0, 40)
    || `Composition ${devices.length}`;
  const cameraOrbit = options?.cameraOrbit
    ? cleanCameraOrbit(options.cameraOrbit)
    : undefined;
  return {
    id: options?.id ?? newId('comp'),
    label: resolvedLabel,
    description: options?.description
      ?? `${devices.length} device${devices.length === 1 ? '' : 's'} · ${mode === 'split' ? 'Split' : 'Single'}`,
    badge: options?.badge ?? 'Template',
    category: options?.category ?? 'saved',
    preview: options?.preview ?? previewForCount(devices.length, mode),
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
      reflectionStyle: device.reflectionStyle,
      lidOpen: device.lidOpen,
      deviceColor: device.deviceColor,
      clayMode: device.clayMode,
      ...(device.materialTweaks
        ? {
          materialTweaks: Object.fromEntries(
            Object.entries(device.materialTweaks).map(([name, tweak]) => [name, { ...tweak }]),
          ),
        }
        : {}),
      ...(device.hiddenMeshes?.length ? { hiddenMeshes: [...device.hiddenMeshes] } : {}),
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
    shadowType: project.shadowType,
    shadowContact: project.shadowContact,
    shadowContactEnabled: project.shadowContactEnabled !== false,
    shadowDistance: project.shadowDistance,
    shadowColor: isShadowColor(project.shadowColor) ? project.shadowColor : DEFAULT_SHADOW_COLOR,
    ambientOcclusion: project.ambientOcclusion,
    shadowQuality: project.shadowQuality,
    showGroundBase: project.showGroundBase !== false,
    lightPosition: { ...project.lightPosition },
    lightColor: project.lightColor,
    // Always persist so apply/reload restores (or clears) authored lighting.
    sceneLights: (project.sceneLights ?? []).slice(0, MAX_SCENE_LIGHTS).map((light) => ({
      ...light,
      position: { ...light.position },
      target: { ...light.target },
    })),
    ...(project.environmentIntensity != null
      ? { environmentIntensity: project.environmentIntensity }
      : {}),
    ...(project.toneMappingExposure != null
      ? { toneMappingExposure: project.toneMappingExposure }
      : {}),
    ...(project.reflectionMap && project.reflectionMap !== 'custom'
      ? { reflectionMap: project.reflectionMap }
      : {}),
    cameraView: project.cameraView,
    cameraLens: project.cameraLens,
    ...(cameraOrbit ? { cameraOrbit } : {}),
    edgeBlurTop: project.edgeBlurTop,
    edgeBlurBottom: project.edgeBlurBottom,
    edgeBlurAmount: project.edgeBlurAmount,
    depthOfField: project.depthOfField,
    depthOfFieldAmount: project.depthOfFieldAmount,
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
}

/**
 * TypeScript object ready to paste into COMPOSITION_TEMPLATES in templates.ts
 * so the shot ships with the app for every user.
 */
export function formatBuiltinCompositionSource(
  label: string,
  project: MockupProject,
  options?: {
    category?: 'devices' | 'scenes';
    id?: string;
    cameraOrbit?: CompositionTemplate['cameraOrbit'] | null;
  },
): string {
  const category = options?.category ?? 'devices';
  const template = compositionFromProject(label, project, {
    id: options?.id ?? slugifyCompositionId(label.trim() || project.name || 'composition'),
    category,
    badge: category === 'scenes' ? 'Scene' : 'Layout',
    cameraOrbit: options?.cameraOrbit,
  });
  const body = JSON.stringify(roundExportValue(template), null, 2)
    .replace(/^(\s*)"([^"]+)":/gm, '$1$2:')
    .replace(/"/g, "'");
  return `  ${body.replace(/\n/g, '\n  ')},\n`;
}

export function saveComposition(
  label: string,
  project: MockupProject,
  options?: { cameraOrbit?: CompositionTemplate['cameraOrbit'] | null },
): CompositionTemplate {
  const compositions = loadSavedCompositions();
  const saved = compositionFromProject(label, project, {
    id: newId('comp'),
    category: 'saved',
    badge: 'Template',
    cameraOrbit: options?.cameraOrbit,
  });
  if (!label.trim() && !project.name.trim()) {
    saved.label = `Composition ${compositions.length + 1}`;
  }
  writeList(COMP_KEY, [saved, ...compositions]);
  return saved;
}

export function deleteSavedComposition(id: string): CompositionTemplate[] {
  const next = loadSavedCompositions().filter((item) => item.id !== id);
  writeList(COMP_KEY, next);
  return next;
}

/** Clone a saved template into Yours with a new id. */
export function duplicateSavedComposition(id: string): CompositionTemplate | null {
  const compositions = loadSavedCompositions();
  const source = compositions.find((item) => item.id === id);
  if (!source) return null;
  const copy: CompositionTemplate = {
    ...source,
    id: newId('comp'),
    label: `${source.label} copy`.slice(0, 40),
    category: 'saved',
    badge: source.badge || 'Template',
  };
  writeList(COMP_KEY, [copy, ...compositions]);
  return copy;
}

/** Copy any Devices/Scenes layout into the personal Yours library. */
export function copyTemplateToSaved(template: CompositionTemplate): CompositionTemplate {
  const compositions = loadSavedCompositions();
  const copy: CompositionTemplate = {
    ...template,
    id: newId('comp'),
    label: `${template.label} copy`.slice(0, 40),
    category: 'saved',
    badge: 'Template',
  };
  writeList(COMP_KEY, [copy, ...compositions]);
  return copy;
}

export function renameSavedComposition(id: string, label: string): CompositionTemplate[] {
  const nextLabel = label.trim().slice(0, 40);
  if (!nextLabel) return loadSavedCompositions();
  const next = loadSavedCompositions().map((item) => (
    item.id === id ? { ...item, label: nextLabel } : item
  ));
  writeList(COMP_KEY, next);
  return next;
}
