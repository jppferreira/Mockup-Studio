import type { CSSProperties } from 'react';

export function AppScreenshot({ style }: { style?: CSSProperties }) {
  return (
    <div className="app-shot" style={style} aria-hidden={false}>
      <figure className="app-shot-frame">
        <span className="app-shot-rim" aria-hidden />
        <img
          className="app-shot-img"
          src={`${import.meta.env.BASE_URL}app-screenshot.jpg?v=6`}
          width={2048}
          height={1302}
          alt="mokstudio editing an iPhone 15 Pro Max weather mockup, with layers, lighting, and export"
          decoding="async"
          fetchPriority="high"
        />
      </figure>
    </div>
  );
}
