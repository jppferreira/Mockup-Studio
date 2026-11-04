import { useEffect, useRef, useState, type CSSProperties } from 'react';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/** Smooth multi-layer parallax driven by scroll + pointer. */
export function useParallax() {
  const reduced = usePrefersReducedMotion();
  const [scrollY, setScrollY] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const raf = useRef(0);
  const pending = useRef({ y: 0, px: 0, py: 0 });

  useEffect(() => {
    if (reduced) return;

    const flush = () => {
      raf.current = 0;
      setScrollY(pending.current.y);
      setPointer({ x: pending.current.px, y: pending.current.py });
    };

    const schedule = () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(flush);
    };

    const onScroll = () => {
      pending.current.y = window.scrollY;
      schedule();
    };

    const onPointer = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      pending.current.px = nx;
      pending.current.py = ny;
      schedule();
    };

    pending.current.y = window.scrollY;
    flush();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [reduced]);

  const y = reduced ? 0 : scrollY;
  const px = reduced ? 0 : pointer.x;
  const py = reduced ? 0 : pointer.y;

  return {
    reduced,
    /** @param clampY Cap scroll contribution so deep-page sections don't keep drifting. */
    layer: (speed: number, tilt = 0, clampY?: number) => {
      const sy = clampY != null ? Math.min(y, clampY) : y;
      return {
        transform: `translate3d(${px * tilt}px, ${sy * speed + py * tilt * 0.35}px, 0)`,
      } satisfies CSSProperties;
    },
    device: (speed: number, base: string, sway = 8) =>
      ({
        transform: `${base} translate3d(${px * sway}px, ${y * speed + py * sway * 0.4}px, 0)`,
      }) satisfies CSSProperties,
    fade: (start: number, end: number) => {
      if (reduced) return { opacity: 1 };
      const t = Math.min(1, Math.max(0, (y - start) / (end - start)));
      return {
        opacity: 1 - t,
        transform: `translate3d(0, ${t * -36}px, 0)`,
      } satisfies CSSProperties;
    },
  };
}
