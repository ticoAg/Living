import { useId, useMemo, useState } from 'react';
import type { Poi } from '../../shared/types';
import { CategoryIcon } from '../components/icons';
import { centreOf, mergeCandidates, sharedPlace } from './batch-place';
import { choiceFromCandidate, choiceFromPoi, type PlaceChoice } from './match';
import { PlaceCustom, Row, SearchForm, SearchResults, usePlaceSearch } from './PlacePicker';
import { customAtFor, isEditable, placeOf, type Item } from './upload-model';
import { errMsg } from './util';

// The place row of the "一起整理" panel: the places the selected photos' own matches found, merged and ranked by
// how many of them list each one, plus search and "新建地点". Picking one gives it to every selected photo that is not
// clearly too far from it. Docs: /docs/product/features/upload.md#一起整理

/** Candidates shown before "显示全部". */
const SHORT_LIST = 4;

export interface ApplyResult {
  /** the place's key as given (a place created on the way has its new id) */
  key: string;
  done: number;
  far: number;
  pending: number;
}

interface Props {
  /** the selected photos, in queue order */
  items: Item[];
  all: Item[];
  extras: Poi[];
  /** give this place to the selected photos; `fromCandidates` when it was picked from the merged match results */
  onApply: (choice: PlaceChoice, fromCandidates: boolean) => Promise<ApplyResult>;
  onClear: () => void;
  onCreated: (poi: Poi) => void;
}

function outcome(name: string, r: ApplyResult): string {
  const skipped = [r.far ? `${r.far} 张离得太远` : '', r.pending ? `${r.pending} 张还在处理` : ''].filter(Boolean);
  return `「${name}」已用于 ${r.done} 张${skipped.length ? `；${skipped.join('、')}，没有改` : ''}。`;
}

export default function BatchPlace({ items, all, extras, onApply, onClear, onCreated }: Props) {
  const id = useId();
  const open = useMemo(() => items.filter(isEditable), [items]);
  const ranked = useMemo(() => mergeCandidates(open, extras), [open, extras]);
  const shared = sharedPlace(open, all);
  const placed = open.filter((it) => placeOf(it, all)).length;
  const centre = useMemo(() => centreOf(open), [open]);
  const customAt = centre ?? (open[0] ? customAtFor(open[0], all) : null);
  const matching = open.some((it) => it.stage !== 'ready' || it.match?.loading);
  const res = open.find((it) => it.match?.res)?.match?.res ?? null;
  const { search, runSearch } = usePlaceSearch(centre);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);
  // with only some photos taking it, the place just given stays marked in the list
  const [given, setGiven] = useState<PlaceChoice | null>(null);
  const marked = (shared ?? given)?.key ?? null;
  const none = open.length === 0;

  const chosenAt = ranked.findIndex((b) => b.c.key === marked);
  const listed = showAll || chosenAt >= SHORT_LIST ? ranked : ranked.slice(0, SHORT_LIST);

  function clear() {
    setGiven(null);
    setSaid(null);
    onClear();
  }

  async function apply(choice: PlaceChoice, fromCandidates: boolean) {
    setBusy(true);
    setSaid(null);
    try {
      const r = await onApply(choice, fromCandidates);
      setSaid({ text: outcome(choice.name, r) });
      setGiven({ ...choice, key: r.key });
    } catch (e) {
      setSaid({ text: errMsg(e, '没能使用这个地点'), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pf-row pf-top">
      <span className="pf-k">地点</span>
      <div className="pf-v bp">
        {shared ? (
          <div className="pk-current">
            <CategoryIcon category={shared.category} size={22} />
            <div className="pk-current-main">
              <span className="pk-current-name serif">{shared.name}</span>
              <span className="small muted">
                {shared.category} · {placed} 张
              </span>
            </div>
            <button type="button" className="btn btn-quiet pk-clear" onClick={clear} disabled={busy}>
              清除
            </button>
          </div>
        ) : (
          <div className="pk-current" data-empty="true">
            <span className="muted">{placed ? `${placed} / ${open.length} 张有地点` : '未选择地点'}</span>
            {placed > 0 && (
              <button type="button" className="btn btn-quiet pk-clear" onClick={clear} disabled={busy}>
                清除
              </button>
            )}
          </div>
        )}

        <div className="pk-status small" aria-live="polite">
          {said ? (
            <span className={said.error ? 'error-text' : undefined}>{said.text}</span>
          ) : (
            matching && <span className="muted">还有照片在处理或匹配…</span>
          )}
        </div>

        {ranked.length > 0 ? (
          <div className="pk-list" role="radiogroup" aria-label="所选照片的候选地点">
            {listed.map((b) => (
              <Row
                key={b.c.key}
                group={`${id}-c`}
                row={{
                  key: b.c.key,
                  name: b.c.name,
                  category: b.c.category,
                  distance: b.count || centre ? Math.round(b.distance) : null,
                  area: b.count > 0 && b.c.area && b.distance === 0,
                  local: b.c.source === 'local',
                  count: b.count || undefined
                }}
                checked={marked === b.c.key}
                disabled={none || busy}
                onSelect={() =>
                  void apply(
                    b.count
                      ? choiceFromCandidate(b.c, 'confirmed')
                      : choiceFromPoi(
                          extras.find((p) => p.id === b.c.key)!,
                          'manual'
                        ),
                    b.count > 0
                  )
                }
              />
            ))}
          </div>
        ) : (
          !matching && <p className="muted small bp-none">匹配结果里没有地点，可以搜索或新建。</p>
        )}
        {ranked.length > SHORT_LIST && chosenAt < SHORT_LIST && (
          <button type="button" className="btn btn-quiet pk-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? '收起' : `显示全部 ${ranked.length} 个`}
          </button>
        )}

        <SearchForm at={centre} loading={search.loading} onSearch={(t) => void runSearch(t)} disabled={none || busy} />
        <SearchResults at={centre} state={search} value={shared ?? given} onPick={(c) => void apply(c, false)} disabled={none || busy} />

        <PlaceCustom
          at={customAt}
          city={res?.city ?? null}
          district={res?.district ?? null}
          where={centre ? '所选照片的中间位置' : '时间最近的照片的拍摄位置'}
          disabled={none || busy}
          onCreated={(poi) => {
            onCreated(poi);
            void apply(choiceFromPoi(poi, 'manual'), false);
          }}
        />
      </div>
    </div>
  );
}
