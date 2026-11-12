import { describe, expect, it } from 'vitest';
import { compareVersions, parseReleaseNotes } from './desktopUpdate';

describe('parseReleaseNotes', () => {
  it('extracts changelog bullets and skips download sections', () => {
    const notes = parseReleaseNotes(`
## mokstudio 0.1.4

- Account & licence on the home Settings tab
- **Update modal** with in-app download
- Device models load only when placed

### Downloads
- New installs: dmg

### Gatekeeper note
Unsigned build
`);
    expect(notes).toEqual([
      'Account & licence on the home Settings tab',
      'Update modal with in-app download',
      'Device models load only when placed',
    ]);
  });
});

describe('compareVersions', () => {
  it('orders semver-ish versions', () => {
    expect(compareVersions('0.1.4', '0.1.3')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.3')).toBe(-1);
    expect(compareVersions('v0.1.3', '0.1.3')).toBe(0);
  });
});
