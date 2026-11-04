import { isKnownDeviceId } from './devices';
import { REFLECTION_MAPS } from './reflectionMaps';
import {
  ANIM_PROPERTIES, BACKGROUNDS, BUILTIN_GRADIENTS, DEFAULT_GRADIENT, DEFAULT_PROJECT, DEVICE_COLORS,
  SCENE_PROP_KINDS, createDefaultAnimation, createDeviceInstance, createSceneProp,
  getSelectedDevice, normalizeGradientColors, syncProjectFromSelected,
  type AnimKeyframe, type AnimProperty, type AnimTrack, type AnimationClip,
  type DeviceInstance, type MockupProject, type ReflectionMapSetting,
  type SceneProp, type ScenePropKind, type Vec3,
} from '../types';
import { loadCustomScenePresets } from './scenePresets';

const REFLECTION_IDS = new Set<string>([...REFLECTION_MAPS.map((m) => m.id), 'custom']);

function number(n: unknown, fallback: number, min: number, max: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function vec3(input: Partial<Vec3> | undefined, fallback: Vec3): Vec3 {
  return {
    x: number(input?.x, fallback.x, -500, 500),
    y: number(input?.y, fallback.y, -500, 500),
    z: number(input?.z, fallback.z, -500, 500),
  };
}

function normalizeScale(input: unknown, fallback: number | Vec3 = 1): number | Vec3 {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(8, Math.max(0.05, input));
  }
  if (input && typeof input === 'object') {
    const s = input as Partial<Vec3>;
    return {
      x: number(s.x, typeof fallback === 'number' ? fallback : fallback.x, 0.05, 8),
      y: number(s.y, typeof fallback === 'number' ? fallback : fallback.y, 0.05, 8),
      z: number(s.z, typeof fallback === 'number' ? fallback : fallback.z, 0.05, 8),
    };
  }
  return fallback;
}

function normalizeSceneProps(input: Partial<MockupProject>): SceneProp[] {
  if (!Array.isArray(input.sceneProps)) return [];
  const allowed = new Set<string>(SCENE_PROP_KINDS);
  return input.sceneProps.slice(0, 24).flatMap((raw, index) => {
    const item = (raw ?? {}) as Partial<SceneProp>;
    if (!allowed.has(String(item.kind))) return [];
    const color = typeof item.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(item.color.trim())
      ? item.color.trim().toLowerCase()
      : undefined;
    return [createSceneProp({
      id: typeof item.id === 'string' ? item.id : `prop-${index}`,
      kind: item.kind as ScenePropKind,
      position: vec3(item.position, { x: 0, y: 0, z: 0 }),
      rotation: vec3(item.rotation, { x: 0, y: 0, z: 0 }),
      scale: normalizeScale(item.scale, 1),
      color,
    })];
  });
}

function normalizeDevices(input: Partial<MockupProject>): DeviceInstance[] {
  if (Array.isArray(input.devices) && input.devices.length > 0) {
    return input.devices.slice(0, 6).map((raw, index) => {
      const item = (raw ?? {}) as Partial<DeviceInstance>;
      return createDeviceInstance({
        id: typeof item.id === 'string' ? item.id : `device-${index}`,
        deviceId: isKnownDeviceId(item.deviceId) ? item.deviceId! : DEFAULT_PROJECT.deviceId,
        rotation: vec3(item.rotation, DEFAULT_PROJECT.rotation),
        scale: number(item.scale, 1, 0.6, 1.3),
        position: vec3(item.position, { x: 0, y: 0, z: 0 }),
        glassReflection: number(item.glassReflection, 0.55, 0, 1),
      });
    });
  }

  return [
    createDeviceInstance({
      id: 'device-main',
      deviceId: isKnownDeviceId(input.deviceId) ? input.deviceId! : DEFAULT_PROJECT.deviceId,
      rotation: vec3(input.rotation, DEFAULT_PROJECT.rotation),
      scale: number(input.scale, 1, 0.6, 1.3),
      position: { x: 0, y: 0, z: 0 },
    }),
  ];
}

