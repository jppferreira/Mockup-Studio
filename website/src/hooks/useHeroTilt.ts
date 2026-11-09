import { useEffect, useRef } from 'react';

const REST_X = 8;
const REST_Y = -18;
const MAX_X = 12;
const MAX_Y = 22;

/**
 * Subtle perspective tilt for the hero screenshot.
 * The card rests at a slight angle and leans toward the pointer.
 */
export function useHeroTilt() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    const glare = glareRef.current;
    if (!stage || !card) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;

    let rx = REST_X;
    let ry = REST_Y;
    let tx = REST_X;
    let ty = REST_Y;
    let frame = 0;

    const paint = () => {
      card.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };

    const step = () => {
      frame = 0;
      rx += (tx - rx) * 0.16;
      ry += (ty - ry) * 0.16;
      paint();
      if (Math.hypot(tx - rx, ty - ry) > 0.05) frame = requestAnimationFrame(step);
    };

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      const bounds = stage.getBoundingClientRect();
      const visibleBottom = Math.min(bounds.bottom, window.innerHeight);
      const over =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= visibleBottom - 8;

      if (!over) {
        tx = REST_X;
        ty = REST_Y;
        if (glare) glare.style.opacity = '0';
        kick();
        return;
      }

      const px = (event.clientX - bounds.left) / bounds.width - 0.5;
      const py = (event.clientY - bounds.top) / bounds.height - 0.5;
      ty = Math.max(-MAX_Y, Math.min(MAX_Y, px * -MAX_Y * 2));
      tx = Math.max(-MAX_X, Math.min(MAX_X, REST_X + py * -MAX_X * 1.6));
      if (glare) {
        glare.style.opacity = '1';
        glare.style.background = `radial-gradient(480px circle at ${(px + 0.5) * 100}% ${(py + 0.5) * 100}%, rgba(255,255,255,0.34), rgba(255,255,255,0.05) 34%, transparent 58%)`;
      }
      kick();
    };

    paint();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      card.style.transform = '';
    };
  }, []);

  return { stageRef, cardRef, glareRef };
}
