import { EDGE_BLUR_LAYERS, edgeBlurMask } from '../lib/edgeBlur';

interface Props {
  enabled: boolean;
  amount: number;
}

/** Live preview of progressive top/bottom blur over the WebGL scene. */
export default function ProgressiveBlurOverlay({ enabled, amount }: Props) {
  if (!enabled || amount <= 0) return null;

  return (
    <div className="progressive-blur" aria-hidden>
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
            <div
              className="progressive-blur-band progressive-blur-band-top"
              style={{ ...style, WebkitMaskImage: edgeBlurMask('top'), maskImage: edgeBlurMask('top') }}
            />
            <div
              className="progressive-blur-band progressive-blur-band-bottom"
              style={{ ...style, WebkitMaskImage: edgeBlurMask('bottom'), maskImage: edgeBlurMask('bottom') }}
            />
          </div>
        );
      })}
    </div>
  );
}
