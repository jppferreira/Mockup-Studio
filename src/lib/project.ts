import { getDevice, isKnownDeviceId } from './devices';
import { ensureCompositionLayers } from './layers';
import { createOverlay, type SceneOverlay } from './overlays';
import { isValidScreenMediaDataUrl } from './screenMedia';
import { REFLECTION_MAPS } from './reflectionMaps';
import {
  ANIM_PROPERTIES, BACKGROUNDS, BUILTIN_GRADIENTS, CAMERA_TARGET_ID, DEFAULT_GRADIENT, DEFAULT_PROJECT,
  DEVICE_COLORS, MAX_COMPOSITION_SCENES, MAX_SCENE_LIGHTS, SCENE_LIGHT_KINDS, SCENE_PROP_KINDS,
  createCompositionScene, createDefaultAnimation, createDeviceInstance, createSceneLight, createSceneProp,
  ensureCompositionScenes, getSelectedDevice,
  applySceneStage, captureSceneStage, resolveSceneGradient, syncProjectFromActiveScene, syncProjectFromSelected,
  type AnimKeyframe, type AnimProperty, type AnimTrack, type AnimationClip,
  type CompositionScene, type DeviceColor, type DeviceInstance, type MockupProject,
  type PublishTarget, type ReflectionMapSetting, type SceneLight, type SceneLightKind, type SceneProp,
  type ScenePropKind, type SceneStage, type Vec3,
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

const SCENE_LIGHT_KIND_SET = new Set<string>(SCENE_LIGHT_KINDS);

function normalizeSceneLights(raw: unknown): SceneLight[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<SceneLight>;
    if (!SCENE_LIGHT_KIND_SET.has(String(entry.kind))) return [];
    return [createSceneLight({
      ...entry,
      kind: entry.kind as SceneLightKind,
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : undefined,
    })];
  }).slice(0, MAX_SCENE_LIGHTS);
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

function normalizeDeviceColor(input: unknown, fallback?: DeviceColor): DeviceColor | undefined {
  if (typeof input === 'string' && DEVICE_COLORS.some((c) => c.id === input)) {
    return input as DeviceColor;
  }
  return fallback;
}

