import { Fragment, useMemo, type ReactNode } from 'react';
import { isSwatch, swatchFill, type TagNode, type TagTree } from '../lib/tags';

// Hierarchical tag filter. One row per root tag. Inside a row, second-level tags are group chips that
// are followed at once by their own children; levels below that open inline once their parent is
// selected (or something beneath it is). Selecting a tag selects its whole subtree (the gallery
// filters with descendants included); selections are ANDed. A chip with no result in the current set
// is disabled; tags with a colour render as swatches. Selected chips are aria-pressed, and chips
// inside a selected subtree carry data-included.

interface Props {
  tree: TagTree;
  selected: readonly string[];
  /** inclusive photo counts for the current result set */
  counts: ReadonlyMap<string, number>;
  onToggle: (id: string) => void;
}

export default function TagFilter({ tree, selected, counts, onToggle }: Props) {
  const { sel, included, open } = useMemo(() => {
    const sel = new Set(selected);
    const included = new Set<string>();
    const open = new Set<string>();
    for (const id of selected) {
      for (const d of tree.descendants(id)) included.add(d);
      open.add(id);
      for (const a of tree.ancestors(id)) open.add(a);
    }
    return { sel, included, open };
  }, [tree, selected]);

  const chip = (node: TagNode, group = false): ReactNode => {
    const pressed = sel.has(node.id);
    const n = counts.get(node.id) ?? 0;
    const common = {
      type: 'button' as const,
      'aria-pressed': pressed,
      disabled: !pressed && n === 0,
      'data-included': included.has(node.id) ? 'true' : undefined,
      title: n ? `${n} 张` : undefined,
      onClick: () => onToggle(node.id)
    };
    return isSwatch(node) ? (
      <button key={node.id} className="swatch" aria-label={node.name} {...common}>
        <span style={{ background: swatchFill(node.color) }} />
      </button>
    ) : (
      <button key={node.id} className={group ? 'chip tagf-group' : 'chip'} {...common}>
        {node.name}
      </button>
    );
  };

  /** Children of a tag, each followed by its own children when it is open. */
  const below = (parent: TagNode): ReactNode =>
    parent.children.map((c) => (
      <Fragment key={c.id}>
        {chip(c)}
        {c.children.length > 0 && open.has(c.id) && (
          <>
            <span className="tagf-sep tagf-sep-sub" aria-hidden="true" />
            {below(c)}
          </>
        )}
      </Fragment>
    ));

  // the colour-tone row (a root whose children are all swatches) is left out of the filter
  const isToneRow = (root: TagNode) => root.children.length > 0 && root.children.every(isSwatch);

  const rows = tree.roots
    .filter((root) => !isToneRow(root))
    .map((root) => {
      const clusters: ReactNode[][] = [];
      let loose: ReactNode[] = [];
      const flush = () => {
        if (loose.length) clusters.push(loose);
        loose = [];
      };
      if (!root.children.length) {
        loose.push(chip(root));
      } else {
        for (const g of root.children) {
          if (!g.children.length) {
            loose.push(chip(g));
          } else {
            flush();
            clusters.push([chip(g, true), <Fragment key={`${g.id}/below`}>{below(g)}</Fragment>]);
          }
        }
      }
      flush();
      // a row that opens with plain tags (季节) is named by its root, where the other rows open with a group (自然, 光线)
      const named = root.children.length > 0 && root.children[0].children.length === 0;
      return (
        <div key={root.id} className="tagf-row" role="group" aria-label={root.name}>
          {named && (
            <span className="tagf-label" aria-hidden="true">
              {root.name}
            </span>
          )}
          {clusters.map((cluster, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="tagf-sep" aria-hidden="true" />}
              {cluster}
            </Fragment>
          ))}
        </div>
      );
    });

  return <div className="tagf">{rows}</div>;
}
