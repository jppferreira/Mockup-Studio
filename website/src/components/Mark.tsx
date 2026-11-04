/** Mockup Studio mark — elliptical path with a device node. */
export function Mark({ size = 36, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <span
      className={`mark${glow ? ' mark-glow' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {glow ? <span className="mark-glow-aura" /> : null}
      <svg viewBox="0 0 36 36" fill="none">
        {/* Soft core */}
        <circle cx="18" cy="18" r="5.5" fill="currentColor" opacity="0.22" />
        <circle cx="18" cy="18" r="3.2" fill="currentColor" />

        {/* Orbital ring */}
        <ellipse
          cx="18"
          cy="18"
          rx="12.5"
          ry="7.2"
          transform="rotate(-28 18 18)"
          stroke="currentColor"
          strokeWidth="1.7"
          opacity="0.55"
        />
        <ellipse
          cx="18"
          cy="18"
          rx="12.5"
          ry="7.2"
          transform="rotate(28 18 18)"
          stroke="currentColor"
          strokeWidth="1.7"
          opacity="0.9"
        />

        {/* Device node on the orbit */}
        <rect
          x="26.2"
          y="10.4"
          width="5.2"
          height="8.6"
          rx="1.35"
          transform="rotate(18 28.8 14.7)"
          fill="currentColor"
        />
        <rect
          x="27.15"
          y="11.7"
          width="3.3"
          height="5.2"
          rx="0.7"
          transform="rotate(18 28.8 14.3)"
          fill="#0a0d0a"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}
