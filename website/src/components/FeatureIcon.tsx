export type FeatureIconId = 'devices' | 'motion' | 'templates' | 'export' | 'local';
export type FeatureIlloStyle = 'charcoal' | 'mint';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

const FILES: Record<FeatureIlloStyle, Record<FeatureIconId, string>> = {
  charcoal: {
    devices: 'illustrations/feature-devices-charcoal.png',
    motion: 'illustrations/feature-motion-charcoal.png',
    templates: 'illustrations/feature-templates-charcoal.png',
    export: 'illustrations/feature-export-charcoal.png',
    local: 'illustrations/feature-local-charcoal.png',
  },
  mint: {
    devices: 'illustrations/feature-devices-mint.png',
    motion: 'illustrations/feature-motion-mint.png',
    templates: 'illustrations/feature-templates-mint.png',
    export: 'illustrations/feature-export-mint.png',
    local: 'illustrations/feature-local-mint.png',
  },
};

function assetUrl(file: string) {
  return `${BASE}${file}?v=7`;
}

const ALT: Record<FeatureIconId, string> = {
  devices: 'Soft 3D charcoal phone illustration',
  motion: 'Soft 3D charcoal phone with orbit rings',
  templates: 'Soft 3D charcoal template card stack',
  export: 'Soft 3D charcoal export and aspect frames',
  local: 'Soft 3D charcoal local vault',
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
        src={assetUrl(FILES[style][id])}
        alt={ALT[id]}
        width={160}
        height={160}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
