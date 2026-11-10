import { describe, expect, it } from 'vitest';
import { normalizeProjectName, PROJECT_NAME_MAX, shouldAdoptCloudName } from './recentProjects';

describe('project rename names', () => {
  it('trims, caps at the existing project name limit, and rejects blanks', () => {
    expect(PROJECT_NAME_MAX).toBe(100);
    expect(normalizeProjectName('  Hello  ')).toBe('Hello');
    expect(normalizeProjectName('   ')).toBeNull();
    expect(normalizeProjectName('')).toBeNull();
    expect(normalizeProjectName('x'.repeat(140))?.length).toBe(100);
  });

  it('adopts a newer cloud label without replacing a newer or dirty local name', () => {
    expect(shouldAdoptCloudName('Old', 10, 'New', 20, false)).toBe('New');
    expect(shouldAdoptCloudName('New', 30, 'Old', 20, false)).toBeNull();
    expect(shouldAdoptCloudName('Same', 10, '  Same  ', 40, false)).toBeNull();
    expect(shouldAdoptCloudName('Old', 10, 'New', 40, true)).toBeNull();
    expect(shouldAdoptCloudName('Old', 10, '   ', 40, false)).toBeNull();
  });
});
