import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Icon } from '../components/icons';
import { swatchFill, type TagNode, type TagTree } from '../lib/tags';
import { EVERY_PRESETS, FIELD_KEYS, type FieldKey, type Fit, type Fx, type Order, type Pos, type Settings, type Size, type Source, type Src } from './settings';

/** An optional part of the source that came with the link: a place, theme, city or user. */
export interface Scope {
  key: 'place' | 'theme' | 'city' | 'user';
  label: string;
  on: boolean;
  onToggle: () => void;
}

export interface TagsState {
  status: 'loading' | 'error' | 'ready';
  tree: TagTree | null;
  /** photos per tag including descendants, over everything the source could play */
  counts: Map<string, number> | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  closeRef: Ref<HTMLButtonElement>;
  source: Source;
  settings: Settings;
  /** changing the source restarts the playlist at its first photo */
  onSource: (patch: Partial<Source>) => void;
  onSettings: (patch: Partial<Settings>) => void;
  /** photos in the current playlist */
  count: number;
  scopes: Scope[];
  tags: TagsState;
  /** the complete link for this configuration */
  link: string;
}

const SRC_OPTIONS: [Src, string][] = [
  ['all', '全部'],
  ['tags', '标签'],
  ['today', '那年今日']
];
const FX_OPTIONS: [Fx, string][] = [
  ['drift', '缓慢推近'],
  ['fade', '淡入淡出'],
  ['cut', '直接切换']
];
const FIT_OPTIONS: [Fit, string][] = [
  ['cover', '铺满'],
  ['contain', '完整']
];
const POS_OPTIONS: [Pos, string][] = [
  ['bl', '左下'],
  ['bc', '居中'],
  ['br', '右下']
];
const SIZE_OPTIONS: [Size, string][] = [
  ['s', '小'],
  ['m', '中'],
  ['l', '大']
];
const FIELD_LABELS: Record<FieldKey, string> = {
  place: '地点',
  title: '标题',
  city: '城市',
  date: '日期',
  time: '时间',
  ago: '距今',
  coord: '坐标',
  heading: '朝向',
  exif: '相机参数',
  tags: '标签'
};

const everyLabel = (s: number) => (s < 60 ? `${s} 秒` : s % 60 === 0 ? `${s / 60} 分` : `${Math.round((s / 60) * 10) / 10} 分`);

