import { useEffect, useRef } from 'react';
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
 */
export function useScreenEmissiveMap({
  material,
  originalEmissiveMap,
  screenshot,
  width,
  height,
  inset,
  applyUv,
  playing,
}: {
  material: THREE.MeshStandardMaterial | null;
  originalEmissiveMap?: THREE.Texture | null;
  screenshot: string | null;
  width: number;
  height: number;
  inset?: ScreenInset;
  applyUv?: ScreenUvApply;
  /** When true, keep video playing in sync with wall-clock (preview). */
  playing?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!material) return undefined;
    let cancelled = false;
    const kind = screenMediaKind(screenshot);

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
      material.emissiveMap = tex;
      material.needsUpdate = true;
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
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
    };

    if (kind === 'none' || !screenshot) {
      stopLoop();
      disposeVideo();
      material.emissiveMap = originalEmissiveMap ?? null;
      material.needsUpdate = true;
      return () => {
        cancelled = true;
        stopLoop();
        disposeVideo();
        texRef.current?.dispose();
        texRef.current = null;
      };
    }

    if (kind === 'image') {
      stopLoop();
      disposeVideo();
      const image = new Image();
      image.onload = () => paintFromSource(image, image.width, image.height);
      image.src = screenshot;
      return () => {
        cancelled = true;
        stopLoop();
        disposeVideo();
        texRef.current?.dispose();
        texRef.current = null;
      };
    }

    // Video
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    videoRef.current = video;

    const tick = () => {
      if (cancelled || !videoRef.current) return;
      const v = videoRef.current;
      if (v.readyState >= 2) {
        paintFromSource(v, v.videoWidth || width, v.videoHeight || height);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const onReady = () => {
      if (cancelled) return;
      paintFromSource(video, video.videoWidth || width, video.videoHeight || height);
      if (playing) {
        void video.play().catch(() => { /* autoplay */ });
      } else {
        video.pause();
      }
      stopLoop();
      rafRef.current = requestAnimationFrame(tick);
    };

    video.addEventListener('loadeddata', onReady);
    video.src = screenshot;
    void video.load();

    const unregister = registerScreenSeeker(async (time) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      await waitForVideoSeek(v, time);
      paintFromSource(v, v.videoWidth || width, v.videoHeight || height);
    });

    return () => {
      cancelled = true;
      unregister();
      stopLoop();
      video.removeEventListener('loadeddata', onReady);
      disposeVideo();
      texRef.current?.dispose();
      texRef.current = null;
    };
  }, [material, originalEmissiveMap, screenshot, width, height, inset?.border, inset?.radius, applyUv, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || screenMediaKind(screenshot) !== 'video') return;
    if (playing) {
      void video.play().catch(() => { /* autoplay */ });
    } else {
      video.pause();
    }
  }, [playing, screenshot]);
}
