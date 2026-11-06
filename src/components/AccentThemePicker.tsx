import { useEffect, useState, type CSSProperties } from 'react';
import { useAccentTheme, type AccentTheme } from '../lib/accentTheme';

const OPTIONS: { id: Exclude<AccentTheme, 'custom'>; label: string }[] = [
  { id: 'green', label: 'Green' },
  { id: 'purple', label: 'Purple' },
];

export default function AccentThemePicker({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme, color] = useAccentTheme();
  const [draft, setDraft] = useState(color);
  const index = theme === 'custom' ? 2 : Math.max(0, OPTIONS.findIndex((option) => option.id === theme));

  useEffect(() => setDraft(color), [color]);

  return (
    <div className={`accent-theme ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <>
          <strong>Theme</strong>
          <span>Pick a preset, or choose your own accent color.</span>
        </>
      )}
      <div
        className="accent-theme-options"
        role="radiogroup"
        aria-label="Theme"
        style={{ '--theme-index': index } as CSSProperties}
      >
        <span className="accent-theme-indicator" aria-hidden />
        {OPTIONS.map((option) => {
          const selected = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`accent-theme-option ${selected ? 'is-selected' : ''}`}
              onClick={() => setTheme(option.id)}
            >
              <span className={`accent-swatch is-${option.id}`} aria-hidden />
              {option.label}
            </button>
          );
        })}
        <label
          className={`accent-theme-option ${theme === 'custom' ? 'is-selected' : ''}`}
          role="radio"
          aria-checked={theme === 'custom'}
        >
          <input
            type="color"
            className="accent-theme-native"
            value={color}
            aria-label="Custom theme color"
            onPointerDown={() => {
              if (theme !== 'custom') setTheme('custom', color);
            }}
            onInput={(event) => setTheme('custom', event.currentTarget.value, false)}
          />
          <span className="accent-swatch is-custom" style={{ background: color }} aria-hidden />
          Custom
        </label>
      </div>
      {theme === 'custom' && (
        <label className="accent-theme-hex">
          <span>Hex</span>
          <input
            value={draft}
            spellCheck={false}
            maxLength={7}
            aria-label="Custom theme hex"
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              if (/^#[0-9a-fA-F]{6}$/.test(next.trim())) setTheme('custom', next.trim(), false);
            }}
            onBlur={() => {
              if (!/^#[0-9a-fA-F]{6}$/.test(draft.trim())) setDraft(color);
            }}
          />
        </label>
      )}
    </div>
  );
}
