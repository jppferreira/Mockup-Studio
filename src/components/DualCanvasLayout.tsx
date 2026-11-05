import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import FormatSwitchBadge, { type FormatSwitchOption } from './FormatSwitchBadge';

type PaneSize = { width: number; height: number };

/** Size one format frame so two copies + gap fit inside the host. */
function fitPair(
  hostW: number,
  hostH: number,
  ratio: number,
  pad: number,
  gap: number,
): PaneSize {
  const maxW = Math.max(0, hostW - pad * 2);
  const maxH = Math.max(0, hostH - pad * 2);
  const safeRatio = Math.max(ratio, 0.001);
  const gapSpace = Math.max(0, gap);

  // Width-first: two panes side by side.
  let width = Math.max(0, (maxW - gapSpace) / 2);
  let height = width / safeRatio;
  if (height > maxH) {
    height = maxH;
    width = height * safeRatio;
  }
  // Guard if height-clamp made a single pane wider than half again (shouldn't).
  if (width * 2 + gapSpace > maxW + 0.5) {
    width = Math.max(0, (maxW - gapSpace) / 2);
    height = width / safeRatio;
  }
  return { width, height };
}

interface PaneSlot {
  active: boolean;
  onActivate: () => void;
  platformLabel: string;
  editing: boolean;
  children: ReactNode;
}

interface Props {
  /** Width/height. Null = free fill (equal split, no format letterbox). */
  ratio: number | null;
  label?: string;
  hint?: string;
  activeFormatId?: string;
  formats?: FormatSwitchOption[];
  onSelectFormat?: (id: string) => void;
  pad?: number;
  gap?: number;
  ios: PaneSlot;
  android: PaneSlot;
}

/**
 * Dual iOS/Android stage. With a format ratio, both panes share one scale so the
 * pair always fits side-by-side without clipping. Free mode fills 50/50.
 */
export default function DualCanvasLayout({
  ratio,
  label,
  hint,
  activeFormatId,
  formats = [],
  onSelectFormat,
  pad = 18,
  gap = 14,
  ios,
  android,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [paneSize, setPaneSize] = useState<PaneSize | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || ratio == null) {
      setPaneSize(null);
      return;
    }
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setPaneSize(fitPair(width, height, ratio, pad, gap));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ratio, pad, gap]);

  const framed = ratio != null && paneSize != null && paneSize.width > 1 && paneSize.height > 1;
  const pairStyle: CSSProperties | undefined = framed
    ? {
        ['--dual-gap' as string]: `${gap}px`,
        ['--pane-width' as string]: `${paneSize.width}px`,
        ['--pane-height' as string]: `${paneSize.height}px`,
      }
    : { ['--dual-gap' as string]: `${gap}px` };

  const renderPane = (slot: PaneSlot) => (
    <div
      className={`dual-canvas-pane ${slot.active ? 'is-active-env' : ''} ${framed ? 'is-format-sized' : ''}`}
      onPointerDownCapture={slot.onActivate}
    >
      <div className="dual-canvas-label">
        {slot.platformLabel}{slot.editing ? ' · editing' : ''}
      </div>
      <div className={`dual-canvas-viewport ${framed ? 'is-framed' : ''}`}>
        {slot.children}
      </div>
      {framed && (
        <div className="format-sized-chrome">
          <span className="crop-focus-corner tl" aria-hidden />
          <span className="crop-focus-corner tr" aria-hidden />
          <span className="crop-focus-corner bl" aria-hidden />
          <span className="crop-focus-corner br" aria-hidden />
          {label && hint && activeFormatId && onSelectFormat && formats.length > 0 && (
            <FormatSwitchBadge
              label={label}
              hint={hint}
              activeId={activeFormatId}
              options={formats}
              onSelect={onSelectFormat}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={hostRef}
      className={`dual-canvas-grid ${framed ? 'is-format-pair' : 'is-free-split'}`}
      style={pairStyle}
      role="group"
      aria-label="iOS and Android canvases"
    >
      {framed ? (
        <div className="dual-canvas-pair">
          {renderPane(ios)}
          {renderPane(android)}
        </div>
      ) : (
        <>
          {renderPane(ios)}
          {renderPane(android)}
        </>
      )}
    </div>
  );
}
