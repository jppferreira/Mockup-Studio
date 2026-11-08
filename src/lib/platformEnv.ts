import { isPlaceholderScreenshot, placeholderForDevice, placeholderForSplitDevice } from './demo';
import { getDevice, type DevicePlatform } from './devices';
import { STUDIO_START_POSITION, STUDIO_START_ROTATION } from './studioEnvironment';
import {
  ANDROID_DEVICE_ID, IOS_DEVICE_ID, createDeviceInstance, getSelectedDevice,
  syncProjectFromSelected,
  type DeviceColor, type DeviceInstance, type MockupProject, type PublishTarget,
} from '../types';

export type { PublishTarget };

function envPlaceholder(deviceId: string, compositionMode: MockupProject['compositionMode']): string {
  return compositionMode === 'split'
    ? placeholderForSplitDevice(deviceId)
    : placeholderForDevice(deviceId);
}

export function platformOfDevice(device: DeviceInstance): DevicePlatform {
  return getDevice(device.deviceId).platform;
}

export function resolvePublishTarget(project: MockupProject): PublishTarget {
  if (project.publishTarget === 'ios' || project.publishTarget === 'android') {
    return project.publishTarget;
  }
  return platformOfDevice(getSelectedDevice(project));
}

export function deviceScreenMedia(
  device: DeviceInstance,
  projectFallback: string | null = null,
): string | null {
  if (device.screenshot !== undefined) return device.screenshot;
  return projectFallback;
}

export function deviceFinish(device: DeviceInstance, project: MockupProject): {
  deviceColor: DeviceColor;
  clayMode: boolean;
} {
  const deviceColor = device.deviceColor ?? project.deviceColor;
  const clayMode = device.clayMode ?? project.clayMode ?? deviceColor === 'clay';
  return { deviceColor, clayMode };
}

/** Device that owns the active publish-target environment. */
export function getPublishEnvDevice(project: MockupProject): DeviceInstance {
  const target = resolvePublishTarget(project);
  const match = project.devices.find((d) => platformOfDevice(d) === target);
  return match ?? getSelectedDevice(project);
}

export function getOppositePublishTarget(target: PublishTarget): PublishTarget {
  return target === 'ios' ? 'android' : 'ios';
}

/** Select the device for `target` and mirror its assets onto project top-level fields. */
export function setPublishTarget(project: MockupProject, target: PublishTarget): MockupProject {
  const match = project.devices.find((d) => platformOfDevice(d) === target)
    ?? getSelectedDevice(project);
  const finish = deviceFinish(match, project);
  const withTarget: MockupProject = {
    ...project,
    publishTarget: target,
    devices: project.devices.map((device) => (
      device.id === match.id
        ? {
          ...device,
          screenshot: deviceScreenMedia(device, project.screenshot),
          deviceColor: finish.deviceColor,
          clayMode: finish.clayMode,
        }
        : {
          ...device,
          screenshot: device.screenshot !== undefined
            ? device.screenshot
            : (project.compositionMode === 'split' ? envPlaceholder(device.deviceId, 'split') : device.screenshot),
        }
    )),
  };
  const selected = withTarget.devices.find((d) => d.id === match.id) ?? match;
  return syncProjectFromSelected(withTarget, selected);
}

/** Write screen media onto one device and select it so the canvas shows that shot. */
export function applyScreenToDevice(
  project: MockupProject,
  deviceId: string,
  dataUrl: string | null,
): MockupProject {
  const exists = project.devices.some((device) => device.id === deviceId);
  if (!exists) return applyScreenToPublishEnv(project, dataUrl);
  const devices = project.devices.map((device) => {
    if (device.id === deviceId) return { ...device, screenshot: dataUrl };
    if (device.screenshot === undefined) {
      return {
        ...device,
        screenshot: envPlaceholder(device.deviceId, project.compositionMode),
      };
    }
    return device;
  });
  const selected = devices.find((device) => device.id === deviceId) ?? devices[0];
  return syncProjectFromSelected({
    ...project,
    devices,
    publishTarget: platformOfDevice(selected),
    screenshot: dataUrl,
  }, selected);
}

