import { Link } from 'react-router-dom';
import { Mark } from './Mark';

interface Props {
  size?: number;
  /** Pass `null` for a non-link logo. Defaults to `/`. */
  to?: string | null;
  className?: string;
  showBeta?: boolean;
  /** Larger wordmark for hero lockups */
  large?: boolean;
  /** Animated gradient glow behind the mark */
  glow?: boolean;
  /** `row` = mark + word side by side (default). `stack` = mark above word. */
  layout?: 'row' | 'stack';}

export function Logo({
  size = 26,
  to = '/',
  className = '',
  showBeta = true,
  large = false,
  glow = false,
  layout = 'row',
}: Props) {
  const classes = [
    'logo',
    large ? 'logo-large' : '',
    layout === 'stack' ? 'logo-stack' : 'logo-row',
    glow ? 'logo-glow' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <Mark size={size} glow={glow} />
      <span className="logo-word">
        Mockup Studio
        {showBeta ? <span className="beta-badge">Beta</span> : null}
      </span>
    </>
  );

  if (to === null) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <Link className={classes} to={to}>
      {content}
    </Link>
  );
}
