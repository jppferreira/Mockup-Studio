import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useGLTF } from '@react-three/drei';
import DeviceCanvas, { type CaptureApi } from './DeviceCanvas';
import TemplatePreview from './TemplatePreview';
import { ThumbStage, useThumbCapture } from './thumbStage';
import { DEVICE_MODELS, getDevice } from '../lib/devices';
import { libraryDelete, libraryGet, libraryPut } from '../lib/libraryDb';
import { projectFromTemplate, type CompositionTemplate } from '../lib/templates';
import type { MockupProject, Vec3 } from '../types';

const THUMB_W = 640;
const THUMB_H = 400;

type ThumbJob = {
  id: string;
  project: MockupProject;
  attempt: number;
  /** Bumped on invalidate so in-flight finishes cannot restore a stale cover. */
  gen: number;
};

/** Bump when bake framing / studio strip rules change so stale covers re-render. */
const THUMB_REV = 'frame15-white-studio';
const cache = new Map<string, string>();
const lastProject = new Map<string, MockupProject>();
const thumbGen = new Map<string, number>();
const listeners = new Set<() => void>();
let queue: ThumbJob[] = [];
let active: ThumbJob | null = null;
const hydrating = new Set<string>();

function diskKey(key: string) {
  return `template-thumb:${key}`;
}

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

function hasWhiteStudioSet(project: MockupProject): boolean {
  return (project.sceneProps ?? []).some((prop) => (
    prop.kind === 'studio_backdrop'
    && (!prop.color || prop.color.toLowerCase() === '#ffffff' || prop.color.toLowerCase() === '#fff')
  ));
}

/**
 * Card shots keep the authored pose / props. White-cyclorama compositions keep
 * their studio look; other sets use a dark transparent plate (no cyclorama /
 * ground / DoF — DoF blanks the tiny WebGL pass).
 */
