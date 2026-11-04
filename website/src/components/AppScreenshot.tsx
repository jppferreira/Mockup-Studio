import type { CSSProperties } from 'react';

export function AppScreenshot({ style }: { style?: CSSProperties }) {
  return (
    <div className="app-shot" style={style} aria-hidden={false}>
      <div className="app-shot-gradient" aria-hidden>
        <span className="app-shot-gradient-blob app-shot-gradient-a" />
        <span className="app-shot-gradient-blob app-shot-gradient-b" />
        <span className="app-shot-gradient-blob app-shot-gradient-c" />
      </div>
      <div className="app-shot-glow" aria-hidden />
      <div className="app-shot-glow app-shot-glow-soft" aria-hidden />
      <figure className="app-shot-frame">
        <img
          className="app-shot-img"
          src={`${import.meta.env.BASE_URL}app-screenshot.jpg?v=3`}
          width={1510}
          height={960}
          alt="Mockup Studio app showing a 3D iPhone mockup, scene presets, and animation timeline"
          decoding="async"
          fetchPriority="high"
        />
      </figure>
    </div>
  );
}
