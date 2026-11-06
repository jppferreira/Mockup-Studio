import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useGLTF } from '@react-three/drei';
import DeviceCanvas, { type CaptureApi } from './DeviceCanvas';
import TemplatePreview from './TemplatePreview';
import { ThumbStage, useThumbCapture } from './thumbStage';
import { getDevice } from '../lib/devices';
import { projectFromTemplate, type CompositionTemplate } from '../lib/templates';
import type { MockupProject, Vec3 } from '../types';

const THUMB_W = 640;
const THUMB_H = 400;

type ThumbJob = {
  id: string;
  project: MockupProject;
  attempt: number;
};

const THUMB_REV = 'frame11';
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
let queue: ThumbJob[] = [];
let active: ThumbJob | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Split projects are two canvases. A card is one frame, so place both devices in one shot. */
export function layoutForThumb(project: MockupProject): MockupProject {
  if (project.compositionMode !== 'split' || project.devices.length < 2) return project;
  const devices = project.devices.map((device, index) => ({
    ...device,
    position: {
      x: (index - (project.devices.length - 1) / 2) * 1.75,
      y: device.position.y,
      z: device.position.z,
    },
  }));
  return { ...project, compositionMode: 'single', devices };
}

function compositionFocus(project: MockupProject): Vec3 {
  const devices = project.devices;
  if (!devices.length) return { x: 0, y: 0, z: 0 };
  const n = devices.length;
  return devices.reduce((acc, device) => ({
    x: acc.x + device.position.x / n,
    y: acc.y + device.position.y / n,
    z: acc.z + device.position.z / n,
  }), { x: 0, y: 0, z: 0 });
}

function cacheId(id: string) {
  return `${THUMB_REV}:${id}`;
}

function warmProject(project: MockupProject) {
  for (const device of project.devices) {
    const url = getDevice(device.deviceId).url;
    if (url) useGLTF.preload(url);
  }
}

const viewers = new Map<string, number>();

function requestThumb(id: string, project: MockupProject) {
  viewers.set(id, (viewers.get(id) ?? 0) + 1);
  if ((viewers.get(id) ?? 0) > 1) return;
  warmProject(project);
  if (cache.has(cacheId(id))) return;
  if (active?.id === id) return;
  if (queue.some((item) => item.id === id)) return;
  queue = [...queue, { id, project, attempt: 0 }];
  if (!active) {
    active = queue.shift() ?? null;
    if (active) warmProject(active.project);
    emit();
  }
}

function releaseThumb(id: string) {
  const next = (viewers.get(id) ?? 1) - 1;
  if (next > 0) {
    viewers.set(id, next);
    return;
  }
  viewers.delete(id);
  queue = queue.filter((item) => item.id !== id);
  if (active?.id === id) {
    active = queue.shift() ?? null;
    if (active) warmProject(active.project);
    emit();
  }
}

function finishThumb(id: string, url: string) {
  const job = active?.id === id ? active : null;
  if (url) cache.set(cacheId(id), url);
  else if (job && job.attempt < 2) {
    queue = [...queue, { ...job, attempt: job.attempt + 1 }];
  }
  if (active?.id === id) {
    active = queue.shift() ?? null;
    if (active) warmProject(active.project);
  }
  emit();
}

function thumbCamera(project: MockupProject, focus: Vec3): Vec3 {
  const count = project.devices.length;
  const xs = project.devices.map((device) => device.position.x);
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const dist = count <= 1 ? 5.05 : Math.min(8.4, 5.2 + span * 0.85);
  return {
    x: focus.x + 0.32,
    y: focus.y + 0.12,
    z: focus.z + dist,
  };
}

function TemplateBakerBody({ job }: { job: ThumbJob }) {
  const captureRef = useRef<CaptureApi | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const focus = useMemo(() => compositionFocus(job.project), [job.project]);
  const cameraPosition = useMemo(() => thumbCamera(job.project, focus), [job.project, focus]);
  const markReady = useCallback(() => setSceneReady(true), []);

  useEffect(() => {
    const kick = () => window.dispatchEvent(new Event('resize'));
    const frame = requestAnimationFrame(kick);
    const timer = window.setTimeout(kick, 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [job.id]);

  useThumbCapture(captureRef, sceneReady, THUMB_W, THUMB_H, (url) => finishThumb(job.id, url));

  return createPortal(
    <div className="template-baker" aria-hidden data-thumb={job.id}>
      <DeviceCanvas
        project={job.project}
        focusPoint={focus}
        cameraPosition={cameraPosition}
        captureRef={captureRef}
        canvasId={`template-thumb-${job.id}-${job.attempt}`}
        gizmoActive={false}
        pixelRatio={[1, 1]}
        onSceneReady={markReady}
      />
    </div>,
    document.body,
  );
}

function TemplateBaker({ job }: { job: ThumbJob }) {
  const fail = useCallback(() => finishThumb(job.id, ''), [job.id]);
  return (
    <ThumbStage onError={fail}>
      <TemplateBakerBody job={job} />
    </ThumbStage>
  );
}

export function TemplateThumbHost() {
  const current = useSyncExternalStore(subscribe, () => active, () => null);
  if (!current) return null;
  return <TemplateBaker key={`${current.id}:${current.attempt}`} job={current} />;
}

export function ProjectThumb({ project, cacheKey }: { project: MockupProject; cacheKey: string }) {
  const framed = useMemo(() => layoutForThumb(project), [project]);
  const src = useSyncExternalStore(
    subscribe,
    () => cache.get(cacheId(cacheKey)) ?? null,
    () => null,
  );

  useEffect(() => {
    requestThumb(cacheKey, framed);
    return () => releaseThumb(cacheKey);
  }, [cacheKey, framed]);

  if (!src) return <span className="device-model-shot-wait" />;
  return <img src={src} alt="" />;
}

export default function TemplateThumb({ template }: { template: CompositionTemplate }) {
  const project = useMemo(() => layoutForThumb(projectFromTemplate(template)), [template]);
  const src = useSyncExternalStore(
    subscribe,
    () => cache.get(cacheId(template.id)) ?? null,
    () => null,
  );

  useEffect(() => {
    requestThumb(template.id, project);
    return () => releaseThumb(template.id);
  }, [template.id, project]);

  return (
    <span className="template-shot">
      {src ? <img src={src} alt="" /> : <TemplatePreview layout={template.preview} />}
    </span>
  );
}
