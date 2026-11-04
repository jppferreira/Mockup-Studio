import { EDGE_BLUR_LAYERS, edgeBlurMask } from '../lib/edgeBlur';

interface Props {
  top: boolean;
  bottom: boolean;
  amount: number;
  /** Lift the bottom band so it sits above the floating timeline. */
  bottomClearance?: 'none' | 'collapsed' | 'open';
}

/** Live preview of progressive top/bottom blur over the WebGL scene. */
export default function ProgressiveBlurOverlay({
  top,
  bottom,
  amount,
  bottomClearance = 'none',
}: Props) {
  if ((!top && !bottom) || amount <= 0) return null;

  return (
    <div
      className={`progressive-blur${bottomClearance !== 'none' ? ` clearance-${bottomClearance}` : ''}`}
      aria-hidden
    >
      {EDGE_BLUR_LAYERS.map((layer, index) => {
        const blur = Math.max(0.5, amount * layer.weight);
        const height = `${layer.frac * 100}%`;
        const style = {
          height,
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
        } as const;
        return (
          <div key={index} className="progressive-blur-stack">
            {top && (
              <div
                className="progressive-blur-band progressive-blur-band-top"
                style={{ ...style, WebkitMaskImage: edgeBlurMask('top'), maskImage: edgeBlurMask('top') }}
              />
            )}
            {bottom && (
              <div
                className="progressive-blur-band progressive-blur-band-bottom"
                style={{ ...style, WebkitMaskImage: edgeBlurMask('bottom'), maskImage: edgeBlurMask('bottom') }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
