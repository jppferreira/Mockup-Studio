import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const SPLASH_MIN_MS = 1200;
const SPLASH_FADE_MS = 420;

function dismissSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;

  const started = performance.now();
  const finish = () => {
    const remaining = Math.max(0, SPLASH_MIN_MS - (performance.now() - started));
    window.setTimeout(() => {
      splash.classList.add('is-done');
      splash.setAttribute('aria-busy', 'false');
      window.setTimeout(() => splash.remove(), SPLASH_FADE_MS);
    }, remaining);
  };

  // Let the first paint of the app settle before fading the loader away.
  requestAnimationFrame(() => requestAnimationFrame(finish));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

dismissSplash();
