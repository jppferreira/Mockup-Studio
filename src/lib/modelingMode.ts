/** Dev vs User workspace toolsets — only available in development builds. */

export type WorkspaceToolset = 'developer' | 'user';

const TOOLSET_KEY = 'mockup-studio.workspace-toolset.v1';
/** Legacy key from when modeling was a single on/off switch. */
const LEGACY_MODELING_KEY = 'mockup-studio.modeling-mode.v1';

export function isDevToolsetAvailable(): boolean {
  return Boolean(import.meta.env.DEV);
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
