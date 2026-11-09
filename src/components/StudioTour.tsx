import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { markStudioTourComplete } from '../lib/studioTour';

export type StudioTourStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the highlighted region */
  target: string;
  /** Preferred tooltip placement relative to the target */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional setup before measuring (switch tabs, open panels, etc.) */
  prepare?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const TIP_GAP = 14;
const TIP_MAX_W = 320;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  };
}

function tipStyle(rect: Rect, placement: NonNullable<StudioTourStep['placement']>) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tipW = Math.min(TIP_MAX_W, vw - 24);

  if (placement === 'right') {
    return {
      top: clamp(rect.top + rect.height / 2, 24, vh - 24),
      left: clamp(rect.left + rect.width + TIP_GAP, 12, vw - tipW - 12),
      transform: 'translateY(-50%)',
      width: tipW,
    } as const;
  }
  if (placement === 'left') {
    return {
      top: clamp(rect.top + rect.height / 2, 24, vh - 24),
      left: clamp(rect.left - TIP_GAP - tipW, 12, vw - tipW - 12),
      transform: 'translateY(-50%)',
      width: tipW,
    } as const;
  }
  if (placement === 'top') {
    return {
      top: clamp(rect.top - TIP_GAP, 12, vh - 12),
      left: clamp(rect.left + rect.width / 2, tipW / 2 + 12, vw - tipW / 2 - 12),
      transform: 'translate(-50%, -100%)',
      width: tipW,
    } as const;
  }
  return {
    top: clamp(rect.top + rect.height + TIP_GAP, 12, vh - 12),
    left: clamp(rect.left + rect.width / 2, tipW / 2 + 12, vw - tipW / 2 - 12),
    transform: 'translate(-50%, 0)',
    width: tipW,
  } as const;
}

export default function StudioTour({
  steps,
  open,
  onComplete,
}: {
  steps: StudioTourStep[];
  open: boolean;
  onComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];
  const last = index >= steps.length - 1;
  const placement = step?.placement ?? 'bottom';

  const finish = useCallback(() => {
    markStudioTourComplete();
    onComplete();
  }, [onComplete]);

  const refresh = useCallback(() => {
    if (!step) return;
    setRect(measure(step.target));
  }, [step]);

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setRect(null);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    step.prepare?.();
    let cancelled = false;
    let tries = 0;
    const target = step.target;

    const tick = () => {
      if (cancelled) return;
      const next = measure(target);
      if (next) {
        setRect(next);
        return;
      }
      tries += 1;
      if (tries < 20) {
        window.setTimeout(tick, 40);
      } else {
        setRect(null);
      }
    };

    // Let tab/panel switches paint before measuring.
    requestAnimationFrame(() => requestAnimationFrame(tick));
    return () => {
      cancelled = true;
    };
    // Intentionally keyed by step identity fields — not the whole step object.
  }, [open, step?.id, step?.target, step?.prepare]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => refresh();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        if (last) finish();
        else setIndex((value) => Math.min(steps.length - 1, value + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, last, open, steps.length]);

  if (!open || !step) return null;

  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const tip = hole ? tipStyle(hole, placement) : {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: Math.min(TIP_MAX_W, window.innerWidth - 24),
  };

  return createPortal(
    <div className="studio-tour" role="dialog" aria-modal="true" aria-labelledby="studio-tour-title">
      <div
        className={`studio-tour-scrim${hole ? ' is-cutout' : ''}`}
        onClick={finish}
      />
      {hole && (
        <div
          className="studio-tour-hole"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          aria-hidden
        />
      )}
      <div className="studio-tour-card" style={tip} key={step.id}>
        <div className="studio-tour-meta">
          <span>{index + 1} / {steps.length}</span>
          <button type="button" className="studio-tour-skip" onClick={finish}>
            Skip
          </button>
        </div>
        <h2 id="studio-tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="studio-tour-actions">
          <button
            type="button"
            className="studio-tour-back"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            Back
          </button>
          <button
            type="button"
            className="studio-tour-next"
            onClick={() => {
              if (last) finish();
              else setIndex((value) => Math.min(steps.length - 1, value + 1));
            }}
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
