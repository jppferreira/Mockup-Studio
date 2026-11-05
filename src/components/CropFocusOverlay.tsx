import { useLayoutEffect, useRef, useState } from 'react';
import FormatSwitchBadge, { type FormatSwitchOption } from './FormatSwitchBadge';

interface Props {
  ratio: number;
  label: string;
  hint: string;
  activeId: string;
  formats: FormatSwitchOption[];
  onSelectFormat: (id: string) => void;
}

type FrameRect = { left: number; top: number; width: number; height: number };

function fitFrame(
  hostW: number,
  hostH: number,
  ratio: number,
  padX: number,
  padTop: number,
  padBottom: number,
): FrameRect {
  const maxW = Math.max(0, hostW - padX * 2);
  const maxH = Math.max(0, hostH - padTop - padBottom);
  let width = maxW;
  let height = width / Math.max(ratio, 0.001);
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return {
    left: (hostW - width) / 2,
    top: padTop + (maxH - height) / 2,
    width,
    height,
  };
}

function readPx(el: HTMLElement, name: string) {
  const value = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

export default function CropFocusOverlay({
  ratio,
  label,
  hint,
  activeId,
  formats,
  onSelectFormat,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [badge, setBadge] = useState({ left: 10, top: 10 });

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const update = () => {
      const host = el.getBoundingClientRect();
      const { width, height } = host;
      const workspace = el.closest('.workspace');
      let safeLeft = 12;
      let safeTop = 56;
      let safeRight = width - 12;
      let padTop = 56;
      let padBottom = 78;
      if (workspace instanceof HTMLElement) {
        const hidden = workspace.classList.contains('panels-hidden');
        const leftHidden = hidden || workspace.classList.contains('left-panel-hidden');
        const pad = readPx(workspace, '--workspace-pad') || 12;
        const gap = readPx(workspace, '--workspace-gap') || 12;
        const leftPanel = leftHidden ? 0 : readPx(workspace, '--left-panel-width');
        const rightPanel = hidden ? 0 : readPx(workspace, '--right-panel-width');
        safeLeft = pad + leftPanel + gap;
        safeRight = width - (pad + rightPanel + gap);
        safeTop = (readPx(workspace, '--topbar-height') || 48) + 8;
        // Keep the crop frame below the top tool row and gesture cluster.
        padTop = safeTop + 46;
        const chrome = workspace.querySelector('.workspace-bottom-chrome');
        if (chrome instanceof HTMLElement) {
          const chromeTop = chrome.getBoundingClientRect().top;
          padBottom = Math.max(16, host.bottom - chromeTop + 10);
        }
      }
      const next = fitFrame(width, height, ratio, 2, padTop, padBottom);
      setFrame(next);
      const inset = 10;
      const frameRight = next.left + next.width;
      const frameBottom = next.top + next.height;
      const visibleLeft = Math.min(Math.max(next.left, safeLeft), frameRight - inset);
      const visibleRight = Math.max(visibleLeft, Math.min(frameRight, safeRight));
      const visibleTop = Math.min(Math.max(next.top, safeTop), frameBottom - inset);
      const maxLeft = Math.max(inset, visibleRight - next.left - inset);
      const maxTop = Math.max(inset, next.height - 36);
      setBadge({
        left: Math.min(maxLeft, Math.max(inset, visibleLeft - next.left + inset)),
        top: Math.min(maxTop, Math.max(inset, visibleTop - next.top + inset)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const workspace = el.closest('.workspace');
    if (workspace) observer.observe(workspace);
    const classObserver = new MutationObserver(update);
    if (workspace) classObserver.observe(workspace, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      classObserver.disconnect();
    };
  }, [ratio]);

  const ready = frame.width > 1 && frame.height > 1;

  return (
    <div ref={hostRef} className="crop-focus-overlay">
      {ready && (
        <>
          <div className="crop-focus-dim" aria-hidden style={{ top: 0, left: 0, right: 0, height: frame.top }} />
          <div
            className="crop-focus-dim"
            style={{ top: frame.top, left: 0, width: frame.left, height: frame.height }}
          />
          <div
            className="crop-focus-dim"
            style={{
              top: frame.top,
              left: frame.left + frame.width,
              right: 0,
              height: frame.height,
            }}
          />
          <div
            className="crop-focus-dim"
            style={{ top: frame.top + frame.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="crop-focus-window"
            style={{
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
              ['--badge-left' as string]: `${badge.left}px`,
              ['--badge-top' as string]: `${badge.top}px`,
            }}
          >
            <span className="crop-focus-corner tl" aria-hidden />
            <span className="crop-focus-corner tr" aria-hidden />
            <span className="crop-focus-corner bl" aria-hidden />
            <span className="crop-focus-corner br" aria-hidden />
            <FormatSwitchBadge
              label={label}
              hint={hint}
              activeId={activeId}
              options={formats}
              onSelect={onSelectFormat}
            />
          </div>
        </>
      )}
    </div>
  );
}
