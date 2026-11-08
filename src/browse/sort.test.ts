import { describe, expect, it } from 'vite-plus/test';
import { photo } from '../test-utils';
import { byTakenAsc, byTakenDesc } from './sort';

const taken = (id: string, takenAt: string | null) => photo(id, { takenAt });
const order = (list: ReturnType<typeof taken>[], compare: (a: { takenAt: string | null }, b: { takenAt: string | null }) => number) =>
  list
    .slice()
    .sort(compare)
    .map((p) => p.id);

describe('byTakenDesc', () => {
  it('puts the newest capture first', () => {
    const list = [taken('old', '2024-05-01T10:00:00'), taken('new', '2026-11-08T07:00:00'), taken('mid', '2025-06-15T12:30:00')];
    expect(order(list, byTakenDesc)).toEqual(['new', 'mid', 'old']);
  });

  it('compares down to the second', () => {
    const list = [taken('a', '2026-11-08T07:00:00'), taken('c', '2026-11-08T07:00:02'), taken('b', '2026-11-08T07:00:01')];
    expect(order(list, byTakenDesc)).toEqual(['c', 'b', 'a']);
  });

  it('puts photos without a capture time at the end', () => {
    const list = [taken('x', null), taken('new', '2026-11-08T07:00:00'), taken('old', '2024-05-01T10:00:00')];
    expect(order(list, byTakenDesc)).toEqual(['new', 'old', 'x']);
  });

  it('keeps the server order among photos with equal or no capture times', () => {
    const same = [taken('first', '2026-01-01T00:00:00'), taken('second', '2026-01-01T00:00:00'), taken('third', '2026-01-01T00:00:00')];
    expect(order(same, byTakenDesc)).toEqual(['first', 'second', 'third']);
    const undated = [taken('u1', null), taken('u2', null), taken('u3', null)];
    expect(order(undated, byTakenDesc)).toEqual(['u1', 'u2', 'u3']);
  });

  it('is a consistent ordering: antisymmetric', () => {
    const times = ['2024-01-01T00:00:00', '2026-01-01T00:00:00', null];
    for (const a of times) {
      for (const b of times) {
        expect(
          Math.sign(byTakenDesc({ takenAt: a }, { takenAt: b })) + Math.sign(byTakenDesc({ takenAt: b }, { takenAt: a })),
          `${a} vs ${b}`
        ).toBe(0);
      }
    }
  });
});

describe('byTakenAsc', () => {
  it('puts the oldest dated capture first', () => {
    const list = [taken('mid', '2025-06-15T12:30:00'), taken('new', '2026-11-08T07:00:00'), taken('old', '2024-05-01T10:00:00')];
    expect(order(list, byTakenAsc)).toEqual(['old', 'mid', 'new']);
  });
});