export function validateProject(value: unknown): MockupProject {
  if (!value || typeof value !== 'object') throw new Error('This is not a valid Mockup Studio project.');
  const input = value as Partial<MockupProject>;
  if (input.version !== 1) throw new Error('Unsupported project version.');
  if (typeof input.name !== 'string') throw new Error('Project name is invalid.');
  if (input.screenshot != null && (typeof input.screenshot !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(input.screenshot))) {
    throw new Error('The screenshot in this project is invalid.');
  }
  const savedPresets = loadCustomScenePresets();
  const backgroundId = typeof input.background === 'string' ? input.background : DEFAULT_PROJECT.background;
  const isKnownBackground = BACKGROUNDS.some((p) => p.id === backgroundId)
    || backgroundId === 'custom'
    || savedPresets.some((p) => p.id === backgroundId);
  const bg = isKnownBackground ? backgroundId : DEFAULT_PROJECT.background;

  const builtinGradient = bg in BUILTIN_GRADIENTS
    ? BUILTIN_GRADIENTS[bg as keyof typeof BUILTIN_GRADIENTS]
    : undefined;
  const savedGradient = savedPresets.find((p) => p.id === bg)?.gradient;
  const gradientFallback = builtinGradient ?? savedGradient ?? DEFAULT_GRADIENT;
  const gradientColors = bg === 'transparent'
    ? { ...DEFAULT_GRADIENT }
    : normalizeGradientColors(input.gradientColors, gradientFallback);

  const color = DEVICE_COLORS.some((p) => p.id === input.deviceColor) ? input.deviceColor! : DEFAULT_PROJECT.deviceColor;
  const devices = normalizeDevices(input);
  const selectedDeviceId = devices.some((d) => d.id === input.selectedDeviceId)
    ? String(input.selectedDeviceId)
    : devices[0].id;
  const selected = devices.find((d) => d.id === selectedDeviceId) ?? devices[0];

  const compositionMode = input.compositionMode === 'split' ? 'split' : 'single';
  const animation = normalizeAnimation(input.animation, devices);
  const sceneProps = normalizeSceneProps(input);

  const reflectionMapRaw = typeof input.reflectionMap === 'string' ? input.reflectionMap : DEFAULT_PROJECT.reflectionMap;
  const reflectionMap = REFLECTION_IDS.has(reflectionMapRaw)
    ? reflectionMapRaw as ReflectionMapSetting
    : DEFAULT_PROJECT.reflectionMap;
  const reflectionMapImage = reflectionMap === 'custom'
    && typeof input.reflectionMapImage === 'string'
    && /^data:image\/(png|jpeg|webp);base64,/.test(input.reflectionMapImage)
    ? input.reflectionMapImage
    : null;

  return syncProjectFromSelected({
    version: 1,
    name: input.name.slice(0, 100) || DEFAULT_PROJECT.name,
    screenshot: input.screenshot || null,
    background: bg,
    gradientColors,
    reflectionMap: reflectionMapImage ? 'custom' : (reflectionMap === 'custom' ? 'match_background' : reflectionMap),
    reflectionMapImage,
    deviceId: selected.deviceId,
    deviceColor: color,
    rotation: { ...selected.rotation },
    scale: selected.scale,
    lightIntensity: number(input.lightIntensity, 2.5, 0.5, 5),
    fillIntensity: number(input.fillIntensity, DEFAULT_PROJECT.fillIntensity, 0, 2.5),
    shadowSoftness: number(input.shadowSoftness, DEFAULT_PROJECT.shadowSoftness, 0.2, 8),
    shadowOpacity: number(input.shadowOpacity, DEFAULT_PROJECT.shadowOpacity, 0, 0.85),
    edgeBlurEnabled: input.edgeBlurEnabled === true,
    edgeBlurAmount: number(input.edgeBlurAmount, DEFAULT_PROJECT.edgeBlurAmount, 4, 64),
    cameraView: ['front', 'left', 'right', 'top'].includes(String(input.cameraView)) ? input.cameraView! : 'front',
    compositionMode,
    devices,
    selectedDeviceId,
    sceneProps,
    animation,
  }, selected);
}

function normalizeAnimation(raw: unknown, devices: DeviceInstance[]): AnimationClip {
  const fallback = createDefaultAnimation(devices[0]?.id ?? 'device-main');
  if (!raw || typeof raw !== 'object') return fallback;
  const input = raw as Partial<AnimationClip>;
  const allowed = new Set(ANIM_PROPERTIES.map((p) => p.id));
  const deviceIds = new Set(devices.map((d) => d.id));

  const tracks: AnimTrack[] = Array.isArray(input.tracks)
    ? input.tracks.flatMap((item, index) => {
      const track = (item ?? {}) as Partial<AnimTrack>;
      const property = allowed.has(track.property as AnimProperty) ? track.property as AnimProperty : null;
      const targetId = typeof track.targetId === 'string' && deviceIds.has(track.targetId)
        ? track.targetId
        : devices[0]?.id;
      if (!property || !targetId) return [];
      const keyframes: AnimKeyframe[] = Array.isArray(track.keyframes)
        ? track.keyframes.slice(0, 64).map((kf, ki) => {
          const key = (kf ?? {}) as Partial<AnimKeyframe>;
          const easeRaw = key.ease;
          const ease = easeRaw === 'linear' || easeRaw === 'easeIn' || easeRaw === 'easeOut'
            || easeRaw === 'easeInOut' || easeRaw === 'custom'
            ? easeRaw
            : undefined;
          const bezierRaw = Array.isArray(key.easeBezier) ? key.easeBezier : null;
          const easeBezier = ease === 'custom' && bezierRaw && bezierRaw.length >= 4
            ? [
              number(bezierRaw[0], 0.42, 0, 1),
              number(bezierRaw[1], 0, -1, 2),
              number(bezierRaw[2], 0.58, 0, 1),
              number(bezierRaw[3], 1, -1, 2),
            ] as const
            : undefined;
          return {
            id: typeof key.id === 'string' ? key.id : `kf-${index}-${ki}`,
            time: number(key.time, 0, 0, 60),
            value: number(key.value, 0, -500, 500),
            ...(ease ? { ease } : {}),
            ...(easeBezier ? { easeBezier: [...easeBezier] as [number, number, number, number] } : {}),
          };
        }).sort((a, b) => a.time - b.time)
        : [];
      return [{
        id: typeof track.id === 'string' ? track.id : `track-${index}`,
        targetId,
        property,
        keyframes,
      }];
    })
    : fallback.tracks;

  return {
    duration: number(input.duration, fallback.duration, 1, 30),
    fps: number(input.fps, 30, 12, 60),
    loop: input.loop !== false,
    tracks,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string) {
  return name.replace(/[^\w .-]/g, '').trim().replace(/\s+/g, '-') || 'mockup-studio';
}

export { getSelectedDevice };
