import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useGLTF } from '@react-three/drei';
import DeviceCanvas, { type CaptureApi } from './DeviceCanvas';
import { ThumbStage, useThumbCapture } from './thumbStage';
import { createPlaceholderScreenshot } from '../lib/demo';
import { categoryOfDevice, getDevice } from '../lib/devices';
import {
  BUILTIN_GRADIENTS,
  DEFAULT_PROJECT,
  createDeviceInstance,
  type MockupProject,
  type Vec3,
} from '../types';

const THUMB_W = 640;
const THUMB_H = 360;

const THUMB_REV = 'frame10';
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

type ModelJob = { id: string; attempt: number };
let queue: ModelJob[] = [];
let active: ModelJob | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function cacheId(deviceId: string) {
  return `${THUMB_REV}:${deviceId}`;
}

function warmDevice(deviceId: string | null) {
  if (!deviceId) return;
  const url = getDevice(deviceId).url;
  if (url) useGLTF.preload(url);
}

function warmAhead(job: ModelJob | null) {
  warmDevice(job?.id ?? null);
  queue.slice(0, 2).forEach((item) => warmDevice(item.id));
}

const viewers = new Map<string, number>();

function requestThumb(deviceId: string) {
  viewers.set(deviceId, (viewers.get(deviceId) ?? 0) + 1);
  if ((viewers.get(deviceId) ?? 0) > 1) return;
  if (cache.has(cacheId(deviceId)) || active?.id === deviceId || queue.some((item) => item.id === deviceId)) return;
  queue = [...queue, { id: deviceId, attempt: 0 }];
  if (!active) {
    active = queue.shift() ?? null;
    warmAhead(active);
    emit();
  }
}

function releaseThumb(deviceId: string) {
  const next = (viewers.get(deviceId) ?? 1) - 1;
  if (next > 0) {
    viewers.set(deviceId, next);
    return;
  }
  viewers.delete(deviceId);
  queue = queue.filter((item) => item.id !== deviceId);
  if (active?.id === deviceId) {
    active = queue.shift() ?? null;
    warmAhead(active);
    emit();
  }
}

function finishThumb(id: string, url: string) {
  const job = active?.id === id ? active : null;
  if (url) cache.set(cacheId(id), url);
  else if (job && job.attempt < 2) queue = [...queue, { ...job, attempt: job.attempt + 1 }];
  if (active?.id === id) {
    active = queue.shift() ?? null;
    warmAhead(active);
  }
  emit();
}

function thumbCamera(deviceId: string): Vec3 {
  const category = categoryOfDevice(getDevice(deviceId));
  // Devices are normalized to about 3 units tall. These distances fill the card.
  if (category === 'laptops') return { x: 0.9, y: 0.62, z: 5.35 };
  if (category === 'headphones' || category === 'spatial') return { x: 0.55, y: 0.28, z: 4.55 };
  if (category === 'tablets') return { x: 0.48, y: 0.16, z: 4.9 };
  if (category === 'watches') return { x: 0.38, y: 0.18, z: 4.15 };
  return { x: 0.46, y: 0.1, z: 4.95 };
}

function projectForDevice(deviceId: string): MockupProject {
  const model = getDevice(deviceId);
  // Card shots don't need a full-resolution screen. A small plate paints before the capture.
  const longEdge = 720;
  const aspect = model.screenSize.width / Math.max(1, model.screenSize.height);
  const shot = createPlaceholderScreenshot(
    aspect >= 1
      ? { width: longEdge, height: Math.max(1, Math.round(longEdge / aspect)) }
      : { width: Math.max(1, Math.round(longEdge * aspect)), height: longEdge },
    { label: model.label, deviceId: model.id },
  );
  const instance = createDeviceInstance({
    id: 'device-main',
    deviceId,
    screenshot: shot,
    rotation: { x: -8, y: 16, z: 0 },
    scale: 1,
    deviceColor: 'graphite',
    clayMode: false,
    lidOpen: model.lid ? 0.62 : undefined,
  });
  return {
    ...DEFAULT_PROJECT,
    name: model.label,
    screenshot: shot,
    deviceId,
    publishTarget: model.platform,
    devices: [instance],
    selectedDeviceId: instance.id,
    sceneProps: [],
    cameraView: 'front',
    background: 'studio',
    gradientColors: { ...BUILTIN_GRADIENTS.studio },
    animation: { duration: 1, fps: 30, loop: false, tracks: [] },
  };
}

function DeviceModelBakerBody({ deviceId }: { deviceId: string }) {
  const captureRef = useRef<CaptureApi | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const project = useMemo(() => projectForDevice(deviceId), [deviceId]);
  const cameraPosition = useMemo(() => thumbCamera(deviceId), [deviceId]);
  const markReady = useCallback(() => setSceneReady(true), []);

  useEffect(() => {
    const kick = () => window.dispatchEvent(new Event('resize'));
    const frame = requestAnimationFrame(kick);
    const timer = window.setTimeout(kick, 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [deviceId]);

  useThumbCapture(captureRef, sceneReady, THUMB_W, THUMB_H, (url) => finishThumb(deviceId, url));

  return createPortal(
    <div className="template-baker" aria-hidden data-device-thumb={deviceId}>
      <DeviceCanvas
        project={project}
        captureRef={captureRef}
        canvasId={`device-model-thumb-${deviceId}`}
        gizmoActive={false}
        cameraPosition={cameraPosition}
        pixelRatio={[1, 1]}
        onSceneReady={markReady}
      />
    </div>,
    document.body,
  );
}

function DeviceModelBaker({ deviceId }: { deviceId: string }) {
  const fail = useCallback(() => finishThumb(deviceId, ''), [deviceId]);
  return (
    <ThumbStage onError={fail}>
      <DeviceModelBakerBody deviceId={deviceId} />
    </ThumbStage>
  );
}

export function DeviceModelThumbHost() {
  const current = useSyncExternalStore(subscribe, () => active, () => null);
  if (!current) return null;
  return <DeviceModelBaker key={`${current.id}:${current.attempt}`} deviceId={current.id} />;
}

export default function DeviceModelThumb({ deviceId }: { deviceId: string }) {
  const src = useSyncExternalStore(subscribe, () => cache.get(cacheId(deviceId)) ?? null, () => null);

  useEffect(() => {
    requestThumb(deviceId);
    return () => releaseThumb(deviceId);
  }, [deviceId]);

  return (
    <span className="device-model-shot">
      {src ? <img src={src} alt="" /> : <span className="device-model-shot-wait" />}
    </span>
  );
}
