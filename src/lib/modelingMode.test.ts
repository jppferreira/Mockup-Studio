import { describe, expect, it } from 'vitest';
import { DEV_ACCESS_EMAILS, isDevAccessEmail } from './modelingMode';

describe('dev access', () => {
  it('grants the account email on file and rejects everyone else', () => {
    expect(DEV_ACCESS_EMAILS).toEqual(['hello@jppferreira.com']);
    expect(isDevAccessEmail('hello@jppferreira.com')).toBe(true);
    expect(isDevAccessEmail('  Hello@JPPferreira.com ')).toBe(true);
    expect(isDevAccessEmail('sales@mokstudio.io')).toBe(false);
    expect(isDevAccessEmail(null)).toBe(false);
  });
});