function normalizeDevices(input: Partial<MockupProject>): DeviceInstance[] {
  const projectShot = typeof input.screenshot === 'string' ? input.screenshot : null;
  const projectColor = normalizeDeviceColor(input.deviceColor, DEFAULT_PROJECT.deviceColor)!;
  const projectClay = input.clayMode === true || projectColor === 'clay';

  if (Array.isArray(input.devices) && input.devices.length > 0) {
    return input.devices.slice(0, 6).map((raw, index) => {
      const item = (raw ?? {}) as Partial<DeviceInstance>;
      const hasOwnShot = Object.prototype.hasOwnProperty.call(item, 'screenshot');
      // Legacy projects shared one project.screenshot across all devices — preserve that on migrate.
      const shot = hasOwnShot
        ? (typeof item.screenshot === 'string' && isValidScreenMediaDataUrl(item.screenshot)
          ? item.screenshot
          : item.screenshot === null ? null : projectShot)
        : projectShot;
      return createDeviceInstance({
        id: typeof item.id === 'string' ? item.id : `device-${index}`,
        deviceId: isKnownDeviceId(item.deviceId) ? item.deviceId! : DEFAULT_PROJECT.deviceId,
        rotation: vec3(item.rotation, DEFAULT_PROJECT.rotation),
        scale: number(item.scale, 1, 0.6, 1.3),
        position: vec3(item.position, { x: 0, y: 0, z: 0 }),
        glassReflection: number(item.glassReflection, 0.55, 0, 1),
        reflectionStyle: item.reflectionStyle,
        screenshot: shot,
        deviceColor: normalizeDeviceColor(item.deviceColor, projectColor),
        clayMode: typeof item.clayMode === 'boolean' ? item.clayMode : projectClay,
        lidOpen: number(item.lidOpen, 1, 0, 1),
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
      screenshot: projectShot,
      deviceColor: projectColor,
      clayMode: projectClay,
    }),
  ];
}

export function validateProject(value: unknown): MockupProject {
  if (!value || typeof value !== 'object') throw new Error('This is not a valid Mockup Studio project.');
  const input = value as Partial<MockupProject>;
  if (input.version !== 1) throw new Error('Unsupported project version.');
  if (typeof input.name !== 'string') throw new Error('Project name is invalid.');
  if (input.screenshot != null && !isValidScreenMediaDataUrl(input.screenshot)) {
    throw new Error('The screen media in this project is invalid.');
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
    : resolveSceneGradient(bg, input.gradientColors, gradientFallback);

  const color = DEVICE_COLORS.some((p) => p.id === input.deviceColor) ? input.deviceColor! : DEFAULT_PROJECT.deviceColor;
  const clayMode = input.clayMode === true || color === 'clay';
  const overlays = normalizeOverlays(input);
  const devices = normalizeDevices(input);
  const selectedDeviceId = devices.some((d) => d.id === input.selectedDeviceId)
    ? String(input.selectedDeviceId)
    : devices[0].id;
  const selected = devices.find((d) => d.id === selectedDeviceId) ?? devices[0];

  const compositionMode = input.compositionMode === 'split' ? 'split' : 'single';
  const selectedPlatform = getDevice(selected.deviceId).platform;
  const publishTarget: PublishTarget = input.publishTarget === 'ios' || input.publishTarget === 'android'
    ? input.publishTarget
    : selectedPlatform;
  const linkSplitTransform = input.linkSplitTransform !== false;
  const animation = normalizeAnimation(input.animation, devices);
  const sceneProps = normalizeSceneProps(input);
  const activeSceneId = Array.isArray(input.scenes) && input.scenes.some((scene) => scene?.id === input.activeSceneId)
    ? String(input.activeSceneId)
    : '';
  const publishDevice = devices.find((d) => getDevice(d.deviceId).platform === publishTarget) ?? selected;
  const publishShot = publishDevice.screenshot !== undefined ? publishDevice.screenshot : (input.screenshot || null);
  const publishColor = publishDevice.deviceColor ?? color;
  const publishClay = publishDevice.clayMode ?? clayMode;

  const soundtrackData = typeof input.soundtrackData === 'string'
    && /^data:audio\/(mpeg|mp3|wav|wave|ogg|mp4|x-m4a|aac);base64,/i.test(input.soundtrackData)
    ? input.soundtrackData
    : null;
  const soundtrackName = soundtrackData
    && typeof input.soundtrackName === 'string'
    && input.soundtrackName.trim()
    ? input.soundtrackName.trim().slice(0, 80)
    : (soundtrackData ? 'Soundtrack' : null);
  const timelineDur = Math.max(0.15, animation.duration);
  const soundtrackStart = soundtrackData
    ? number(input.soundtrackStart, DEFAULT_PROJECT.soundtrackStart, 0, timelineDur)
    : DEFAULT_PROJECT.soundtrackStart;
  const soundtrackOffset = soundtrackData
    ? number(input.soundtrackOffset, DEFAULT_PROJECT.soundtrackOffset, 0, 3600)
    : DEFAULT_PROJECT.soundtrackOffset;
  const soundtrackDuration = soundtrackData
    ? number(
      input.soundtrackDuration,
      Math.min(timelineDur, DEFAULT_PROJECT.soundtrackDuration),
      0.15,
      timelineDur,
    )
    : DEFAULT_PROJECT.soundtrackDuration;
  const soundtrackFadeIn = soundtrackData
    ? number(input.soundtrackFadeIn, DEFAULT_PROJECT.soundtrackFadeIn, 0, 8)
    : DEFAULT_PROJECT.soundtrackFadeIn;
  const soundtrackFadeOut = soundtrackData
    ? number(input.soundtrackFadeOut, DEFAULT_PROJECT.soundtrackFadeOut, 0, 8)
    : DEFAULT_PROJECT.soundtrackFadeOut;

  const reflectionMapRaw = typeof input.reflectionMap === 'string' ? input.reflectionMap : DEFAULT_PROJECT.reflectionMap;
  const reflectionMap = REFLECTION_IDS.has(reflectionMapRaw)
    ? reflectionMapRaw as ReflectionMapSetting
    : DEFAULT_PROJECT.reflectionMap;
  const reflectionMapImage = reflectionMap === 'custom'
    && typeof input.reflectionMapImage === 'string'
    && /^data:image\/(png|jpeg|webp);base64,/.test(input.reflectionMapImage)
    ? input.reflectionMapImage
    : null;

  const draft = syncProjectFromSelected({
    version: 1,
    name: input.name.slice(0, 100) || DEFAULT_PROJECT.name,
    screenshot: publishShot,
    scenes: [],
    activeSceneId: 'pending',
    background: bg,
    gradientColors: { ...gradientColors },
    reflectionMap: reflectionMapImage ? 'custom' : (reflectionMap === 'custom' ? 'match_background' : reflectionMap),
    reflectionMapImage,
    deviceId: selected.deviceId,
    deviceColor: publishColor,
    clayMode: publishClay,
    publishTarget,
    linkSplitTransform,
    overlays,
    rotation: { ...selected.rotation },
    scale: selected.scale,
    lightIntensity: number(input.lightIntensity, DEFAULT_PROJECT.lightIntensity, 0, 5),
    lightPosition: vec3(input.lightPosition, DEFAULT_PROJECT.lightPosition),
    lightColor: typeof input.lightColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.lightColor)
      ? input.lightColor
      : DEFAULT_PROJECT.lightColor,
    fillIntensity: number(input.fillIntensity, DEFAULT_PROJECT.fillIntensity, 0, 2.5),
    sceneLights: normalizeSceneLights(input.sceneLights),
    environmentIntensity: input.environmentIntensity == null
      ? null
      : number(input.environmentIntensity, 1, 0, 4),
    toneMappingExposure: input.toneMappingExposure == null
      ? null
      : number(input.toneMappingExposure, 1.45, 0.2, 4),
    shadowSoftness: number(
      input.shadowSoftness,
      input.shadowType === 'sharp' ? Math.min(2.2, DEFAULT_PROJECT.shadowSoftness) : DEFAULT_PROJECT.shadowSoftness,
      0.2,
      8,
    ),
    shadowOpacity: number(input.shadowOpacity, DEFAULT_PROJECT.shadowOpacity, 0, 2),
    shadowType: (['contact', 'soft', 'sharp', 'off'] as const).includes(input.shadowType as never)
      ? (input.shadowType as MockupProject['shadowType'])
      : DEFAULT_PROJECT.shadowType,
    shadowContact: number(
      input.shadowContact,
      input.shadowType === 'contact' ? 0.72 : input.shadowType === 'sharp' ? 0.58 : DEFAULT_PROJECT.shadowContact,
      0,
      1,
    ),
    shadowQuality: (['auto', 'high', 'ultra'] as const).includes(input.shadowQuality as never)
      ? (input.shadowQuality as MockupProject['shadowQuality'])
      : DEFAULT_PROJECT.shadowQuality,
    showGroundBase: input.showGroundBase !== false,
    edgeBlurTop: typeof input.edgeBlurTop === 'boolean'
      ? input.edgeBlurTop
      : input.edgeBlurEnabled === true,
    edgeBlurBottom: typeof input.edgeBlurBottom === 'boolean'
      ? input.edgeBlurBottom
      : input.edgeBlurEnabled === true,
    edgeBlurAmount: number(input.edgeBlurAmount, DEFAULT_PROJECT.edgeBlurAmount, 4, 64),
    depthOfField: typeof input.depthOfField === 'boolean'
      ? input.depthOfField
      : DEFAULT_PROJECT.depthOfField,
    depthOfFieldAmount: number(input.depthOfFieldAmount, DEFAULT_PROJECT.depthOfFieldAmount, 0.05, 1),
    cameraView: ['front', 'left', 'right', 'top'].includes(String(input.cameraView)) ? input.cameraView! : 'front',
    cameraLens: (['ultrawide', 'wide', 'standard', 'telephoto'] as const).includes(input.cameraLens as never)
      ? (input.cameraLens as MockupProject['cameraLens'])
      : DEFAULT_PROJECT.cameraLens,
    compositionMode,
    devices,
    selectedDeviceId,
    sceneProps,
    layers: ensureCompositionLayers({
      devices,
      sceneProps,
      overlays,
      layers: Array.isArray(input.layers) ? input.layers : undefined,
    }),
    animation,
    soundtrackName,
    soundtrackData,
    soundtrackStart,
    soundtrackOffset,
    soundtrackDuration,
    soundtrackFadeIn,
    soundtrackFadeOut,
  }, selected);

  const scenes = normalizeCompositionScenes(input, bg, gradientColors, draft);
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0];
  return applySceneStage({
    ...draft,
    scenes,
    activeSceneId: activeScene.id,
    background: activeScene.background,
    gradientColors: { ...activeScene.gradientColors },
  }, activeScene);
}

function normalizeStoredStage(raw: unknown, fallback: MockupProject): SceneStage {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<SceneStage>;
  const hasDevices = Array.isArray(source.devices) && source.devices.length > 0;
  if (!hasDevices) return captureSceneStage(fallback);
  const devices = normalizeDevices({
    devices: source.devices,
    deviceId: source.devices?.[0]?.deviceId ?? fallback.deviceId,
    deviceColor: source.devices?.[0]?.deviceColor ?? fallback.deviceColor,
    clayMode: source.devices?.[0]?.clayMode ?? fallback.clayMode,
    rotation: fallback.rotation,
    scale: fallback.scale,
    screenshot: null,
  });
  const selectedDeviceId = devices.some((device) => device.id === source.selectedDeviceId)
    ? String(source.selectedDeviceId)
    : devices[0].id;
  const sceneProps = normalizeSceneProps({ sceneProps: source.sceneProps });
  const overlays = normalizeOverlays({ overlays: source.overlays });
  const animation = normalizeAnimation(source.animation, devices);
  const cameraView = ['front', 'left', 'right', 'top'].includes(String(source.cameraView))
    ? source.cameraView!
    : fallback.cameraView;
  const cameraLens = (['ultrawide', 'wide', 'standard', 'telephoto'] as const).includes(source.cameraLens as never)
    ? source.cameraLens!
    : fallback.cameraLens;
  const reflectionRaw = typeof source.reflectionMap === 'string' ? source.reflectionMap : fallback.reflectionMap;
  const reflectionMap = REFLECTION_IDS.has(reflectionRaw)
    ? reflectionRaw as ReflectionMapSetting
    : fallback.reflectionMap;
  const reflectionMapImage = reflectionMap === 'custom'
    && typeof source.reflectionMapImage === 'string'
    && /^data:image\/(png|jpeg|webp);base64,/.test(source.reflectionMapImage)
    ? source.reflectionMapImage
    : null;
  return {
    devices,
    selectedDeviceId,
    sceneProps,
    overlays,
    layers: ensureCompositionLayers({
      devices,
      sceneProps,
      overlays,
      layers: Array.isArray(source.layers) ? source.layers : undefined,
    }),
    animation,
    cameraView,
    cameraLens,
    compositionMode: source.compositionMode === 'split' ? 'split' : 'single',
    linkSplitTransform: source.linkSplitTransform !== false,
    publishTarget: source.publishTarget === 'ios' || source.publishTarget === 'android'
      ? source.publishTarget
      : fallback.publishTarget,
    reflectionMap: reflectionMapImage ? 'custom' : (reflectionMap === 'custom' ? 'match_background' : reflectionMap),
    reflectionMapImage,
    lightIntensity: number(source.lightIntensity, fallback.lightIntensity, 0, 5),
    lightPosition: vec3(source.lightPosition, fallback.lightPosition),
    lightColor: typeof source.lightColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.lightColor)
      ? source.lightColor
      : fallback.lightColor,
    fillIntensity: number(source.fillIntensity, fallback.fillIntensity, 0, 2.5),
    sceneLights: normalizeSceneLights(source.sceneLights ?? fallback.sceneLights),
    environmentIntensity: source.environmentIntensity == null
      ? (fallback.environmentIntensity ?? null)
      : number(source.environmentIntensity, 1, 0, 4),
    toneMappingExposure: source.toneMappingExposure == null
      ? (fallback.toneMappingExposure ?? null)
      : number(source.toneMappingExposure, 1.45, 0.2, 4),
    shadowSoftness: number(source.shadowSoftness, fallback.shadowSoftness, 0.2, 8),
    shadowOpacity: number(source.shadowOpacity, fallback.shadowOpacity, 0, 2),
    shadowType: (['contact', 'soft', 'sharp', 'off'] as const).includes(source.shadowType as never)
      ? (source.shadowType as MockupProject['shadowType'])
      : (fallback.shadowType ?? DEFAULT_PROJECT.shadowType),
    shadowContact: number(
      source.shadowContact,
      fallback.shadowContact ?? DEFAULT_PROJECT.shadowContact,
      0,
      1,
    ),
    shadowQuality: (['auto', 'high', 'ultra'] as const).includes(source.shadowQuality as never)
      ? (source.shadowQuality as MockupProject['shadowQuality'])
      : (fallback.shadowQuality ?? DEFAULT_PROJECT.shadowQuality),
    showGroundBase: source.showGroundBase !== false,
    edgeBlurTop: typeof source.edgeBlurTop === 'boolean' ? source.edgeBlurTop : fallback.edgeBlurTop,
    edgeBlurBottom: typeof source.edgeBlurBottom === 'boolean' ? source.edgeBlurBottom : fallback.edgeBlurBottom,
    edgeBlurAmount: number(source.edgeBlurAmount, fallback.edgeBlurAmount, 4, 64),
    depthOfField: typeof source.depthOfField === 'boolean'
      ? source.depthOfField
      : fallback.depthOfField,
    depthOfFieldAmount: number(source.depthOfFieldAmount, fallback.depthOfFieldAmount, 0.05, 1),
  };
}

