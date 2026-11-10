import { describe, expect, it } from 'vite-plus/test';
import { columnCount, layoutMasonry, type MasonryItem } from './columns';

const sq = (extra = 0): MasonryItem => ({ ratio: 1, extra });
const cols = (items: MasonryItem[], width: number, gap = 0, rowGap = 0) =>
  layoutMasonry(items, { width, gap, rowGap }).tiles.map((t) => t.col);

describe('columnCount', () => {
  it('matches the CSS rule columns: 4 150px at the widths the site is used at', () => {
    // content width = viewport - 2 gutters; gap = clamp(16px, 2vw, 28px)
    expect(columnCount(1360, 28)).toBe(4); // 1440
    expect(columnCount(717.4, 16)).toBe(4); // 760
    expect(columnCount(604.2, 16)).toBe(3); // 640
    expect(columnCount(358, 16)).toBe(2); // 390
    expect(columnCount(288, 16)).toBe(1); // 320
  });

  it('never goes below one or above four', () => {
    expect(columnCount(0, 16)).toBe(1);
    expect(columnCount(Number.NaN, 16)).toBe(1);
    expect(columnCount(100, 16)).toBe(1);
    expect(columnCount(5000, 16)).toBe(4);
  });

  it('takes a column only when it fits whole', () => {
    expect(columnCount(316, 16)).toBe(2); // 150 + 16 + 150
    expect(columnCount(315, 16)).toBe(1);
  });
});

describe('layoutMasonry', () => {
  it('puts the first items across the first row, left to right', () => {
    const items = [sq(), { ratio: 0.5, extra: 0 }, sq(), { ratio: 2, extra: 0 }];
    const { tiles } = layoutMasonry(items, { width: 600, gap: 0, rowGap: 0 });
    expect(tiles.map((t) => [t.col, t.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0]
    ]);
  });

  it('places each next item in the shortest column', () => {
    // 150px columns: col 0 is tall (ratio 0.5 → 300px), cols 1-3 are 150, 150, 75
    const items = [{ ratio: 0.5, extra: 0 }, sq(), sq(), { ratio: 2, extra: 0 }, sq(), sq(), sq()];
    expect(cols(items, 600)).toEqual([0, 1, 2, 3, 3, 1, 2]);
  });

  it('breaks ties to the left, ignoring sub-pixel noise', () => {
    expect(cols([sq(), sq(), sq()], 300)).toEqual([0, 1, 0]);
    // col 1 is 2px shorter than col 0: the third goes there
    expect(cols([sq(2), sq(), sq()], 300)).toEqual([0, 1, 1]);
    // col 1 is 0.3px shorter: a tie, so the third goes left
    expect(cols([sq(0.3), sq(), sq()], 300)).toEqual([0, 1, 0]);
  });

  it('sizes tiles from the ratio and the caption, and stacks them with the row gap', () => {
    const items = [
      { ratio: 3 / 2, extra: 29 },
      { ratio: 2 / 3, extra: 0 },
      { ratio: 1, extra: 29 }
    ];
    const layout = layoutMasonry(items, { width: 316, gap: 16, rowGap: 30 });
    expect(layout.cols).toBe(2);
    expect(layout.colWidth).toBe(150);
    expect(layout.tiles[0]).toEqual({ col: 0, x: 0, y: 0, h: 100 + 29 });
    expect(layout.tiles[1]).toEqual({ col: 1, x: 166, y: 0, h: 225 });
    expect(layout.tiles[2]).toEqual({ col: 0, x: 0, y: 129 + 30, h: 150 + 29 });
    // the taller column with the gap after its last tile
    expect(layout.height).toBe(129 + 30 + 179 + 30);
  });

  it('keeps the order: the first n tiles do not move when more are added', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ ratio: [0.67, 1.5, 1, 0.8, 1.33][i % 5], extra: i % 3 ? 29 : 0 }));
    const all = layoutMasonry(items, { width: 1360, gap: 28, rowGap: 30 }).tiles;
    const first = layoutMasonry(items.slice(0, 20), { width: 1360, gap: 28, rowGap: 30 }).tiles;
    expect(all.slice(0, 20)).toEqual(first);
  });

  it('treats a missing ratio as square and handles an empty list', () => {
    expect(
      layoutMasonry(
        [
          { ratio: Number.NaN, extra: 0 },
          { ratio: 0, extra: 0 }
        ],
        { width: 150, gap: 0, rowGap: 0 }
      ).tiles.map((t) => t.h)
    ).toEqual([150, 150]);
    expect(layoutMasonry([], { width: 800, gap: 16, rowGap: 30 })).toEqual({ cols: 4, colWidth: 188, tiles: [], height: 0 });
  });
});
