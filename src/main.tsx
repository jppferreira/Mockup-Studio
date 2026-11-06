import { useEffect, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isSiteUnlocked, SiteGate } from './components/SiteGate';
import { applyAccentTheme, readAccentColor, readAccentTheme } from './lib/accentTheme';
import { installNumberScrub } from './lib/numberScrub';
import './styles.css';

installNumberScrub();

applyAccentTheme(readAccentTheme(), readAccentColor());

const SPLASH_MIN_MS = 1200;
const SPLASH_FADE_MS = 420;

function dismissSplash(immediate = false) {
  const splash = document.getElementById('app-splash');
  if (!splash || new URLSearchParams(location.search).has('splash')) return;

  const started = performance.now();
  const finish = () => {
    const remaining = immediate ? 0 : Math.max(0, SPLASH_MIN_MS - (performance.now() - started));
    window.setTimeout(() => {
      const fill = document.getElementById('splash-progress-fill');
      const pct = document.getElementById('splash-percent');
      if (fill) {
        fill.dataset.done = '1';
        fill.style.width = '100%';
      }
      if (pct) pct.textContent = '100%';
      window.setTimeout(() => {
        splash.classList.add('is-done');
        splash.setAttribute('aria-busy', 'false');
        window.setTimeout(() => splash.remove(), immediate ? 0 : SPLASH_FADE_MS);
      }, immediate ? 0 : 180);
    }, remaining);
  };

  if (immediate) {
    finish();
    return;
  }
  // Let the first paint of the app settle before fading the loader away.
  requestAnimationFrame(() => requestAnimationFrame(finish));
}

function Root() {
  const [locked, setLocked] = useState(() => !isSiteUnlocked());

  useEffect(() => {
    dismissSplash(locked);
  }, [locked]);

  if (locked) return <SiteGate onUnlock={() => setLocked(false)} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
