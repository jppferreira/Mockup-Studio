import type { CSSProperties } from 'react';

export function AppScreenshot({ style }: { style?: CSSProperties }) {
  return (
    <div className="app-shot" style={style} aria-hidden={false}>
      <figure className="app-shot-frame">
        <span className="app-shot-rim" aria-hidden />
        <img
          className="app-shot-img"
          src={`${import.meta.env.BASE_URL}app-screenshot.jpg?v=4`}
          width={1024}
          height={648}
          alt="Mockup Studio app showing a 3D iPhone mockup, scene presets, and animation timeline"
          decoding="async"
          fetchPriority="high"
        />
      </figure>
    </div>
  );
}
