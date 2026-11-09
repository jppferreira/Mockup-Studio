import { useEffect, useState } from 'react';

export type AccentTheme = 'green' | 'purple' | 'custom';

export const ACCENT_THEME_KEY = 'mockup-studio-accent';
export const ACCENT_COLOR_KEY = 'mockup-studio-accent-color';
export const DEFAULT_CUSTOM_ACCENT = '#3b82f6';

export type AccentPair = { accent: string; soft: string };

/** Bright accent used by canvas strokes and 3D selection. Matches `--accent`. */
export const ACCENT_HEX: Record<'green' | 'purple', AccentPair> = {
  green: { accent: '#5cecb6', soft: '#c5f2b6' },
  purple: { accent: '#b794ff', soft: '#d4c4ff' },
};

export type AccentSelection = { theme: AccentTheme; color: string };

const THEME_TRANSITION_MS = 480;
let themeAnimTimer = 0;
let baseTokens: Record<string, string> | null = null;
const appliedTokens = new Set<string>();

export function normalizeHex(input: string | null | undefined): string {
  const match = (input ?? '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : DEFAULT_CUSTOM_ACCENT;
}

export function readAccentTheme(): AccentTheme {
  try {
    const value = localStorage.getItem(ACCENT_THEME_KEY);
    if (value === 'green' || value === 'purple' || value === 'custom') return value;
  } catch {
    /* private mode */
  }
  return 'custom';
}

export function readAccentColor(): string {
  try {
    return normalizeHex(localStorage.getItem(ACCENT_COLOR_KEY));
  } catch {
    return DEFAULT_CUSTOM_ACCENT;
  }
}

export function accentPair(theme: AccentTheme, color = readAccentColor()): AccentPair {
  if (theme === 'green') return ACCENT_HEX.green;
  if (theme === 'purple') return ACCENT_HEX.purple;
  const accent = normalizeHex(color);
  return { accent, soft: deriveAccent(accent)['--accent-soft'] };
}

function hexToHsl(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').slice(0, 6);
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  const channel = (n: number) => Math.round(Math.min(1, Math.max(0, n + m)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Shift a green theme token toward the picked hue. Neutrals stay put. */
function shiftToken(hex: string, deltaHue: number, desaturate: boolean): string {
  const raw = hex.replace('#', '');
  const alpha = raw.length === 8 ? raw.slice(6, 8) : '';
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.12 || l < 0.06 || h < 60 || h > 175) return hex;
  const next = desaturate
    ? hslToHex(h, s * 0.15, l)
    : hslToHex(h + deltaHue, s, l);
  return `${next}${alpha}`;
}

function deriveAccent(hex: string): Record<string, string> {
  const [h, s, l] = hexToHsl(hex);
  const sat = clamp(s, 0.28, 0.92);
  const ink = l > 0.62 ? hslToHex(h, Math.min(sat, 0.45), 0.12) : '#f6f7fb';
  return {
    '--accent': hex,
    '--accent-hover': hslToHex(h, sat, clamp(l + 0.08, 0.2, 0.92)),
    '--accent-soft': hslToHex(h, sat * 0.72, clamp(l + 0.16, 0.45, 0.9)),
    '--accent-button': hslToHex(h, sat * 0.55, clamp(Math.max(l, 0.7) + 0.06, 0.72, 0.92)),
    '--accent-button-hover': hslToHex(h, sat * 0.42, clamp(l + 0.18, 0.8, 0.96)),
    '--accent-focus': hslToHex(h, sat * 0.5, clamp(l + 0.1, 0.7, 0.9)),
    '--accent-ink': ink,
    '--accent-dark': hslToHex(h, sat * 0.45, 0.16),
    '--accent-dark-2': hslToHex(h, sat * 0.5, 0.22),
    '--accent-ring': hslToHex(h, sat * 0.28, 0.9),
    '--accent-hover-text': hslToHex(h, sat * 0.32, 0.94),
    '--accent-hover-bg': hslToHex(h, sat * 0.35, 0.2),
    '--accent-line': hslToHex(h, sat * 0.55, 0.34),
    '--accent-badge': hslToHex(h, sat * 0.32, 0.18),
    '--accent-badge-line': `${hslToHex(h, sat * 0.35, 0.48)}66`,
    '--accent-glow': `${hslToHex(h, sat * 0.3, 0.14)}88`,
    '--accent-chip': hslToHex(h, sat * 0.32, 0.24),
    '--accent-chip-line': hslToHex(h, sat * 0.4, 0.48),
  };
}

function readBaseTokens(): Record<string, string> {
  if (baseTokens && Object.keys(baseTokens).length > 20) return baseTokens;
  const found: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const selectors = rule.selectorText.split(',').map((part) => part.trim());
      if (!selectors.includes(':root')) continue;
      for (let i = 0; i < rule.style.length; i += 1) {
        const name = rule.style.item(i);
        if (!name.startsWith('--')) continue;
        const value = rule.style.getPropertyValue(name).trim();
        if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) found[name] = value;
      }
    }
  }
  if (Object.keys(found).length > 20) baseTokens = found;
  return found;
}