function normalizeCompositionScenes(
  input: Partial<MockupProject>,
  fallbackBackground: MockupProject['background'],
  fallbackGradient: MockupProject['gradientColors'],
  fallbackProject: MockupProject,
): CompositionScene[] {
  const savedPresets = loadCustomScenePresets();
  const isKnownBackground = (id: string) => BACKGROUNDS.some((p) => p.id === id)
    || id === 'custom'
    || savedPresets.some((p) => p.id === id);

  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    return ensureCompositionScenes({
      background: fallbackBackground,
      gradientColors: fallbackGradient,
    }).map((scene) => ({ ...scene, stage: captureSceneStage(fallbackProject) }));
  }

  return input.scenes.slice(0, MAX_COMPOSITION_SCENES).map((raw, index) => {
    const item = (raw ?? {}) as Partial<CompositionScene>;
    const backgroundId = typeof item.background === 'string' && isKnownBackground(item.background)
      ? item.background
      : fallbackBackground;
    const builtinGradient = backgroundId in BUILTIN_GRADIENTS
      ? BUILTIN_GRADIENTS[backgroundId as keyof typeof BUILTIN_GRADIENTS]
      : undefined;
    const savedGradient = savedPresets.find((p) => p.id === backgroundId)?.gradient;
    const gradientFallback = backgroundId === 'transparent'
      ? DEFAULT_GRADIENT
      : (builtinGradient ?? savedGradient ?? fallbackGradient);
    const scene = createCompositionScene({
      id: typeof item.id === 'string' && item.id ? item.id : `scene-${index + 1}`,
      name: typeof item.name === 'string' && item.name.trim() ? item.name : `Scene ${index + 1}`,
      background: backgroundId,
      gradientColors: backgroundId === 'transparent'
        ? { ...DEFAULT_GRADIENT }
        : resolveSceneGradient(backgroundId, item.gradientColors, gradientFallback),
    });
    const stored = (raw as { stage?: unknown }).stage;
    return {
      ...scene,
      stage: stored ? normalizeStoredStage(stored, fallbackProject) : captureSceneStage(fallbackProject),
    };
  });
}

