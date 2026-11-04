import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  ratio: number;
  label: string;
  hint: string;
}

type FrameRect = { left: number; top: number; width: number; height: number };

function fitFrame(hostW: number, hostH: number, ratio: number, pad: number): FrameRect {
  const maxW = Math.max(0, hostW - pad * 2);
  const maxH = Math.max(0, hostH - pad * 2);
  let width = maxW;
  let height = width / Math.max(ratio, 0.001);
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return {
    left: (hostW - width) / 2,
    top: (hostH - height) / 2,
    width,
    height,
  };
}

export default function CropFocusOverlay({ ratio, label, hint }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameRect>({ left: 0, top: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setFrame(fitFrame(width, height, ratio, 28));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ratio]);

  const ready = frame.width > 1 && frame.height > 1;

  return (
    <div ref={hostRef} className="crop-focus-overlay" aria-hidden>
      {ready && (
        <>
          <div className="crop-focus-dim" style={{ top: 0, left: 0, right: 0, height: frame.top }} />
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
            }}
          >
            <span className="crop-focus-corner tl" />
            <span className="crop-focus-corner tr" />
            <span className="crop-focus-corner bl" />
            <span className="crop-focus-corner br" />
            <div className="crop-focus-badge">
              <strong>{label}</strong>
              <span>{hint}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
