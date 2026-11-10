// Masonry layout as plain arithmetic. Tiles are placed in reading order, each into the column that is shortest
// at that moment, so the first row holds the first few items and the order runs left to right, top to bottom.
// Heights come from each photo's known aspect ratio plus a fixed caption height, so nothing is measured in the DOM.

/** Narrowest column and most columns: the numbers the CSS `columns: 4 150px` used before, kept so widths look the same. */
export const MIN_COLUMN = 150;
export const MAX_COLUMNS = 4;

/** Columns that fit `width` with `gap` between them; the CSS multi-column rule (floor((W + gap) / (min + gap))), 1 to `max`. */
export function columnCount(width: number, gap: number, min = MIN_COLUMN, max = MAX_COLUMNS): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap))));
}

export interface MasonryItem {
  /** width / height of the picture; anything not positive is treated as square */
  ratio: number;
  /** fixed height under the picture (caption and the space before it), in px */
  extra: number;
}

export interface MasonryTile {
  col: number;
  x: number;
  y: number;
  /** tile height: picture plus `extra` */
  h: number;
}

export interface MasonryLayout {
  cols: number;
  colWidth: number;
  tiles: MasonryTile[];
  /** the tallest column, each tile followed by `rowGap` */
  height: number;
}

// columns within this many px count as equally short, so float noise cannot push a tile past an emptier column on the left
const TIE = 0.5;

export function layoutMasonry(
  items: readonly MasonryItem[],
  { width, gap, rowGap }: { width: number; gap: number; rowGap: number }
): MasonryLayout {
  const cols = columnCount(width, gap);
  const colWidth = Math.max(0, (width - gap * (cols - 1)) / cols);
  const bottoms = Array.from({ length: cols }, () => 0);
  const tiles = items.map(({ ratio, extra }) => {
    let col = 0;
    for (let c = 1; c < cols; c++) if (bottoms[c] < bottoms[col] - TIE) col = c;
    const h = colWidth / (ratio > 0 && Number.isFinite(ratio) ? ratio : 1) + extra;
    const tile = { col, x: col * (colWidth + gap), y: bottoms[col], h };
    bottoms[col] += h + rowGap;
    return tile;
  });
  return { cols, colWidth, tiles, height: Math.max(0, ...bottoms) };
}
