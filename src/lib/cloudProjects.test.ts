import { describe, expect, it } from 'vitest';
import { cloudSyncPayload, MAX_STATE_CHARS, newerSyncCopy, shouldAdoptRemoteDocument, slimForCloud } from './cloudProjects';
import { externalizeSceneAssets } from './sceneDocument';
import { keepSessionPose, validateProject } from './project';
import { captureSceneStage, commitActiveScene, createDeviceInstance, DEFAULT_PROJECT, type MockupProject } from '../types';
import type { SceneDocument } from './sceneDocument';

function dataUrl(fill: string, chars: number) {
  return `data:image/png;base64,${fill.repeat(chars)}`;
}

describe('slimForCloud size check', () => {
  it('strips per-scene screenshots, overlays, and texture maps before measuring the payload', () => {
    expect(MAX_STATE_CHARS).toBe(3_500_000);

    const screenshot = dataUrl('A', 900_000);
    const overlayImage = dataUrl('B', 900_000);
    const normalMap = dataUrl('C', 900_000);
    const roughnessMap = dataUrl('D', 900_000);
    const assetRef = 'asset:sha256:abc123def4567890';

    const project = {
      name: 'Web composition',
      screenshot,
      reflectionMapImage: null,
      soundtrackData: null,
      devices: [{
        id: 'device-live',
        screenshot: assetRef,
        materialTweaks: {
          Glass: { color: '#ffffff', roughness: 0.4, mapDataUrl: screenshot },
        },
      }],
      overlays: [{ id: 'frame-image', kind: 'image', imageData: overlayImage }],
      scenes: [{
        id: 'scene-1',
        name: 'Scene 1',
        stage: {
          reflectionMapImage: screenshot,
          devices: [{
            id: 'device-scene',
            screenshot,
            screenLayers: [{ id: 'plate', name: 'UI', dataUrl: screenshot }],
            materialTweaks: {
              Glass: {
                color: '#ffffff',
                roughness: 0.4,
                mapDataUrl: screenshot,
                normalMapDataUrl: normalMap,
                roughnessMapDataUrl: roughnessMap,
                metalnessMapDataUrl: overlayImage,
              },
            },
          }],
          overlays: [{ id: 'stage-image', kind: 'image', imageData: overlayImage }],
        },
      }],
    } as unknown as MockupProject;

    const raw = JSON.stringify(project);
    expect(raw.length).toBeGreaterThan(MAX_STATE_CHARS);

    const slim = slimForCloud(project);
    const stage = slim.scenes[0].stage!;
    const stageDevice = stage.devices[0];
    const tweaks = stageDevice.materialTweaks?.Glass;

    expect(stageDevice.screenshot).toBeNull();
    expect(stageDevice.screenLayers).toEqual([]);
    expect(stage.overlays[0].imageData).toBeNull();
    expect(stage.reflectionMapImage).toBeNull();
    expect(tweaks?.color).toBe('#ffffff');
    expect(tweaks?.roughness).toBe(0.4);
    expect(tweaks).not.toHaveProperty('mapDataUrl');
    expect(tweaks).not.toHaveProperty('normalMapDataUrl');
    expect(tweaks).not.toHaveProperty('roughnessMapDataUrl');
    expect(tweaks).not.toHaveProperty('metalnessMapDataUrl');
    expect(slim.devices[0].screenshot).toBe(assetRef);
    expect(slim.overlays[0].imageData).toBeNull();

    const payload = cloudSyncPayload({ scene: project } as SceneDocument);
    expect(payload.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    expect(payload.includes('data:image')).toBe(false);
  });

  it('strips oversized material maps that are not data URLs', () => {
    const heavy = `raw-base64:${'Z'.repeat(50_000)}`;
    const project = {
      ...DEFAULT_PROJECT,
      devices: [{
        ...DEFAULT_PROJECT.devices[0],
        materialTweaks: {
          Glass: { color: '#ffffff', roughness: 0.2, mapDataUrl: heavy },
        },
      }],
    } as unknown as MockupProject;
    const slim = slimForCloud(project);
    expect(slim.devices[0].materialTweaks?.Glass).toEqual({ color: '#ffffff', roughness: 0.2 });
    expect(JSON.stringify(slim).includes(heavy.slice(0, 32))).toBe(false);
  });

  it('fits a hydrated project after screenshots are turned into asset refs', async () => {
    const screenshot = dataUrl('H', 1_200_000);
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      screenshot,
    });
    const project = {
      ...DEFAULT_PROJECT,
      screenshot,
      devices: [device, createDeviceInstance({
        ...DEFAULT_PROJECT.devices[0],
        id: 'device-2',
        screenshot,
      })],
      selectedDeviceId: device.id,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage({
          ...DEFAULT_PROJECT,
          screenshot,
          devices: [device],
          selectedDeviceId: device.id,
        }),
      }],
    };
    const raw = JSON.stringify(project);
    expect(raw.length).toBeGreaterThan(MAX_STATE_CHARS);

    const { scene, assets } = await externalizeSceneAssets(project);
    const payload = cloudSyncPayload({
      schemaVersion: 1,
      id: 'doc-hydrated',
      revision: 2,
      baseRevision: 1,
      updatedAt: Date.now(),
      deviceRefs: [],
      assets,
      scene,
    } as SceneDocument);

    expect(payload.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    expect(payload.includes('data:image')).toBe(false);
    expect(payload.includes('asset:sha256:')).toBe(true);
    expect(assets.length).toBeGreaterThan(0);
  });
});

