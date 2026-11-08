import { useMemo } from 'react';
import { Link } from 'wouter';
import { usePhotoList, usePoiList, useTagTree } from '../browse/api';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { galleryLink } from '../browse/links';
import { LoadError, Loading } from '../browse/ui';
import { CategoryIcon } from '../components/icons';
import { inclusiveCounts, swatchFill, type TagNode } from '../lib/tags';
import '../styles/browse.css';

// A book-style index: every root tag is a section, tags are sized by how many photos they hold
// (descendants included) and link to the filtered gallery; places are grouped by city with leader dots.

interface CityGroup {
  name: string;
  total: number;
  places: { id: string; name: string; category: string; n: number }[];
  hidden: number;
}

export default function IndexPage() {
  const { photos, error, reload } = usePhotoList('');
  const { tree } = useTagTree();
  const { byId: poiById } = usePoiList();
  useDocTitle('索引');
  useScrollTop(null);

  const counts = useMemo(() => (photos && tree ? inclusiveCounts(photos, tree) : new Map<string, number>()), [photos, tree]);
  const n = (node: TagNode) => counts.get(node.id) ?? 0;
  const live = (node: TagNode): boolean => n(node) > 0;

  const { max, tagTotal } = useMemo(() => {
    let max = 1;
    let tagTotal = 0;
    if (tree) {
      for (const node of tree.byId.values()) {
        const c = counts.get(node.id) ?? 0;
        if (c > 0 && node.depth > 0) {
          tagTotal++;
          max = Math.max(max, c);
        }
      }
    }
    return { max, tagTotal };
  }, [tree, counts]);
  const sizeOf = (c: number) => Math.round(15 + 29 * Math.pow(c / max, 0.6));

  const cities = useMemo<CityGroup[]>(() => {
    if (!photos) return [];
    const map = new Map<string, { places: Map<string, number>; hidden: number }>();
    const slot = (name: string) => {
      let s = map.get(name);
      if (!s) map.set(name, (s = { places: new Map(), hidden: 0 }));
      return s;
    };
    for (const p of photos) {
      const poi = p.poiId ? poiById.get(p.poiId) : undefined;
      if (poi) {
        const s = slot(poi.city ?? p.city ?? '');
        s.places.set(poi.id, (s.places.get(poi.id) ?? 0) + 1);
      } else {
        slot(p.city ?? '').hidden++;
      }
    }
    return [...map.entries()]
      .map(([name, s]) => {
        const places = [...s.places.entries()]
          .map(([id, c]) => ({ id, name: poiById.get(id)!.name, category: poiById.get(id)!.category, n: c }))
          .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'zh-CN'));
        return { name, places, hidden: s.hidden, total: places.reduce((t, x) => t + x.n, 0) + s.hidden };
      })
      .sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || b.total - a.total || a.name.localeCompare(b.name, 'zh-CN'));
  }, [photos, poiById]);
  const placeTotal = cities.reduce((t, c) => t + c.places.length, 0);

  if (error) {
    return (
      <main className="page bw">
        <LoadError error={error} onRetry={reload} />
      </main>
    );
  }
  if (!photos || !tree) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }

  const link = (node: TagNode, extra?: { className?: string }) => (
    <Link
      key={node.id}
      href={galleryLink({ tags: [node.id] })}
      className={extra?.className ?? 'idx-tag'}
      style={extra?.className ? undefined : { fontSize: sizeOf(n(node)) }}
      aria-label={`${node.name}，${n(node)} 张`}
    >
      {node.name}
      <span className="idx-n">{n(node)}</span>
    </Link>
  );

  // plain leaves flow as a cloud, coloured ones as a list with swatches, branches as indented groups
  const level = (nodes: readonly TagNode[]) => {
    const shown = nodes.filter(live);
    const branch = (x: TagNode) => x.children.some(live);
    const leaves = shown.filter((x) => !branch(x) && !x.color);
    const tones = shown.filter((x) => !branch(x) && x.color);
    return (
      <>
        {leaves.length > 0 && <div className="idx-cloud">{leaves.map((x) => link(x))}</div>}
        {tones.length > 0 && (
          <ul className="idx-tones">
            {tones.map((x) => (
              <li key={x.id}>
                <Link href={galleryLink({ tags: [x.id] })} aria-label={`${x.name}，${n(x)} 张`}>
                  <i aria-hidden="true" style={{ background: swatchFill(x.color) }} />
                  <span className="idx-tone-name">{x.name}</span>
                  <span className="idx-dots" aria-hidden="true" />
                  <span className="mono">{n(x)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {shown.filter(branch).map((g) => (
          <div key={g.id} className="idx-group">
            {link(g)}
            <div className="idx-sub">{level(g.children)}</div>
          </div>
        ))}
      </>
    );
  };

  const roots = tree.roots.filter(live);

  return (
    <main className="page bw idx">
      <div className="idx-head">
        <h1 className="display idx-h1">索引</h1>
        <p className="idx-totals mono">
          <span>{photos.length} 张</span>
          <span>{tagTotal} 个标签</span>
          <span>{placeTotal} 处地点</span>
        </p>
      </div>

      <section aria-labelledby="idx-tags" className="idx-section">
        <h2 id="idx-tags" className="bw-h2">
          标签
        </h2>
        {roots.length === 0 ? (
          <p className="muted">还没有带标签的照片</p>
        ) : (
          <div className="idx-roots">
            {roots.map((root) => {
              const useKids = root.children.some(live);
              return (
                <div
                  key={root.id}
                  className="idx-root"
                  style={{ flexGrow: useKids ? Math.min(3, Math.max(1, Math.round(root.children.filter(live).length / 3))) : 1 }}
                >
                  <h3>{root.name}</h3>
                  {level(useKids ? root.children : [root])}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="idx-places" className="idx-section">
        <h2 id="idx-places" className="bw-h2">
          地点
        </h2>
        {cities.length === 0 ? (
          <p className="muted">还没有照片</p>
        ) : (
          <div className="idx-cities">
            {cities.map((c) => (
              <div key={c.name || '-'} className="idx-city">
                <h3>
                  <span>{c.name || '其他'}</span>
                  <span className="mono">{c.total}</span>
                </h3>
                <ul>
                  {c.places.map((p) => (
                    <li key={p.id}>
                      <Link href={`/place/${p.id}`} className="idx-place">
                        <CategoryIcon category={p.category} size={17} />
                        <span className="idx-place-name">{p.name}</span>
                        <span className="idx-dots" aria-hidden="true" />
                        <span className="mono">{p.n}</span>
                      </Link>
                    </li>
                  ))}
                  {c.hidden > 0 && (
                    <li className="idx-place idx-hidden">
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
                      </svg>
                      <span className="idx-place-name">位置未公开</span>
                      <span className="idx-dots" aria-hidden="true" />
                      <span className="mono">{c.hidden}</span>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
