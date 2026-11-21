import { describe, expect, it } from 'vitest';
import { roundCoord } from '../src/ui/rounding';

describe('drag rounding', () => {
  it('rounds to 2 decimals', () => {
    expect(roundCoord(1.23456, false)).toBe(1.23);
    expect(roundCoord(-0.004, false)).toBe(0);
  });
  it('snaps to the 0.5 grid', () => {
    expect(roundCoord(1.26, true)).toBe(1.5);
    expect(roundCoord(1.24, true)).toBe(1);
    expect(roundCoord(-0.2, true)).toBe(0);
  });
});