describe('device screenshot sync', () => {
  it('keeps the scene copy of a device image so the web project can download it', async () => {
    const screenshot = dataUrl('A', 4000);
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      screenshot,
    });
    const base = {
      ...DEFAULT_PROJECT,
      screenshot,
      devices: [device],
      selectedDeviceId: device.id,
    };
    const staged = {
      ...base,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage(base),
      }],
    };

    const { scene, assets } = await externalizeSceneAssets(staged);
    const ref = scene.devices[0].screenshot;
    expect(ref).toMatch(/^asset:sha256:/);
    expect(scene.scenes[0].stage?.devices[0].screenshot).toBe(ref);
    expect(assets.some((asset) => asset.kind === 'screenshot')).toBe(true);

    const slim = slimForCloud(scene);
    expect(slim.devices[0].screenshot).toBe(ref);
    expect(slim.scenes[0].stage?.devices[0].screenshot).toBe(ref);
    expect(JSON.stringify(slim).includes('data:image')).toBe(false);
  });

  it('restores a device image when the scene snapshot was stripped', () => {
    const shot = 'asset:sha256:abc123def4567890abcd';
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      screenshot: shot,
    });
    const base = {
      ...DEFAULT_PROJECT,
      screenshot: shot,
      devices: [device],
      selectedDeviceId: device.id,
    };
    const stage = captureSceneStage(base);
    stage.devices[0] = { ...stage.devices[0], screenshot: null };
    const opened = validateProject({
      ...base,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage,
      }],
    });
    expect(opened.devices[0].screenshot).toBe(shot);
    expect(opened.scenes[0].stage?.devices[0].screenshot).toBe(shot);
  });
});

