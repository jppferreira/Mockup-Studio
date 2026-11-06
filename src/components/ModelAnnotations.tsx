import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { accentPair, useAccentTheme } from '../lib/accentTheme';
import { overlayVisibleAt, type SceneOverlay } from '../lib/overlays';
import type { Vec3 } from '../types';

export type AnnotationMark = {
  kind: 'path' | 'comment';
  deviceId: string;
  points: Vec3[];
  x: number;
  y: number;
};

const INK = '#e6b325';
const LIFT = 0.012;

function overlayIdOf(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.overlayId === 'string') return current.userData.overlayId;
    current = current.parent;
  }
  return null;
}

function deviceIdOf(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.annotationAnchorId === 'string') return current.userData.annotationAnchorId;
    current = current.parent;
  }
  return null;
}

function isAnnotation(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.annotation) return true;
    current = current.parent;
  }
  return false;
}

function pointerNdc(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
}

function screenPoint(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / Math.max(1, rect.width),
    y: (event.clientY - rect.top) / Math.max(1, rect.height),
  };
}

function toLocal(anchor: THREE.Object3D, world: THREE.Vector3) {
  anchor.updateWorldMatrix(true, false);
  return anchor.worldToLocal(world.clone());
}

type SurfaceHit = {
  deviceId: string;
  anchor: THREE.Object3D;
  local: THREE.Vector3;
  overlayId: string | null;
};

function pickSurface(
  event: PointerEvent,
  camera: THREE.Camera,
  element: HTMLElement,
  registry: Map<string, THREE.Object3D>,
  raycaster: THREE.Raycaster,
  prefer: 'closest' | 'surface',
): SurfaceHit | null {
  if (!registry.size) return null;
  const roots = [...registry.values()];
  roots.forEach((root) => root.updateWorldMatrix(true, true));
  raycaster.setFromCamera(pointerNdc(event, element), camera);
  const hits = raycaster.intersectObjects(roots, true).filter((hit) => hit.object.visible);
  const mark = hits.find((hit) => isAnnotation(hit.object));
  const surface = hits.find((hit) => !isAnnotation(hit.object));
  const chosen = prefer === 'surface' ? (surface ?? mark) : hits[0];
  if (!chosen) return null;
  const deviceId = deviceIdOf(chosen.object);
  if (!deviceId) return null;
  const anchor = registry.get(deviceId);
  if (!anchor) return null;
  const world = chosen.point.clone();
  if (chosen.face) {
    const normal = chosen.face.normal.clone().transformDirection(chosen.object.matrixWorld).normalize();
    const toward = camera.position.clone().sub(chosen.point);
    if (normal.dot(toward) < 0) normal.negate();
    world.addScaledVector(normal, LIFT);
  } else {
    world.addScaledVector(camera.position.clone().sub(world).normalize(), LIFT);
  }
  return {
    deviceId,
    anchor,
    local: toLocal(anchor, world),
    overlayId: overlayIdOf(chosen.object),
  };
}

function planePoint(
  event: PointerEvent,
  camera: THREE.Camera,
  element: HTMLElement,
  anchor: THREE.Object3D,
  raycaster: THREE.Raycaster,
  target: THREE.Vector3,
) {
  raycaster.setFromCamera(pointerNdc(event, element), camera);
  const origin = new THREE.Vector3();
  anchor.getWorldPosition(origin);
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  if (!raycaster.ray.intersectPlane(plane, target)) return null;
  return toLocal(anchor, target);
}

function pinTexture(index: number, text: string, selected: boolean, accent: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(ctx, 10, 36, 492, 124, 28);
  ctx.fillStyle = selected ? '#fff4d2' : '#f4e7c3';
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(64, 98, 24, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2418';
  ctx.fill();
  ctx.fillStyle = '#f4e7c3';
  ctx.font = '700 28px "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index), 64, 100);
  ctx.fillStyle = '#2a2418';
  ctx.textAlign = 'left';
  ctx.font = '600 30px "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  const body = (text || 'Comment').replace(/\s+/g, ' ').trim() || 'Comment';
  const lines = wrapLines(ctx, body, 360, 2);
  const lineHeight = 36;
  const startY = 98 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, indexLine) => {
    ctx.fillText(line, 104, startY + indexLine * lineHeight);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines && kept.length) {
    const last = kept[kept.length - 1];
    kept[kept.length - 1] = last.length > 18 ? `${last.slice(0, 18)}…` : `${last}…`;
  }
  return kept.length ? kept : ['Comment'];
}