/** Write screen media into the active publish-target env only. */
export function applyScreenToPublishEnv(
  project: MockupProject,
  dataUrl: string | null,
): MockupProject {
  const target = resolvePublishTarget(project);
  const env = getPublishEnvDevice(project);
  const devices = project.devices.map((device) => {
    if (device.id !== env.id) {
      // Ensure siblings keep an explicit screenshot so project.screenshot no longer bleeds.
      if (device.screenshot === undefined) {
        return {
          ...device,
          screenshot: envPlaceholder(device.deviceId, project.compositionMode),
        };
      }
      return device;
    }
    return { ...device, screenshot: dataUrl };
  });
  const selected = devices.find((d) => d.id === env.id) ?? devices[0];
  return syncProjectFromSelected({
    ...project,
    publishTarget: target,
    devices,
    screenshot: dataUrl,
  }, selected);
}

/** Explicit user action — copy active env screen onto the opposite platform. */
export function copyScreenToOtherPlatform(project: MockupProject): MockupProject {
  if (project.compositionMode !== 'split') return project;
  const target = resolvePublishTarget(project);
  const other = getOppositePublishTarget(target);
  const source = getPublishEnvDevice(project);
  const shot = deviceScreenMedia(source, project.screenshot);
  if (shot == null) return project;
  const devices = project.devices.map((device) => (
    platformOfDevice(device) === other
      ? { ...device, screenshot: shot }
      : {
        ...device,
        screenshot: deviceScreenMedia(device, project.screenshot),
      }
  ));
  return { ...project, devices, publishTarget: target };
}

export function buildPlatformSplitDevices(
  base: DeviceInstance,
  project: Pick<MockupProject, 'screenshot' | 'deviceColor' | 'clayMode'>,
): DeviceInstance[] {
  const basePlatform = platformOfDevice(base);
  const baseShot = deviceScreenMedia(base, project.screenshot);
  const baseColor = base.deviceColor ?? project.deviceColor;
  const baseClay = base.clayMode ?? project.clayMode ?? false;
  const sharedRotation = { ...base.rotation };
  const sharedScale = Math.min(base.scale, 0.92);
  // Dual canvases: each phone sits at its own canvas origin (not side-by-side offsets).
  const iosId = basePlatform === 'ios' ? base.deviceId : IOS_DEVICE_ID;
  const androidId = basePlatform === 'android' ? base.deviceId : ANDROID_DEVICE_ID;
  const iosShot = basePlatform === 'ios'
    ? (isPlaceholderScreenshot(baseShot) ? placeholderForSplitDevice(iosId) : baseShot)
    : placeholderForSplitDevice(iosId);
  const androidShot = basePlatform === 'android'
    ? (isPlaceholderScreenshot(baseShot) ? placeholderForSplitDevice(androidId) : baseShot)
    : placeholderForSplitDevice(androidId);
  return [
    createDeviceInstance({
      id: 'device-ios',
      deviceId: iosId,
      rotation: sharedRotation,
      scale: sharedScale,
      position: { x: 0, y: 0, z: 0 },
      glassReflection: base.glassReflection,
      reflectionStyle: base.reflectionStyle,
      screenshot: iosShot,
      deviceColor: basePlatform === 'ios' ? baseColor : 'graphite',
      clayMode: basePlatform === 'ios' ? baseClay : false,
    }),
    createDeviceInstance({
      id: 'device-android',
      deviceId: androidId,
      rotation: { ...sharedRotation },
      scale: sharedScale,
      position: { x: 0, y: 0, z: 0 },
      glassReflection: base.glassReflection,
      reflectionStyle: base.reflectionStyle,
      screenshot: androidShot,
      deviceColor: basePlatform === 'android' ? baseColor : 'graphite',
      clayMode: basePlatform === 'android' ? baseClay : false,
    }),
  ];
}

