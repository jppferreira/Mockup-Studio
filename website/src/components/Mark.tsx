const logoSrc = `${import.meta.env.BASE_URL}logo.png`;

/** Mockup Studio mark — overlapping glass cards. */
export function Mark({ size = 36, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <span
      className={`mark${glow ? ' mark-glow' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {glow ? <span className="mark-glow-aura" /> : null}
      <img src={logoSrc} alt="" width={size} height={size} draggable={false} />
    </span>
  );
}
