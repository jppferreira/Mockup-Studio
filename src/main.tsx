import { useEffect, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopSignIn, shouldShowDesktopSignIn } from './components/DesktopSignIn';
import OnboardingFlow from './components/OnboardingFlow';
import { isSiteUnlocked, SiteGate, webAuthRequired } from './components/SiteGate';
import { applyAccentTheme, readAccentColor, readAccentTheme } from './lib/accentTheme';
import { installNumberScrub } from './lib/numberScrub';
import { clearOnboardingComplete, isOnboardingComplete } from './lib/onboarding';
import { clearStudioTourComplete } from './lib/studioTour';
import { prepareModelCache } from './lib/modelCache';
import { warmGltfDecoders } from './lib/gltfDecoders';
import { getAuthSnapshot, onAuthChange } from './lib/supabaseClient';
import { perfMark } from './lib/perfDiagnostics';
import './styles.css';

installNumberScrub();

applyAccentTheme(readAccentTheme(), readAccentColor());
perfMark('boot');
// Open IndexedDB + AES key while the splash is up so the first GLB resolve is warm.
prepareModelCache();
// Meshopt wasm ready before the first compressed (or drei-default) GLTF parse.
warmGltfDecoders();

/** Bump when onboarding/tour content changes so returning users see the new flow once. */
const GUIDE_VERSION = '3';
const GUIDE_VERSION_KEY = 'mockup-studio.guide-version';

function shouldForceGuideReplay(): boolean {
  try {
    if (localStorage.getItem(GUIDE_VERSION_KEY) === GUIDE_VERSION) return false;
    localStorage.setItem(GUIDE_VERSION_KEY, GUIDE_VERSION);
    clearOnboardingComplete();
    clearStudioTourComplete();
    return true;
  } catch {
    return false;
  }
}

const SPLASH_MIN_MS = 400;
const SPLASH_FADE_MS = 280;

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
  const [desktopAuth, setDesktopAuth] = useState<'checking' | 'needed' | 'done'>(() => (
    shouldShowDesktopSignIn() ? 'checking' : 'done'
  ));
  const [needsOnboarding, setNeedsOnboarding] = useState(() => {
    if (shouldForceGuideReplay()) return true;
    return !isOnboardingComplete();
  });

  useEffect(() => {
    dismissSplash(locked || desktopAuth !== 'done');
  }, [locked, desktopAuth]);

  // Online studio: if they sign out, send them back to the email / OAuth gate.
  useEffect(() => {
    if (!webAuthRequired()) return undefined;
    return onAuthChange((snap) => {
      if (!snap.user) setLocked(true);
    });
  }, []);

  useEffect(() => {
    if (desktopAuth !== 'checking') return undefined;
    let cancelled = false;
    void getAuthSnapshot().then((snap) => {
      if (cancelled) return;
      setDesktopAuth(snap.user ? 'done' : 'needed');
    });
    return () => {
      cancelled = true;
    };
  }, [desktopAuth]);

  const showOnboarding = () => {
    clearOnboardingComplete();
    clearStudioTourComplete();
    setNeedsOnboarding(true);
  };

  if (locked) return <SiteGate onUnlock={() => setLocked(false)} />;
  if (desktopAuth === 'checking') return null;
  if (desktopAuth === 'needed') {
    return <DesktopSignIn onComplete={() => setDesktopAuth('done')} />;
  }
  if (needsOnboarding) {
    return <OnboardingFlow onComplete={() => setNeedsOnboarding(false)} />;
  }
  return <AppShell onShowOnboarding={showOnboarding} />;
}

function AppShell({ onShowOnboarding }: { onShowOnboarding: () => void }) {
  useEffect(() => {
    perfMark('shell-ready');
  }, []);
  return <App onShowOnboarding={onShowOnboarding} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