/**
 * Build a single-device project slice for one dual-canvas pane.
 * Shared look (background, lights, props, animation clip) stays; only one env device is present.
 * Forced to `compositionMode: 'single'` so each WebGL scene uses solo camera framing.
 */
export function projectForEnvCanvas(
  project: MockupProject,
  platform: PublishTarget,
): MockupProject {
  const match = project.devices.find((d) => platformOfDevice(d) === platform)
    ?? getSelectedDevice(project);
  const finish = deviceFinish(match, project);
  // Migrate classic side-by-side offsets (±1.35) into centered dual-canvas local space.
  const x = match.position?.x ?? 0;
  const legacyOffset = Math.abs(Math.abs(x) - 1.35) < 0.05;
  const device: DeviceInstance = {
    ...match,
    screenshot: deviceScreenMedia(match, project.screenshot),
    deviceColor: finish.deviceColor,
    clayMode: finish.clayMode,
    position: {
      x: legacyOffset ? 0 : x,
      y: match.position?.y ?? 0,
      z: match.position?.z ?? 0,
    },
  };
  return syncProjectFromSelected({
    ...project,
    compositionMode: 'single',
    publishTarget: platform,
    devices: [device],
    selectedDeviceId: device.id,
    screenshot: device.screenshot ?? null,
    deviceColor: finish.deviceColor,
    clayMode: finish.clayMode,
  }, device);
}

/** Device instance for a platform pane (creates nothing — falls back to selected). */
export function getPlatformDevice(
  project: MockupProject,
  platform: PublishTarget,
): DeviceInstance {
  return project.devices.find((d) => platformOfDevice(d) === platform)
    ?? getSelectedDevice(project);
}

/**
 * Set the catalog model on one platform pane only.
 * Does not change publishTarget — the other pane’s model/finish stay as stored on its instance.
 */
export function applyDeviceToPlatform(
  project: MockupProject,
  platform: PublishTarget,
  deviceId: string,
): MockupProject {
  const env = getPlatformDevice(project, platform);
  const prevShot = deviceScreenMedia(env, project.screenshot);
  const screenshot = isPlaceholderScreenshot(prevShot)
    ? envPlaceholder(deviceId, project.compositionMode)
    : (env.screenshot !== undefined ? env.screenshot : prevShot);
  const updated: DeviceInstance = {
    ...env,
    deviceId,
    screenshot: screenshot ?? null,
    // Finish stays on this pane — remembered across publish-target switches.
    deviceColor: env.deviceColor ?? project.deviceColor,
    clayMode: env.clayMode ?? project.clayMode ?? false,
    // New model always opens front-facing above the studio floor.
    rotation: { ...STUDIO_START_ROTATION },
    position: project.compositionMode === 'split' ? { ...env.position } : { ...STUDIO_START_POSITION },
  };
  const devices = project.devices.map((device) => (device.id === env.id ? updated : device));
  const active = resolvePublishTarget(project);
  if (active === platform) {
    return syncProjectFromSelected({
      ...project,
      devices,
      publishTarget: platform,
      cameraView: 'front',
    }, updated);
  }
  // Inactive pane: persist model on its instance; keep mirrored fields on the publish env.
  const publishEnv = devices.find((d) => platformOfDevice(d) === active)
    ?? getSelectedDevice({ ...project, devices });
  return syncProjectFromSelected({
    ...project,
    devices,
    publishTarget: active,
    cameraView: 'front',
  }, publishEnv);
}