function Chip({ on, onClick, className, children }: { on: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={`lv-chip${className ? ` ${className}` : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="lv-row">
      <span id={id} className="lv-row-label">
        {label}
      </span>
      <div className="lv-row-body">{children}</div>
    </div>
  );
}

function Options<T extends string | number | boolean>({ value, options, onPick, className }: { value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void; className?: string }) {
  return (
    <div className="lv-chips">
      {options.map(([v, label]) => (
        <Chip key={String(v)} on={value === v} className={className} onClick={() => onPick(v)}>
          {label}
        </Chip>
      ))}
    </div>
  );
}

const flatten = (node: TagNode, out: TagNode[] = []): TagNode[] => {
  for (const c of node.children) {
    out.push(c);
    flatten(c, out);
  }
  return out;
};

/** Tag chips grouped under their root. Tags nobody used are left out unless already selected. */
function TagPicker({ tags, selected, onToggle }: { tags: TagsState; selected: string[]; onToggle: (id: string) => void }) {
  if (tags.status === 'loading') return <span className="lv-note">载入中…</span>;
  if (tags.status === 'error' || !tags.tree) return <span className="lv-note">标签载入失败</span>;
  const sel = new Set(selected);
  const shown = (n: TagNode) => sel.has(n.id) || (tags.counts ? (tags.counts.get(n.id) ?? 0) > 0 : n.count > 0);
  const chip = (n: TagNode) => (
    <Chip key={n.id} on={sel.has(n.id)} className="lv-chip-tag" onClick={() => onToggle(n.id)}>
      {n.color && <i className="lv-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
      {n.name}
    </Chip>
  );
  const loose = tags.tree.roots.filter((r) => r.children.length === 0 && shown(r));
  const groups = tags.tree.roots
    .filter((r) => r.children.length > 0)
    .map((r) => ({ root: r, chips: flatten(r).filter(shown) }))
    .filter((g) => g.chips.length > 0);
  if (!loose.length && !groups.length) return <span className="lv-note">还没有带标签的照片</span>;
  return (
    <div className="lv-tag-groups" role="group" aria-label="标签">
      {loose.length > 0 && <div className="lv-chips">{loose.map(chip)}</div>}
      {groups.map((g) => (
        <div key={g.root.id} className="lv-tag-group">
          <span className="lv-tag-cap">{g.root.name}</span>
          <div className="lv-chips">{g.chips.map(chip)}</div>
        </div>
      ))}
    </div>
  );
}

/** Right-hand settings drawer (400 px, full width on phones). */
export default function Drawer({ open, onClose, closeRef, source: s, settings: v, onSource, onSettings, count, scopes, tags, link }: Props) {
  const linkRef = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'ok' | 'manual'>('idle');

  // A changed configuration is a new link; forget that the old one was copied.
  useEffect(() => setCopy('idle'), [link]);
  useEffect(() => {
    if (copy === 'idle') return;
    const t = window.setTimeout(() => setCopy('idle'), 3500);
    return () => window.clearTimeout(t);
  }, [copy]);

  const copyLink = () => {
    // Must start inside the click handler: browsers refuse clipboard writes after an await.
    const manual = () => {
      const el = linkRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setCopy('manual');
    };
    try {
      if (!navigator.clipboard?.writeText) return manual();
      navigator.clipboard.writeText(link).then(() => setCopy('ok'), manual);
    } catch {
      manual();
    }
  };

  const toggleField = (k: FieldKey) => {
    const on = v.fields.includes(k);
    onSettings({ fields: FIELD_KEYS.filter((x) => (x === k ? !on : v.fields.includes(x))) });
  };
  const toggleTag = (id: string) => onSource({ tags: s.tags.includes(id) ? s.tags.filter((t) => t !== id) : [...s.tags, id] });
  const pickSrc = (src: Src) => {
    // Leaving a city-only source also lets go of the city, otherwise "全部" would still be filtered.
    onSource({ src, ...(s.src === 'city' ? { city: '' } : {}) });
  };

  const everyOptions: (readonly [number, string])[] = (EVERY_PRESETS as readonly number[]).includes(v.every)
    ? EVERY_PRESETS.map((n) => [n, everyLabel(n)] as const)
    : [...EVERY_PRESETS, v.every].sort((a, b) => a - b).map((n) => [n, everyLabel(n)] as const);

  const orderOptions: (readonly [Order, string])[] = [
    ['shuffle', '随机'],
    ['time', s.src === 'theme' ? '主题顺序' : '按时间']
  ];

  return (
    <aside id="lv-drawer" className="lv-drawer" aria-label="Living 设置" data-open={open} inert={!open}>
      <div className="lv-drawer-head">
        <h2>设置</h2>
        <button ref={closeRef} type="button" className="lv-btn lv-btn-close" aria-label="关闭设置" onClick={onClose}>
          <Icon name="close" size={18} strokeWidth={1.9} />
        </button>
      </div>

      <Row id="lv-row-src" label="来源">
        <div className="lv-chips">
          {SRC_OPTIONS.map(([key, label]) => (
            <Chip key={key} on={s.src === key} onClick={() => pickSrc(key)}>
              {label}
            </Chip>
          ))}
          {scopes.map((sc) => (
            <Chip key={sc.key} on={sc.on} onClick={sc.onToggle}>
              {sc.label}
            </Chip>
          ))}
        </div>
        {s.src === 'tags' && (
          <>
            <TagPicker tags={tags} selected={s.tags} onToggle={toggleTag} />
            <div className="lv-chips" role="group" aria-label="多个标签时">
              <Chip on={s.match === 'any'} onClick={() => onSource({ match: 'any' })}>
                含任一标签
              </Chip>
              <Chip on={s.match === 'all'} onClick={() => onSource({ match: 'all' })}>
                含全部标签
              </Chip>
            </div>
          </>
        )}
        <span className="lv-count" aria-live="polite">
          {count} 张
        </span>
      </Row>

      <Row id="lv-row-order" label="顺序">
        <Options value={s.order} options={orderOptions} onPick={(order) => onSource({ order })} />
      </Row>
      <Row id="lv-row-every" label="间隔">
        <Options value={v.every} options={everyOptions} onPick={(every) => onSettings({ every })} />
      </Row>
      <Row id="lv-row-fx" label="转场">
        <Options value={v.fx} options={FX_OPTIONS} onPick={(fx) => onSettings({ fx })} />
      </Row>
      <Row id="lv-row-fit" label="画面">
        <Options value={v.fit} options={FIT_OPTIONS} onPick={(fit) => onSettings({ fit })} />
      </Row>

      <div className="lv-rule" />

      <Row id="lv-row-fields" label="字段">
        <div className="lv-chips">
          {FIELD_KEYS.map((k) => (
            <Chip key={k} on={v.fields.includes(k)} onClick={() => toggleField(k)}>
              {FIELD_LABELS[k]}
            </Chip>
          ))}
        </div>
      </Row>
      <Row id="lv-row-pos" label="位置">
        <Options value={v.pos} options={POS_OPTIONS} onPick={(pos) => onSettings({ pos })} />
      </Row>
      <Row id="lv-row-size" label="字号">
        <Options value={v.size} options={SIZE_OPTIONS} onPick={(size) => onSettings({ size })} className="lv-chip-narrow" />
      </Row>
      <Row id="lv-row-brief" label="显示">
        <Options
          value={v.brief}
          options={[
            [false, '一直显示'],
            [true, '切换后 6 秒']
          ]}
          onPick={(brief) => onSettings({ brief })}
        />
      </Row>

      <div className="lv-rule" />

      <Row id="lv-row-device" label="设备">
        <div className="lv-chips">
          <Chip on={v.clock} onClick={() => onSettings({ clock: !v.clock })}>
            时钟
          </Chip>
          <Chip on={v.awake} onClick={() => onSettings({ awake: !v.awake })}>
            屏幕常亮
          </Chip>
          <Chip on={v.night} onClick={() => onSettings({ night: !v.night })}>
            夜间调暗
          </Chip>
        </div>
      </Row>

      <div className="lv-row">
        <span className="lv-row-label lv-row-label-top">链接</span>
        <div className="lv-row-body">
          <code ref={linkRef} className="lv-link">
            {link}
          </code>
          <button type="button" className="lv-outline" onClick={copyLink}>
            {copy === 'ok' ? '已复制' : '复制链接'}
          </button>
          <span className="lv-copy-note" role="status">
            {copy === 'manual' ? '请手动复制' : ''}
          </span>
        </div>
      </div>
    </aside>
  );
}
