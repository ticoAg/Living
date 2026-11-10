import { describe, expect, it } from 'vite-plus/test';
import { maySkip, positionOf, stepId } from './playback';

const list = ['a', 'b', 'c'].map((id) => ({ id }));

describe('positionOf', () => {
  it('finds the current photo', () => {
    expect(positionOf(list, 'c')).toBe(2);
  });
  it('starts at the first photo when there is none or it is gone', () => {
    expect(positionOf(list, null)).toBe(0);
    expect(positionOf(list, 'x')).toBe(0);
    expect(positionOf([], 'a')).toBe(0);
  });
});

describe('stepId', () => {
  it('steps both ways and wraps around', () => {
    expect(stepId(list, 0, 1)).toBe('b');
    expect(stepId(list, 2, 1)).toBe('a');
    expect(stepId(list, 0, -1)).toBe('c');
    expect(stepId(list, 1, -4)).toBe('a');
    expect(stepId(list, 1, 0)).toBe('b');
  });
  it('has nothing to show for an empty list', () => {
    expect(stepId([], 0, 1)).toBeNull();
  });
});

describe('maySkip', () => {
  it('allows as many failures in a row as there are photos, at least two', () => {
    expect(maySkip(1, 1)).toBe(true);
    expect(maySkip(2, 1)).toBe(true);
    expect(maySkip(3, 1)).toBe(false);
    expect(maySkip(5, 5)).toBe(true);
    expect(maySkip(6, 5)).toBe(false);
  });
});