describe('camera pose sync', () => {
  it('keeps the free-orbit camera on the project the other device opens', () => {
    const device = createDeviceInstance({ ...DEFAULT_PROJECT.devices[0] });
    const cameraOrbit = {
      offset: { x: 2.5, y: 1.25, z: 6.5 },
      lookOffset: { x: 0.2, y: 0.1, z: 0 },
    };
    const base = {
      ...DEFAULT_PROJECT,
      devices: [device],
      selectedDeviceId: device.id,
      cameraOrbit,
    };
    const opened = validateProject({
      ...base,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage(base),
      }],
    });
    expect(opened.cameraOrbit).toEqual(cameraOrbit);
    expect(opened.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
    expect(slimForCloud(opened).cameraOrbit).toEqual(cameraOrbit);
    expect(slimForCloud(opened).scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
  });

  it('keeps a camera that was saved on the file when the scene snapshot has none', () => {
    const device = createDeviceInstance({ ...DEFAULT_PROJECT.devices[0] });
    const cameraOrbit = {
      offset: { x: 2.5, y: 1.25, z: 6.5 },
      lookOffset: { x: 0.2, y: 0.1, z: 0 },
    };
    const opened = validateProject({
      ...DEFAULT_PROJECT,
      devices: [device],
      selectedDeviceId: device.id,
      cameraOrbit,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage({
          ...DEFAULT_PROJECT,
          devices: [device],
          selectedDeviceId: device.id,
          cameraOrbit: null,
        }),
      }],
    });
    expect(opened.cameraOrbit).toEqual(cameraOrbit);
    expect(opened.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
  });

  it('seals the live camera, device angle, position, and light into the file', () => {
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      rotation: { x: 12, y: -34, z: 6 },
      position: { x: 0.4, y: 0.2, z: -0.3 },
    });
    const cameraOrbit = {
      offset: { x: 3.25, y: 0.8, z: 7.1 },
      lookOffset: { x: -0.4, y: 0.15, z: 0.2 },
    };
    const live = {
      ...DEFAULT_PROJECT,
      devices: [device],
      selectedDeviceId: device.id,
      rotation: { ...device.rotation },
      cameraOrbit,
      lightPosition: { x: 1.2, y: 4.4, z: 2.2 },
      lightIntensity: 1.8,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage(DEFAULT_PROJECT),
      }],
    };
    const opened = validateProject(commitActiveScene(live));
    const slim = slimForCloud(opened);
    expect(opened.cameraOrbit).toEqual(cameraOrbit);
    expect(opened.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
    expect(opened.devices[0].rotation).toEqual(device.rotation);
    expect(opened.scenes[0].stage?.devices[0].rotation).toEqual(device.rotation);
    expect(opened.devices[0].position).toEqual(device.position);
    expect(opened.scenes[0].stage?.devices[0].position).toEqual(device.position);
    expect(opened.lightPosition).toEqual(live.lightPosition);
    expect(opened.lightIntensity).toBe(1.8);
    expect(opened.scenes[0].stage?.lightPosition).toEqual(live.lightPosition);
    expect(slim.cameraOrbit).toEqual(cameraOrbit);
    expect(slim.devices[0].rotation).toEqual(device.rotation);
    expect(slim.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
    expect(slim.scenes[0].stage?.devices[0].position).toEqual(device.position);
  });

  it('keeps a session angle when the stored file is still on the default', () => {
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      rotation: { x: 8, y: 24, z: -6 },
      position: { x: 0.3, y: 0, z: 0.2 },
    });
    const cameraOrbit = { offset: { x: 1.5, y: 2, z: 7 } };
    const stored = validateProject(DEFAULT_PROJECT);
    const session = validateProject(commitActiveScene({
      ...DEFAULT_PROJECT,
      devices: [device],
      selectedDeviceId: device.id,
      rotation: { ...device.rotation },
      cameraOrbit,
    }));
    const opened = validateProject(keepSessionPose(stored, session));
    expect(opened.cameraOrbit).toEqual(cameraOrbit);
    expect(opened.devices[0].rotation).toEqual(device.rotation);
    expect(opened.devices[0].position).toEqual(device.position);
    expect(opened.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
  });

  it('keeps the free-orbit camera inside the cloud sync JSON payload', () => {
    const cameraOrbit = {
      offset: { x: 4.2, y: 1.1, z: 6.8 },
      lookOffset: { x: -0.3, y: 0.2, z: 0.1 },
    };
    const sealed = validateProject(commitActiveScene({
      ...DEFAULT_PROJECT,
      cameraOrbit,
      scenes: [{
        ...DEFAULT_PROJECT.scenes[0],
        stage: captureSceneStage({
          ...DEFAULT_PROJECT,
          cameraOrbit,
        }),
      }],
    }));
    const doc = {
      schemaVersion: 1,
      id: 'doc-camera-orbit',
      revision: 2,
      baseRevision: 1,
      updatedAt: Date.now(),
      deviceRefs: [],
      assets: [],
      scene: sealed,
    } satisfies SceneDocument;
    const payload = JSON.parse(cloudSyncPayload(doc)) as SceneDocument;
    expect(payload.scene.cameraOrbit).toEqual(cameraOrbit);
    expect(payload.scene.scenes[0].stage?.cameraOrbit).toEqual(cameraOrbit);
  });

  it('keeps a zoomed-and-panned camera that used to exceed the old distance cap', () => {
    const cameraOrbit = {
      offset: { x: 42, y: 18, z: 55 },
      lookOffset: { x: 12, y: -4, z: 8 },
    };
    const opened = validateProject(commitActiveScene({
      ...DEFAULT_PROJECT,
      cameraOrbit,
    }));
    expect(opened.cameraOrbit).toEqual({
      offset: {
        x: Number(cameraOrbit.offset.x.toFixed(4)),
        y: Number(cameraOrbit.offset.y.toFixed(4)),
        z: Number(cameraOrbit.offset.z.toFixed(4)),
      },
      lookOffset: {
        x: Number(cameraOrbit.lookOffset.x.toFixed(4)),
        y: Number(cameraOrbit.lookOffset.y.toFixed(4)),
        z: Number(cameraOrbit.lookOffset.z.toFixed(4)),
      },
    });
    expect(slimForCloud(opened).cameraOrbit).toEqual(opened.cameraOrbit);
  });

  it('keeps a mouse-orbit commit pose through validate, session restore, and cloud payload', () => {
    // Simulates DeviceCanvas finishOrbit → onCameraCommit(position, orbit).
    const mouseOrbit = {
      offset: { x: -3.4, y: 2.1, z: 5.6 },
      lookOffset: { x: 0.5, y: -0.2, z: 0.1 },
    };
    const sealed = validateProject(commitActiveScene({
      ...DEFAULT_PROJECT,
      cameraOrbit: mouseOrbit,
    }));
    const storedDefault = validateProject(DEFAULT_PROJECT);
    const restored = validateProject(keepSessionPose(storedDefault, sealed));
    expect(restored.cameraOrbit).toEqual(mouseOrbit);
    expect(restored.scenes[0].stage?.cameraOrbit).toEqual(mouseOrbit);

    const doc = {
      schemaVersion: 1,
      id: 'doc-mouse-orbit',
      revision: 3,
      baseRevision: 2,
      updatedAt: Date.now(),
      deviceRefs: [],
      assets: [],
      scene: sealed,
    } satisfies SceneDocument;
    const payload = JSON.parse(cloudSyncPayload(doc)) as SceneDocument;
    expect(payload.scene.cameraOrbit).toEqual(mouseOrbit);
  });

  it('keeps timeline animation edits when the stored file is still the stock clip', () => {
    const device = createDeviceInstance({ ...DEFAULT_PROJECT.devices[0] });
    const customAnimation = {
      duration: 6,
      fps: 30,
      loop: true,
      tracks: [{
        id: 'track-custom-rot-y',
        targetId: device.id,
        property: 'rotation.y' as const,
        keyframes: [
          { id: 'kf-0', time: 0, value: 0 },
          { id: 'kf-1', time: 3, value: 90 },
          { id: 'kf-2', time: 6, value: 0 },
        ],
      }],
    };
    const stored = validateProject(DEFAULT_PROJECT);
    const session = validateProject(commitActiveScene({
      ...DEFAULT_PROJECT,
      devices: [device],
      selectedDeviceId: device.id,
      animation: customAnimation,
    }));
    const opened = validateProject(keepSessionPose(stored, session));
    expect(opened.animation.duration).toBe(6);
    expect(opened.animation.tracks[0]?.keyframes.map((frame) => frame.value)).toEqual([0, 90, 0]);
    expect(opened.scenes[0].stage?.animation.tracks[0]?.keyframes.map((frame) => frame.value)).toEqual([0, 90, 0]);
  });
});

