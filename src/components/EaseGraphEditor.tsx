import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EaseBezier } from '../types';
import { DEFAULT_CUSTOM_BEZIER } from '../types';
import { normalizeBezier } from '../lib/animation';

interface Props {
  value: EaseBezier;
  onChange: (bezier: EaseBezier) => void;
  disabled?: boolean;
}

/** SVG canvas size */
const SIZE = 168;
/** Padding so overshoot handles stay inside the viewBox */
const PAD_X = 18;
const PAD_Y = 22;
const GRAPH_W = SIZE - PAD_X * 2;
/** Visible Y range includes overshoot room (CSS cubic-bezier editors typically show ~-0.5..1.5) */
const Y_MIN = -0.5;
const Y_MAX = 1.5;
const GRAPH_H = SIZE - PAD_Y * 2;

type Handle = 'p1' | 'p2';

function cubic1D(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function toSvg(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: PAD_X + x * GRAPH_W,
    cy: PAD_Y + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * GRAPH_H,
  };
}

function clientToNorm(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0.5, y: 0.5 };
  const local = pt.matrixTransform(ctm.inverse());
  const x = (local.x - PAD_X) / GRAPH_W;
  const y = Y_MAX - ((local.y - PAD_Y) / GRAPH_H) * (Y_MAX - Y_MIN);
  return { x, y };
}

/** Draw the parametric cubic-bezier curve (P0=0,0 → P3=1,1). */
function curvePath(bezier: EaseBezier): string {
  const [x1, y1, x2, y2] = bezier;
  const steps = 36;
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = cubic1D(t, x1, x2);
    const y = cubic1D(t, y1, y2);
    const { cx, cy } = toSvg(x, y);
    d += i === 0 ? `M ${cx} ${cy}` : ` L ${cx} ${cy}`;
  }
  return d;
}

export default function EaseGraphEditor({ value, onChange, disabled }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Handle | null>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const bezier = normalizeBezier(value ?? DEFAULT_CUSTOM_BEZIER);
  const bezierRef = useRef(bezier);
  bezierRef.current = bezier;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [x1, y1, x2, y2] = bezier;
  const p0 = toSvg(0, 0);
  const p3 = toSvg(1, 1);
  const p1 = toSvg(x1, y1);
  const p2 = toSvg(x2, y2);
  const zeroLine = toSvg(0, 0);
  const oneLine = toSvg(0, 1);

  const updateHandle = (handle: Handle, clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el || disabled) return;
    const { x, y } = clientToNorm(el, clientX, clientY);
    const next: EaseBezier = [...bezierRef.current];
    if (handle === 'p1') {
      next[0] = Math.min(1, Math.max(0, x));
      next[1] = Math.min(2, Math.max(-1, y));
    } else {
      next[2] = Math.min(1, Math.max(0, x));
      next[3] = Math.min(2, Math.max(-1, y));
    }
    onChangeRef.current(normalizeBezier(next));
  };

  const onPointerDown = (handle: Handle) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = handle;
    setDrag(handle);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateHandle(handle, event.clientX, event.clientY);
  };

  // Window-level listeners so drag keeps working even if the pointer leaves the handle
  // (pointer capture on the circle alone was unreliable across re-renders).
  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      event.preventDefault();
      updateHandle(dragRef.current, event.clientX, event.clientY);
    };
    const onUp = () => {
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCoord = (index: 0 | 1 | 2 | 3, raw: number) => {
    if (disabled) return;
    const next: EaseBezier = [...bezier];
    next[index] = raw;
    onChange(normalizeBezier(next));
  };

  return (
    <div className={`ease-graph ${disabled ? 'is-disabled' : ''} ${drag ? 'is-dragging' : ''}`}>
      <svg
        ref={svgRef}
        className="ease-graph-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label="Custom ease curve"
      >
        <rect
          x={PAD_X}
          y={PAD_Y}
          width={GRAPH_W}
          height={GRAPH_H}
          className="ease-graph-frame"
          rx={3}
        />
        {/* 0 and 1 progress guides */}
        <line
          x1={PAD_X}
          y1={zeroLine.cy}
          x2={PAD_X + GRAPH_W}
          y2={zeroLine.cy}
          className="ease-graph-guide"
        />
        <line
          x1={PAD_X}
          y1={oneLine.cy}
          x2={PAD_X + GRAPH_W}
          y2={oneLine.cy}
          className="ease-graph-guide"
        />
        {/* linear reference */}
        <line
          x1={p0.cx}
          y1={p0.cy}
          x2={p3.cx}
          y2={p3.cy}
          className="ease-graph-diag"
        />
        {/* control arms */}
        <line x1={p0.cx} y1={p0.cy} x2={p1.cx} y2={p1.cy} className="ease-graph-arm" />
        <line x1={p3.cx} y1={p3.cy} x2={p2.cx} y2={p2.cy} className="ease-graph-arm" />
        <path d={curvePath(bezier)} className="ease-graph-curve" fill="none" />
        <circle cx={p0.cx} cy={p0.cy} r={3.5} className="ease-graph-anchor" />
        <circle cx={p3.cx} cy={p3.cy} r={3.5} className="ease-graph-anchor" />
        <circle
          cx={p1.cx}
          cy={p1.cy}
          r={6}
          className={`ease-graph-handle ${drag === 'p1' ? 'is-active' : ''}`}
          onPointerDown={onPointerDown('p1')}
        />
        <circle
          cx={p2.cx}
          cy={p2.cy}
          r={6}
          className={`ease-graph-handle ${drag === 'p2' ? 'is-active' : ''}`}
          onPointerDown={onPointerDown('p2')}
        />
      </svg>
      <div className="ease-graph-nums" aria-label="Bezier coordinates">
        <label>
          <span>x1</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            disabled={disabled}
            value={Number(x1.toFixed(2))}
            onChange={(e) => setCoord(0, Number(e.target.value))}
          />
        </label>
        <label>
          <span>y1</span>
          <input
            type="number"
            step={0.01}
            min={-1}
            max={2}
            disabled={disabled}
            value={Number(y1.toFixed(2))}
            onChange={(e) => setCoord(1, Number(e.target.value))}
          />
        </label>
        <label>
          <span>x2</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            disabled={disabled}
            value={Number(x2.toFixed(2))}
            onChange={(e) => setCoord(2, Number(e.target.value))}
          />
        </label>
        <label>
          <span>y2</span>
          <input
            type="number"
            step={0.01}
            min={-1}
            max={2}
            disabled={disabled}
            value={Number(y2.toFixed(2))}
            onChange={(e) => setCoord(3, Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