function AnchoredStroke({
  overlay,
  selected,
  onSelect,
}: {
  overlay: SceneOverlay;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const points = overlay.anchor?.points ?? [];
  const tuples = points.map((point) => [point.x, point.y, point.z] as [number, number, number]);

  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    node.userData.overlayId = overlay.id;
    node.userData.annotation = true;
    node.traverse((child) => {
      child.userData.overlayId = overlay.id;
      child.userData.annotation = true;
    });
  });

  if (tuples.length < 2) return null;
  return (
    <group ref={group}>
      <Line
        points={tuples}
        color={selected ? '#ffe7a3' : (overlay.color || INK)}
        lineWidth={selected ? 4 : 3}
        transparent={overlay.opacity < 0.999}
        opacity={overlay.opacity}
        depthTest
      />
    </group>
  );
}

function CommentPin({
  overlay,
  index,
  selected,
  span,
  onSelect,
}: {
  overlay: SceneOverlay;
  index: number;
  selected: boolean;
  span: number;
  onSelect?: (id: string) => void;
}) {
  const sprite = useRef<THREE.Sprite>(null);
  const point = overlay.anchor?.points[0];
  const [accentTheme, , accentColor] = useAccentTheme();
  const accent = accentPair(accentTheme, accentColor).accent;
  const texture = useMemo(
    () => (point ? pinTexture(index, overlay.text ?? 'Comment', selected, accent) : null),
    [index, overlay.text, selected, point, accent],
  );

  useEffect(() => () => texture?.dispose(), [texture]);

  useLayoutEffect(() => {
    const node = sprite.current;
    if (!node) return;
    node.userData.overlayId = overlay.id;
    node.userData.annotation = true;
  });

  if (!point || !texture) return null;
  const width = Math.max(0.28, span * 0.34);
  return (
    <sprite
      ref={sprite}
      position={[point.x, point.y, point.z]}
      scale={[width, width * 0.375, 1]}
      renderOrder={8}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(overlay.id);
      }}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthTest
        toneMapped={false}
        opacity={overlay.opacity}
      />
    </sprite>
  );
}

