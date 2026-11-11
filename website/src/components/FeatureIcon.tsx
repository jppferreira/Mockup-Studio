export type FeatureIconId =
  | 'devices'
  | 'backgrounds'
  | 'lighting'
  | 'motion'
  | 'templates'
  | 'props'
  | 'export'
  | 'local';
export type FeatureIlloStyle = 'charcoal' | 'mint';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

const FILES: Record<FeatureIlloStyle, Record<FeatureIconId, string>> = {
  charcoal: {
    devices: 'illustrations/feature-devices-charcoal.png',
    backgrounds: 'illustrations/feature-backgrounds-charcoal.png',
    lighting: 'illustrations/feature-lighting-charcoal.png',
    motion: 'illustrations/feature-motion-charcoal.png',
    templates: 'illustrations/feature-templates-charcoal.png',
    props: 'illustrations/feature-props-charcoal.png',
    export: 'illustrations/feature-export-charcoal.png',
    local: 'illustrations/feature-local-charcoal.png',
  },
  mint: {
    devices: 'illustrations/feature-devices-mint.png',
    backgrounds: 'illustrations/feature-backgrounds-mint.png',
    lighting: 'illustrations/feature-lighting-mint.png',
    motion: 'illustrations/feature-motion-mint.png',
    templates: 'illustrations/feature-templates-mint.png',
    props: 'illustrations/feature-props-mint.png',
    export: 'illustrations/feature-export-mint.png',
    local: 'illustrations/feature-local-mint.png',
  },
};

function assetUrl(file: string) {
  // Absolute-from-root URL so nested routes (/pricing, etc.) resolve correctly on Pages.
  const path = file.replace(/^\//, '');
  return `${BASE}${path}?v=9`;
}

const ALT: Record<FeatureIconId, string> = {
  devices: 'Soft 3D phone illustration',
  backgrounds: 'Soft 3D customizable backdrop panels',
  lighting: 'Soft 3D studio light and reflections',
  motion: 'Soft 3D phone with orbit rings',
  templates: 'Soft 3D template card stack',
  props: 'Soft 3D props and multi-device scene',
  export: 'Soft 3D export and aspect frames',
  local: 'Soft 3D local vault',
};

export function FeatureIcon({
  id,
  style = 'mint',
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