/** Patch finish onto one platform pane; mirror top-level only if that pane is the publish target. */
export function applyFinishToPlatform(
  project: MockupProject,
  platform: PublishTarget,
  finish: { deviceColor: DeviceColor; clayMode: boolean },
): MockupProject {
  const env = getPlatformDevice(project, platform);
  const devices = project.devices.map((device) => (
    device.id === env.id
      ? { ...device, deviceColor: finish.deviceColor, clayMode: finish.clayMode }
      : device
  ));
  const active = resolvePublishTarget(project);
  if (active === platform) {
    const selected = devices.find((d) => d.id === env.id) ?? env;
    return syncProjectFromSelected({
      ...project,
      devices,
      publishTarget: platform,
      deviceColor: finish.deviceColor,
      clayMode: finish.clayMode,
    }, selected);
  }
  const publishEnv = devices.find((d) => platformOfDevice(d) === active)
    ?? getSelectedDevice({ ...project, devices });
  return syncProjectFromSelected({ ...project, devices, publishTarget: active }, publishEnv);
}

/** Patch finish onto the active env device and mirror project fields. */
export function applyFinishToPublishEnv(
  project: MockupProject,
  finish: { deviceColor: DeviceColor; clayMode: boolean },
): MockupProject {
  return applyFinishToPlatform(project, resolvePublishTarget(project), finish);
}

/** Copy rotation + scale from `source` onto every other device (position stays free). */
export function mirrorLinkedTransforms(
  devices: DeviceInstance[],
  source: DeviceInstance,
): DeviceInstance[] {
  return devices.map((device) => (
    device.id === source.id
      ? device
      : {
        ...device,
        rotation: { ...source.rotation },
        scale: source.scale,
      }
  ));
}

/**
 * After animation evaluation, force linked split partners to share rotation/scale
 * from the active publish-target device (tracks may only exist on one targetId).
 */
export function applyLinkedTransformsAfterAnim(
  project: MockupProject,
  devices: DeviceInstance[],
): DeviceInstance[] {
  if (project.compositionMode !== 'split' || project.linkSplitTransform === false) {
    return devices;
  }
  const target = resolvePublishTarget(project);
  const source = devices.find((d) => platformOfDevice(d) === target)
    ?? devices.find((d) => d.id === project.selectedDeviceId)
    ?? devices[0];
  if (!source) return devices;
  return mirrorLinkedTransforms(devices, source);
}

/**
 * Ensure every device has an explicit screenshot so legacy shared project.screenshot
 * does not bleed across platforms after dual-env enablement.
 */
export function ensurePerDeviceScreenshots(project: MockupProject): MockupProject {
  const devices = project.devices.map((device) => {
    if (device.screenshot !== undefined) {
      // Split mode: refresh size-guide plates to the black dimension style.
      if (
        project.compositionMode === 'split'
        && isPlaceholderScreenshot(device.screenshot)
      ) {
        const next = placeholderForSplitDevice(device.deviceId);
        return device.screenshot === next ? device : { ...device, screenshot: next };
      }
      return device;
    }
    // Single mode / sole device inherits project screenshot; split siblings get placeholders
    // except the selected/publish device which inherits the shared shot.
    const isActive = device.id === project.selectedDeviceId
      || platformOfDevice(device) === resolvePublishTarget(project);
    if (project.compositionMode !== 'split' || isActive) {
      return { ...device, screenshot: project.screenshot ?? null };
    }
    return { ...device, screenshot: envPlaceholder(device.deviceId, project.compositionMode) };
  });
  const selected = devices.find((d) => d.id === project.selectedDeviceId) ?? devices[0];
  return syncProjectFromSelected({ ...project, devices }, selected);
}

/** Upgrade any in-session size-guide screenshots to black split plates. */
export function refreshSplitPlaceholders(project: MockupProject): MockupProject {
  if (project.compositionMode !== 'split') return project;
  let changed = false;
  const devices = project.devices.map((device) => {
    const shot = deviceScreenMedia(device, project.screenshot);
    if (!isPlaceholderScreenshot(shot)) return device;
    const next = placeholderForSplitDevice(device.deviceId);
    if (device.screenshot === next) return device;
    changed = true;
    return { ...device, screenshot: next };
  });
  if (!changed) return project;
  const selected = devices.find((d) => d.id === project.selectedDeviceId) ?? devices[0];
  return syncProjectFromSelected({ ...project, devices }, selected);
}