function projectForThumb(project: MockupProject): MockupProject {
  const framed = layoutForThumb(project);
  const whiteStudio = hasWhiteStudioSet(framed);
  return {
    ...framed,
    background: whiteStudio ? 'studio' : 'transparent',
    depthOfField: false,
    depthOfFieldAmount: 0,
    showGroundBase: false,
    sceneProps: whiteStudio
      ? (framed.sceneProps ?? [])
      : (framed.sceneProps ?? []).filter((prop) => prop.kind !== 'studio_backdrop'),
  };
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

/** Drop a baked cover after Dev updates / deletes a master catalog template. */
export function invalidateTemplateThumb(id: string, nextProject?: MockupProject) {
  if (!id.trim()) return;
  const nextGen = (thumbGen.get(id) ?? 0) + 1;
  thumbGen.set(id, nextGen);
  const key = cacheId(id);
  cache.delete(key);
  hydrating.delete(key);
  void libraryDelete('meta', diskKey(key)).catch(() => undefined);
  queue = queue.filter((item) => item.id !== id);
  if (nextProject) lastProject.set(id, projectForThumb(nextProject));
  const project = lastProject.get(id);
  if (project && (viewers.get(id) ?? 0) > 0) {
    queue = [...queue, { id, project, attempt: 0, gen: nextGen }];
  }
  if (active?.id === id) {
    advanceQueue();
  } else if (!active && queue.length) {
    advanceQueue();
  }
  emit();
}

function projectModelUrls(project: MockupProject): string[] {
  const urls: string[] = [];
  for (const device of project.devices) {
    const url = getDevice(device.deviceId).url;
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function warmProject(project: MockupProject) {
  for (const url of projectModelUrls(project)) {
    useGLTF.preload(url);
  }
}

/** Failed loads stick in drei's cache; without this, every retry keeps failing. */
function clearProjectModels(project: MockupProject) {
  for (const url of projectModelUrls(project)) {
    try {
      useGLTF.clear(url);
    } catch {
      // Cache miss is fine.
    }
  }
}

function advanceQueue() {
  active = queue.shift() ?? null;
  if (active) warmProject(active.project);
}

const viewers = new Map<string, number>();

function requestThumb(id: string, project: MockupProject) {
  healPoisonedModelCache();
  lastProject.set(id, project);
  viewers.set(id, (viewers.get(id) ?? 0) + 1);
  if ((viewers.get(id) ?? 0) > 1) return;
  // Only preload the active baker. Warming every card at once aborts large GLB
  // fetches in Electron and poisons useGLTF with permanent Failed to fetch errors.
  if (cache.has(cacheId(id))) return;
  if (active?.id === id) return;
  if (queue.some((item) => item.id === id)) return;
  void hydrateCachedThumb(id, project);
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
    advanceQueue();
    emit();
  }
}

function finishThumb(id: string, url: string) {
  const job = active?.id === id ? active : null;
  const currentGen = thumbGen.get(id) ?? 0;
  const stale = Boolean(job && job.gen !== currentGen);
  if (url && !stale) {
    const key = cacheId(id);
    cache.set(key, url);
    void libraryPut('meta', diskKey(key), url).catch(() => undefined);
  } else if (job && !stale && job.attempt < 3) {
    clearProjectModels(job.project);
    queue = [...queue, { ...job, attempt: job.attempt + 1 }];
  }
  if (active?.id === id) {
    advanceQueue();
  }
  emit();
}

function enqueueBake(id: string, project: MockupProject) {
  if ((viewers.get(id) ?? 0) <= 0) return;
  if (cache.has(cacheId(id))) return;
  if (active?.id === id) return;
  if (queue.some((item) => item.id === id)) return;
  queue = [...queue, { id, project, attempt: 0, gen: thumbGen.get(id) ?? 0 }];
  if (!active) {
    advanceQueue();
    emit();
  }
}

async function hydrateCachedThumb(id: string, project: MockupProject) {
  const key = cacheId(id);
  if (cache.has(key) || hydrating.has(key)) {
    if (cache.has(key)) return;
    return;
  }
  hydrating.add(key);
  try {
    const stored = await libraryGet<string>('meta', diskKey(key));
    if (stored && stored.startsWith('data:image')) {
      cache.set(key, stored);
      emit();
      return;
    }
  } catch {
    // Disk miss / IndexedDB unavailable — fall through to bake.
  } finally {
    hydrating.delete(key);
  }
  enqueueBake(id, project);
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
        freezeFraming
        pixelRatio={[1, 1]}
        onSceneReady={markReady}
      />
    </div>,
    document.body,
  );
}

function TemplateBaker({ job }: { job: ThumbJob }) {
  const fail = useCallback(() => {
    clearProjectModels(job.project);
    finishThumb(job.id, '');
  }, [job.id, job.project]);
  return (
    <ThumbStage onError={fail}>
      <TemplateBakerBody job={job} />
    </ThumbStage>
  );
}

let healedModelCache = false;

/** Drop any Failed-to-fetch entries left from an earlier burst of preloads. */
function healPoisonedModelCache() {
  if (healedModelCache) return;
  healedModelCache = true;
  for (const device of DEVICE_MODELS) {
    if (!device.url) continue;
    try {
      useGLTF.clear(device.url);
    } catch {
      // ignore
    }
  }
}

export function TemplateThumbHost() {
  const current = useSyncExternalStore(subscribe, () => active, () => null);
  if (!current) return null;
  return <TemplateBaker key={`${current.id}:${current.gen}:${current.attempt}`} job={current} />;
}

export function ProjectThumb({ project, cacheKey }: { project: MockupProject; cacheKey: string }) {
  const framed = useMemo(() => projectForThumb(project), [project]);
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
  const project = useMemo(
    () => projectForThumb(projectFromTemplate(template)),
    [template],
  );
  const whiteStudio = hasWhiteStudioSet(project);
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
    <span className={`template-shot${whiteStudio ? ' is-white-studio' : ''}`}>
      {src ? <img src={src} alt="" /> : <TemplatePreview layout={template.preview} />}
    </span>
  );
}
