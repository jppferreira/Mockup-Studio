import { describe, expect, it, vi } from 'vitest';
import { scheduleIdle } from './scheduleIdle';

describe('scheduleIdle', () => {
  it('runs work immediately when window is unavailable (SSR / node)', () => {
    const work = vi.fn();
    // In vitest node env, typeof window === 'undefined' → sync path.
    const cancel = scheduleIdle(work, 2000);
    expect(work).toHaveBeenCalledTimes(1);
    expect(() => cancel()).not.toThrow();
  });
});