describe('shouldAdoptRemoteDocument', () => {
  it('opens the desktop save when this browser has an older or unsynced copy', () => {
    expect(shouldAdoptRemoteDocument(null, 4)).toBe(true);
    expect(shouldAdoptRemoteDocument({ revision: 1, baseRevision: 0 }, 6)).toBe(true);
    expect(shouldAdoptRemoteDocument({ revision: 5, baseRevision: 5 }, 6)).toBe(true);
    // Autosave bumped the same counter without sealing the cloud revision.
    expect(shouldAdoptRemoteDocument({ revision: 6, baseRevision: 5 }, 6)).toBe(true);
  });

  it('keeps a local edit that the account has not caught up with', () => {
    expect(shouldAdoptRemoteDocument({ revision: 6, baseRevision: 5 }, 5)).toBe(false);
    expect(shouldAdoptRemoteDocument({ revision: 3, baseRevision: 3 }, 3)).toBe(false);
    expect(shouldAdoptRemoteDocument({ revision: 2, baseRevision: 2 }, 0)).toBe(false);
  });
});

describe('newerSyncCopy', () => {
  const now = 1_700_000_000_000;

  it('keeps this device when its save is newer or the same moment', () => {
    expect(newerSyncCopy(now, now - 60_000)).toBe('keep-local');
    expect(newerSyncCopy(now, now)).toBe('keep-local');
  });

  it('takes the account copy when that save is later', () => {
    expect(newerSyncCopy(now, now + 1)).toBe('take-cloud');
    expect(newerSyncCopy(now, now + 1_500)).toBe('take-cloud');
    expect(newerSyncCopy(Number.NaN, now)).toBe('take-cloud');
  });
});