function normalizeOverlays(input: Partial<MockupProject>): SceneOverlay[] {
  if (!Array.isArray(input.overlays)) return [];
  return input.overlays.slice(0, 24).flatMap((raw, index) => {
    const item = (raw ?? {}) as Partial<SceneOverlay>;
    const kind = item.kind === 'image' ? 'image'
      : item.kind === 'comment' ? 'comment'
        : item.kind === 'shape' ? 'shape'
          : item.kind === 'path' ? 'path'
            : item.kind === 'text' ? 'text'
              : null;
    if (!kind) return [];
    const imageData = kind === 'image'
      && typeof item.imageData === 'string'
      && /^data:image\/(png|jpeg|webp);base64,/i.test(item.imageData)
      ? item.imageData
      : null;
    if (kind === 'image' && !imageData) return [];
    return [createOverlay({
      id: typeof item.id === 'string' ? item.id : `overlay-${index}`,
      kind,
      x: number(item.x, 0.5, 0, 1),
      y: number(item.y, 0.18, 0, 1),
      scale: number(item.scale, 1, 0.2, 4),
      opacity: number(item.opacity, 1, 0, 1),
      startTime: number(item.startTime, 0, 0, 60),
      endTime: number(item.endTime, 30, 0, 60),
      text: kind === 'shape'
        ? (item.text === 'ellipse' || item.text === 'triangle' ? item.text : 'rect')
        : kind === 'path'
          ? (typeof item.text === 'string' ? item.text.slice(0, 8000) : '')
          : (typeof item.text === 'string' ? item.text.slice(0, 160) : undefined),
      color: typeof item.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(item.color.trim())
        ? item.color.trim().toLowerCase()
        : '#ffffff',
      fill: typeof item.fill === 'string' && /^#([0-9a-fA-F]{6})$/.test(item.fill.trim())
        ? item.fill.trim().toLowerCase()
        : undefined,
      fontSize: number(item.fontSize, 0.055, 0.02, 0.2),
      extrusion: number(item.extrusion, 0, 0, 1),
      imageData,
      anchor: item.anchor,
    })];
  });
}

function normalizeAnimation(raw: unknown, devices: DeviceInstance[]): AnimationClip {
  const fallback = createDefaultAnimation(devices[0]?.id ?? 'device-main');
  if (!raw || typeof raw !== 'object') return fallback;
  const input = raw as Partial<AnimationClip>;
  const allowed = new Set(ANIM_PROPERTIES.map((p) => p.id));
  const deviceIds = new Set(devices.map((d) => d.id));
  const isCameraProp = (p: AnimProperty) => p.startsWith('camera.');

  const tracks: AnimTrack[] = Array.isArray(input.tracks)
    ? input.tracks.flatMap((item, index) => {
      const track = (item ?? {}) as Partial<AnimTrack>;
      const property = allowed.has(track.property as AnimProperty) ? track.property as AnimProperty : null;
      if (!property) return [];
      const targetId = isCameraProp(property)
        ? CAMERA_TARGET_ID
        : (typeof track.targetId === 'string' && deviceIds.has(track.targetId)
          ? track.targetId
          : devices[0]?.id);
      if (!targetId) return [];
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
