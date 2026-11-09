const STORAGE_KEY = 'mockup-studio.studio-tour-complete';

export function isStudioTourComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markStudioTourComplete(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode — still dismiss for this session */
  }
}

export function clearStudioTourComplete(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}
