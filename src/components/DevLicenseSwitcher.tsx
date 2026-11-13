import {
  LICENSING_DISABLED,
  planLabel,
  type LicenseTier,
} from '../lib/license';

const TIERS: Array<{ id: LicenseTier; short: string }> = [
  { id: 'free', short: 'Free' },
  { id: 'pro', short: 'Pro' },
  { id: 'pro_max', short: 'Pro Max' },
];

interface Props {
  /** Active gated tier (after LICENSING_DISABLED / override). */
  activeTier: LicenseTier;
  /** True when a persisted override is driving gates. */
  overrideActive: boolean;
  onSelect: (tier: LicenseTier) => void;
  onClear?: () => void;
  className?: string;
  compact?: boolean;
}

/** Dev-only Free / Pro / Pro Max gate simulator — never shown to customers. */
export default function DevLicenseSwitcher({
  activeTier,
  overrideActive,
  onSelect,
  onClear,
  className,
  compact = false,
}: Props) {
  return (
    <div
      className={`dev-license-switcher${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}${LICENSING_DISABLED ? ' is-bypassed' : ''}`}
      role="group"
      aria-label="Dev license tier"
      title={LICENSING_DISABLED
        ? 'LICENSING_DISABLED is on — gates stay Pro Max until that flag is turned off'
        : overrideActive
          ? `Dev override · simulating ${planLabel(activeTier)}`
          : 'Dev license switcher — simulate Free, Pro, or Pro Max gates'}
    >
      <span className="dev-license-switcher-label" aria-hidden>
        {compact ? 'Tier' : 'License'}
      </span>
      {TIERS.map((tier) => (
        <button
          key={tier.id}
          type="button"
          className={activeTier === tier.id ? 'is-active' : ''}
          aria-pressed={activeTier === tier.id}
          disabled={LICENSING_DISABLED}
          title={LICENSING_DISABLED
            ? 'Turn off LICENSING_DISABLED to simulate tiers'
            : `Simulate ${tier.short} gates`}
          onClick={() => onSelect(tier.id)}
        >
          {tier.short}
        </button>
      ))}
      {onClear && overrideActive && !LICENSING_DISABLED ? (
        <button
          type="button"
          className="dev-license-switcher-clear"
          title="Clear override — use the real activated license"
          onClick={onClear}
        >
          Real
        </button>
      ) : null}
    </div>
  );
}