export function ModelAnnotationLayer({
  deviceId,
  overlays,
  time,
  selectedId,
  onSelect,
}: {
  deviceId: string;
  overlays: SceneOverlay[] | undefined;
  time: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const host = useRef<THREE.Group>(null);
  const [span, setSpan] = useState(2.2);
  const comments = (overlays ?? []).filter((overlay) => overlay.kind === 'comment');
  const marks = (overlays ?? []).filter((overlay) => (
    overlay.anchor?.deviceId === deviceId
    && overlay.anchor.points.length > 0
    && (overlay.kind === 'path' || overlay.kind === 'comment')
    && overlayVisibleAt(overlay, time)
  ));

  useLayoutEffect(() => {
    if (!marks.length) return undefined;
    let frames = 0;
    let raf = 0;
    const measure = () => {
      const parent = host.current?.parent;
      frames += 1;
      if (!parent) {
        if (frames < 24) raf = requestAnimationFrame(measure);
        return;
      }
      const box = new THREE.Box3();
      parent.children.forEach((child) => {
        if (child === host.current || child.userData.annotation) return;
        box.expandByObject(child);
      });
      if (box.isEmpty()) {
        if (frames < 24) raf = requestAnimationFrame(measure);
        return;
      }
      const size = box.getSize(new THREE.Vector3());
      const next = Math.max(size.x, size.y, 0.4);
      setSpan((current) => (Math.abs(current - next) < 0.05 ? current : next));
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [deviceId, marks.length]);

  if (!marks.length) return null;
  return (
    <group ref={host}>
      {marks.map((overlay) => (
        overlay.kind === 'comment' ? (
          <CommentPin
            key={overlay.id}
            overlay={overlay}
            index={Math.max(1, comments.findIndex((item) => item.id === overlay.id) + 1)}
            selected={selectedId === overlay.id}
            span={span}
            onSelect={onSelect}
          />
        ) : (
          <AnchoredStroke
            key={overlay.id}
            overlay={overlay}
            selected={selectedId === overlay.id}
            onSelect={onSelect}
          />
        )
      ))}
    </group>
  );
}

export function AnnotationDrawController({
  mode,
  registry,
  onCommit,
  onSelect,
}: {
  mode: 'pen' | 'comment' | null;
  registry: MutableRefObject<Map<string, THREE.Object3D>>;
  onCommit?: (mark: AnnotationMark) => void;
  onSelect?: (id: string) => void;
}) {
  const { camera, gl, controls } = useThree();
  const modeRef = useRef(mode);
  const onCommitRef = useRef(onCommit);
  const onSelectRef = useRef(onSelect);
  const controlsRef = useRef(controls);
  modeRef.current = mode;
  onCommitRef.current = onCommit;
  onSelectRef.current = onSelect;
  controlsRef.current = controls;

  useEffect(() => {
    const element = gl.domElement;
    if (!mode) {
      element.style.cursor = '';
      return undefined;
    }
    const previousCursor = element.style.cursor;
    element.style.cursor = mode === 'pen' ? 'crosshair' : 'copy';
    const raycaster = new THREE.Raycaster();
    const scratch = new THREE.Vector3();
    let drawing = false;
    let lockedAnchor: THREE.Object3D | null = null;
    let lockedId = '';
    let locals: THREE.Vector3[] = [];
    let screens: { x: number; y: number }[] = [];
    let draft: THREE.Line | null = null;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let orbitWasEnabled = true;

    const clearDraft = () => {
      if (!draft) return;
      draft.removeFromParent();
      draft.geometry.dispose();
      (draft.material as THREE.Material).dispose();
      draft = null;
    };

    const restoreOrbit = () => {
      const orbit = controlsRef.current as { enabled?: boolean } | null;
      if (orbit) orbit.enabled = orbitWasEnabled;
    };

    const finish = (event: PointerEvent) => {
      if (!drawing) return;
      drawing = false;
      clearDraft();
      restoreOrbit();
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (modeRef.current === 'comment') return;
      if (!lockedId) return;
      if (locals.length === 1) {
        locals.push(locals[0].clone().add(new THREE.Vector3(0.02, 0.01, 0)));
      }
      if (locals.length < 2) return;
      const cx = screens.reduce((sum, point) => sum + point.x, 0) / screens.length;
      const cy = screens.reduce((sum, point) => sum + point.y, 0) / screens.length;
      onCommitRef.current?.({
        kind: 'path',
        deviceId: lockedId,
        points: locals.map((point) => ({ x: point.x, y: point.y, z: point.z })),
        x: cx,
        y: cy,
      });
      locals = [];
      screens = [];
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !modeRef.current) return;
      const hit = pickSurface(
        event,
        camera,
        element,
        registry.current,
        raycaster,
        modeRef.current === 'pen' ? 'surface' : 'closest',
      );
      if (!hit) return;
      event.stopImmediatePropagation();
      element.setPointerCapture(event.pointerId);
      const orbit = controlsRef.current as { enabled?: boolean } | null;
      orbitWasEnabled = orbit?.enabled !== false;
      if (orbit) orbit.enabled = false;
      drawing = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      lockedAnchor = hit.anchor;
      lockedId = hit.deviceId;
      locals = [hit.local.clone()];
      screens = [screenPoint(event, element)];
      if (modeRef.current === 'pen') {
        const geometry = new THREE.BufferGeometry().setFromPoints(locals);
        const material = new THREE.LineBasicMaterial({ color: INK, toneMapped: false, depthTest: true });
        draft = new THREE.Line(geometry, material);
        draft.frustumCulled = false;
        draft.userData.annotation = true;
        draft.renderOrder = 5;
        hit.anchor.add(draft);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!drawing || modeRef.current !== 'pen' || !lockedAnchor) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 3) moved = true;
      const hit = pickSurface(event, camera, element, registry.current, raycaster, 'surface');
      const local = hit && hit.deviceId === lockedId
        ? hit.local
        : planePoint(event, camera, element, lockedAnchor, raycaster, scratch);
      if (!local) return;
      const last = locals[locals.length - 1];
      if (last && last.distanceTo(local) < 0.012) return;
      locals.push(local.clone());
      screens.push(screenPoint(event, element));
      if (locals.length > 360) {
        locals.splice(1, locals.length - 360);
        screens.splice(1, screens.length - 360);
      }
      if (!draft) return;
      draft.geometry.dispose();
      draft.geometry = new THREE.BufferGeometry().setFromPoints(locals);
    };

    const onUp = (event: PointerEvent) => {
      if (!drawing) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
      if (modeRef.current === 'comment') {
        const hit = pickSurface(event, camera, element, registry.current, raycaster, 'closest');
        drawing = false;
        clearDraft();
        restoreOrbit();
        try {
          element.releasePointerCapture(event.pointerId);
        } catch {
          /* already released */
        }
        if (moved) return;
        if (hit?.overlayId) {
          onSelectRef.current?.(hit.overlayId);
          return;
        }
        if (!hit) return;
        const screen = screenPoint(event, element);
        onCommitRef.current?.({
          kind: 'comment',
          deviceId: hit.deviceId,
          points: [{ x: hit.local.x, y: hit.local.y, z: hit.local.z }],
          x: Math.min(1, Math.max(0, screen.x)),
          y: Math.min(1, Math.max(0, screen.y)),
        });
        return;
      }
      finish(event);
    };

    element.addEventListener('pointerdown', onDown, true);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', finish);
    return () => {
      clearDraft();
      restoreOrbit();
      element.style.cursor = previousCursor;
      element.removeEventListener('pointerdown', onDown, true);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', finish);
    };
  }, [camera, gl, mode, registry]);

  return null;
}
