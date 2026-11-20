import { describe, expect, it } from 'vite-plus/test';
import { shownIn, withShown } from './shown';

describe('shown count in history state', () => {
  it('reads back what was stored for the same address', () => {
    expect(shownIn(withShown(null, '/?tags=lake', 60), '/?tags=lake')).toBe(60);
  });

  it('ignores a count stored for another address (a filter changed in the same entry)', () => {
    expect(shownIn(withShown(null, '/?tags=lake', 60), '/')).toBe(0);
  });

  it('is 0 for a fresh entry or foreign state', () => {
    expect(shownIn(null, '/')).toBe(0);
    expect(shownIn('x', '/')).toBe(0);
    expect(shownIn({ livingShown: { key: '/', n: 'many' } }, '/')).toBe(0);
    expect(shownIn({ livingShown: { key: '/', n: -3 } }, '/')).toBe(0);
  });

  it('keeps the other fields of the state', () => {
    expect(withShown({ other: 1 }, '/', 40)).toEqual({ other: 1, livingShown: { key: '/', n: 40 } });
  });
});
