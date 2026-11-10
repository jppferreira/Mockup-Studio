/** Dev vs User workspace toolsets. Local dev builds always unlock it; production follows the signed-in email. */

export type WorkspaceToolset = 'developer' | 'user';

const TOOLSET_KEY = 'mockup-studio.workspace-toolset.v1';
/** Legacy key from when modeling was a single on/off switch. */
const LEGACY_MODELING_KEY = 'mockup-studio.modeling-mode.v1';

/**
 * Account that keeps the Dev toolset on production web and desktop builds.
 * Local `vite` dev still enables it for every session via `import.meta.env.DEV`.
 */
export const DEV_ACCESS_EMAILS = ['hello@jppferreira.com'] as const;

let signedInEmail: string | null = null;

function normalizeEmail(email: string | null | undefined): string | null {
  const next = email?.trim().toLowerCase();
  return next || null;
}

/** Remember the signed-in account so Dev access follows that email. */
export function setDevAccessAccount(email: string | null | undefined): void {
  signedInEmail = normalizeEmail(email);
}

export function isDevAccessEmail(email: string | null | undefined): boolean {
  const next = normalizeEmail(email);
  return Boolean(next && (DEV_ACCESS_EMAILS as readonly string[]).includes(next));
}

export function isDevToolsetAvailable(email?: string | null): boolean {
  if (import.meta.env.DEV) return true;
  return isDevAccessEmail(email === undefined ? signedInEmail : email);
}

/** @deprecated Prefer isDevToolsetAvailable */
export function isModelingModeAvailable(): boolean {
  return isDevToolsetAvailable();
}

function readStoredToolset(): WorkspaceToolset | null {
  try {
    const raw = localStorage.getItem(TOOLSET_KEY);
    if (raw === 'developer' || raw === 'user') return raw;
    // Migrate: old "modeling on" → developer toolset.
    if (localStorage.getItem(LEGACY_MODELING_KEY) === '1') return 'developer';
    return null;
  } catch {
    return null;
  }
}

export function loadWorkspaceToolset(): WorkspaceToolset {
  if (!isDevToolsetAvailable()) return 'user';
  // Remember the last Dev/User choice; default to Dev for first launch.
  return readStoredToolset() ?? 'developer';
}

export function saveWorkspaceToolset(toolset: WorkspaceToolset): void {
  if (!isDevToolsetAvailable()) return;
  try {
    localStorage.setItem(TOOLSET_KEY, toolset);
    if (toolset === 'developer') localStorage.setItem(LEGACY_MODELING_KEY, '1');
    else localStorage.removeItem(LEGACY_MODELING_KEY);
  } catch {
    /* ignore */
  }
}

export function isDeveloperToolset(toolset: WorkspaceToolset = loadWorkspaceToolset()): boolean {
  return isDevToolsetAvailable() && toolset === 'developer';
}

/** @deprecated Prefer loadWorkspaceToolset / isDeveloperToolset */
export function loadModelingModeEnabled(): boolean {
  return isDeveloperToolset();
}

/** @deprecated Prefer saveWorkspaceToolset */
export function saveModelingModeEnabled(enabled: boolean): void {
  saveWorkspaceToolset(enabled ? 'developer' : 'user');
}
