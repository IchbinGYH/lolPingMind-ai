import { describe, expect, it } from 'vitest';
import { repeatedPing, PING_REPEAT_MS } from '../../src/shared/pingRepeat';
import { ALL_PINGS } from '../../src/shared/pings';

describe('pingRepeat', () => {
  it.each(ALL_PINGS)('recognizes two consecutive $id signals on the same display', ({ id }) => {
    expect(repeatedPing({ ping: id, displayId: 2, at: 100 }, { ping: id, displayId: 2, at: 1000 })).toBe(true);
  });
  it('does not pair different signals, displays, expired events or a reversed clock', () => {
    const first = { ping: 'missing', displayId: 1, at: 100 } as const;
    expect(repeatedPing(null, first)).toBe(false);
    expect(repeatedPing(first, { ...first, ping: 'danger' })).toBe(false);
    expect(repeatedPing(first, { ...first, displayId: 2 })).toBe(false);
    expect(repeatedPing(first, { ...first, at: 100 + PING_REPEAT_MS })).toBe(false);
    expect(repeatedPing(first, { ...first, at: 99 })).toBe(false);
  });
});