function clearCustomPalette(root: HTMLElement) {
  for (const name of appliedTokens) root.style.removeProperty(name);
  appliedTokens.clear();
  root.style.removeProperty('--accent-icon-hue');
}

function applyCustomPalette(root: HTMLElement, color: string) {
  const hex = normalizeHex(color);
  const base = readBaseTokens();
  const [baseHue] = hexToHsl(base['--accent'] || ACCENT_HEX.green.accent);
  const [pickHue, pickS] = hexToHsl(hex);
  const delta = pickHue - baseHue;
  const desaturate = pickS < 0.12;
  for (const [name, value] of Object.entries(base)) {
    root.style.setProperty(name, shiftToken(value, delta, desaturate));
    appliedTokens.add(name);
  }
  for (const [name, value] of Object.entries(deriveAccent(hex))) {
    root.style.setProperty(name, value);
    appliedTokens.add(name);
  }
  const [purpleHue] = hexToHsl(ACCENT_HEX.purple.accent);
  root.style.setProperty('--accent-icon-hue', `${pickHue - purpleHue}deg`);
}

export function applyAccentTheme(theme: AccentTheme, color = readAccentColor()) {
  const root = document.documentElement;
  root.dataset.accent = theme;
  if (theme === 'custom') applyCustomPalette(root, color);
  else clearCustomPalette(root);
}

export function writeAccentTheme(theme: AccentTheme, color?: string, animate = true) {
  const nextColor = normalizeHex(color ?? readAccentColor());
  try {
    localStorage.setItem(ACCENT_THEME_KEY, theme);
    if (theme === 'custom' || color) localStorage.setItem(ACCENT_COLOR_KEY, nextColor);
  } catch {
    /* private mode */
  }
  const root = document.documentElement;
  const previousColor = theme === 'custom' ? (root.style.getPropertyValue('--accent').trim() || readAccentColor()) : '';
  const changed = root.dataset.accent !== theme
    || (theme === 'custom' && previousColor.toLowerCase() !== nextColor);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduceMotion) {
    root.classList.remove('is-theme-animating');
  } else if (changed) {
    root.classList.add('is-theme-animating');
    // Commit the transition before the colors change, or the browser skips the interpolation.
    void root.offsetWidth;
  }
  applyAccentTheme(theme, nextColor);
  const detail: AccentSelection = { theme, color: nextColor };
  window.dispatchEvent(new CustomEvent<AccentSelection>('accent-theme', { detail }));
  if (animate && changed && !reduceMotion) {
    window.clearTimeout(themeAnimTimer);
    themeAnimTimer = window.setTimeout(() => {
      root.classList.remove('is-theme-animating');
    }, THEME_TRANSITION_MS + 40);
  }
}

export function useAccentTheme() {
  const [theme, setTheme] = useState<AccentTheme>(() => readAccentTheme());
  const [color, setColor] = useState<string>(() => readAccentColor());

  useEffect(() => {
    applyAccentTheme(theme, color);
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<AccentSelection>).detail;
      if (!next || (next.theme !== 'green' && next.theme !== 'purple' && next.theme !== 'custom')) return;
      setTheme(next.theme);
      setColor(normalizeHex(next.color));
    };
    window.addEventListener('accent-theme', onChange);
    return () => window.removeEventListener('accent-theme', onChange);
  }, [theme, color]);

  return [theme, writeAccentTheme, color] as const;
}
