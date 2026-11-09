import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { coverDraw, registerScreenSeeker, screenMediaKind, waitForVideoSeek } from './screenMedia';

export type ScreenInset = {
  border?: number;
  radius?: number;
};

export type ScreenUvApply = (tex: THREE.Texture, original?: THREE.Texture | null) => void;

/**
 * Paints image or video screen media onto a material's emissiveMap.
 * Registers a seeker so video export can sync frames to the timeline.
 * Optional liveStream (USB iPhone mirror) takes priority over screenshot.
 */
export function useScreenEmissiveMap({
  material,
  originalEmissiveMap,
  screenshot,
  liveStream,
  width,
  height,
  inset,
  applyUv,
  playing,
}: {
  material: THREE.MeshStandardMaterial | null;
  originalEmissiveMap?: THREE.Texture | null;
  screenshot: string | null;
  /** Live USB / camera capture stream painted onto the screen */
  liveStream?: MediaStream | null;
  width: number;
  height: number;
  inset?: ScreenInset;
  applyUv?: ScreenUvApply;
  /** When true, keep video playing in sync with wall-clock (preview). */
  playing?: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const rafRef = useRef<number | null>(null);
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    if (!material) return undefined;
    let cancelled = false;
    const kind = liveStream ? 'live' as const : screenMediaKind(screenshot);

    const ensureCanvas = () => {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };

    const paintFromSource = (source: CanvasImageSource | null, srcW: number, srcH: number) => {
      if (cancelled || !material) return;
      const canvas = ensureCanvas();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const border = inset?.border ?? 0;
      const radius = inset?.radius ?? 0;

      if (border) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        ctx.beginPath();
        if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: Function }).roundRect === 'function') {
          (ctx as CanvasRenderingContext2D & { roundRect: Function }).roundRect(
            border, border, width - 2 * border, height - 2 * border, radius,
          );
        } else {
          ctx.rect(border, border, width - 2 * border, height - 2 * border);
        }
        ctx.clip();
      } else {
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, width, height);
      }

      if (source && srcW > 0 && srcH > 0) {
        coverDraw(ctx, source, srcW, srcH, border, border, width - 2 * border, height - 2 * border);
      }
      if (border) ctx.restore();

      if (!texRef.current) {
        texRef.current = new THREE.CanvasTexture(canvas);
        texRef.current.colorSpace = THREE.SRGBColorSpace;
        texRef.current.anisotropy = 8;
      }
      const tex = texRef.current;
      applyUv?.(tex, originalEmissiveMap ?? null);
      tex.needsUpdate = true;
      // White emissive so the painted plate reads; stay black until this paint.
      if (material.emissive) material.emissive.set(0xffffff);
      material.emissiveIntensity = 1;
      material.emissiveMap = tex;
      material.needsUpdate = true;
      // Demand frameloop: push a redraw after the texture changes.
      invalidateRef.current();
    };

    const stopLoop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const disposeVideo = () => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
    };

    // Keep the canvas texture across dep-only restarts. Disposing it while the
    // material still showed it flashed white over the size-guide placeholder.
    const releaseBinding = () => {
      cancelled = true;
      stopLoop();
      disposeVideo();
    };

    if (kind === 'none' || (!screenshot && !liveStream)) {
      stopLoop();
      disposeVideo();
      // Keep the display black. originalEmissiveMap is only a UV reference —
      // assigning a packed albedo atlas here showed random logos on the screen.
      material.emissiveMap = null;
      if (material.emissive) material.emissive.set(0x000000);
      material.needsUpdate = true;
      invalidateRef.current();
      return releaseBinding;
    }

    if (kind === 'image' && screenshot) {
      stopLoop();
      disposeVideo();
      const image = new Image();
      image.onload = () => paintFromSource(image, image.width, image.height);
      image.src = screenshot;
      // Cached data-URL placeholders often complete synchronously — paint now
      // so we never show a blank white frame between effect runs.
      if (image.complete && image.naturalWidth > 0) {
        paintFromSource(image, image.width, image.height);
      }
      return releaseBinding;
    }

    // Live USB mirror or embedded video
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = kind !== 'live';
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    videoRef.current = video;
    const shouldLoop = kind === 'live' || Boolean(playing);

    const tick = () => {
      if (cancelled || !videoRef.current) return;
      const v = videoRef.current;
      if (v.readyState >= 2) {
        paintFromSource(v, v.videoWidth || width, v.videoHeight || height);
      }
      // Only keep the paint loop while the screen is actually advancing.
      if (shouldLoop) rafRef.current = requestAnimationFrame(tick);
    };

    const onReady = () => {
      if (cancelled) return;
      paintFromSource(video, video.videoWidth || width, video.videoHeight || height);
      if (shouldLoop) {
        void video.play().catch(() => { /* autoplay */ });
      } else {
        video.pause();
      }
      stopLoop();
      if (shouldLoop) rafRef.current = requestAnimationFrame(tick);
    };

    video.addEventListener('loadeddata', onReady);

    let unregister: (() => void) | undefined;
    if (kind === 'live' && liveStream) {
      video.srcObject = liveStream;
      void video.play().catch(() => { /* autoplay */ });
    } else if (screenshot) {
      video.src = screenshot;
      void video.load();
      unregister = registerScreenSeeker(async (time) => {
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        await waitForVideoSeek(v, time);
        paintFromSource(v, v.videoWidth || width, v.videoHeight || height);
      });
    }

    return () => {
      unregister?.();
      video.removeEventListener('loadeddata', onReady);
      releaseBinding();
    };
  }, [material, originalEmissiveMap, screenshot, liveStream, width, height, inset?.border, inset?.radius, applyUv, playing]);

  // Dispose the canvas texture only when the material binding itself goes away.
  useEffect(() => () => {
    texRef.current?.dispose();
    texRef.current = null;
    canvasRef.current = null;
  }, [material]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || liveStream || screenMediaKind(screenshot) !== 'video') return;
    if (playing) {
      void video.play().catch(() => { /* autoplay */ });
    } else {
      video.pause();
    }
  }, [playing, screenshot, liveStream]);
}
