export type FeatureIconId = 'devices' | 'motion' | 'templates' | 'local' | 'lighting' | 'export';
export type FeatureIlloStyle = 'charcoal' | 'mint';

const ILLUSTRATIONS: Record<FeatureIlloStyle, Record<FeatureIconId, string>> = {
  charcoal: {
    devices: '/illustrations/feature-devices-charcoal.png?v=6',
    motion: '/illustrations/feature-motion-charcoal.png?v=6',
    templates: '/illustrations/feature-templates-charcoal.png?v=6',
    local: '/illustrations/feature-local-charcoal.png?v=6',
    lighting: '/illustrations/feature-lighting-charcoal.png?v=1',
    export: '/illustrations/feature-export-charcoal.png?v=1',
  },
  mint: {
    devices: '/illustrations/feature-devices-mint.png?v=3',
    motion: '/illustrations/feature-motion-mint.png?v=3',
    templates: '/illustrations/feature-templates-mint.png?v=3',
    local: '/illustrations/feature-local-mint.png?v=3',
    lighting: '/illustrations/feature-lighting-mint.png?v=1',
    export: '/illustrations/feature-export-mint.png?v=1',
  },
};

const ALT: Record<FeatureIconId, string> = {
  devices: 'Soft 3D charcoal phone illustration',
  motion: 'Soft 3D charcoal phone with orbit rings',
  templates: 'Soft 3D charcoal template card stack',
  local: 'Soft 3D charcoal local vault',
  lighting: 'Soft 3D charcoal studio light',
  export: 'Soft 3D charcoal export and aspect frames',
};

export function FeatureIcon({
  id,
  style = 'charcoal',
}: {
  id: FeatureIconId;
  size?: number;
  style?: FeatureIlloStyle;
}) {
  return (
    <span className="feature-illo" aria-hidden>
      <img
        src={ILLUSTRATIONS[style][id]}
        alt={ALT[id]}
        width={160}
        height={160}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
