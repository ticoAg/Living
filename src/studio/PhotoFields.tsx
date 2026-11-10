import { useId } from 'react';
import { PHOTO_LIMITS } from '../../shared/limits';
import type { GeoPrivacy, Visibility } from '../../shared/types';
import { applyTagEdit } from './tag-board';
import TagPicker from './TagPicker';
import type { SegOption } from './ui';
import { Toggle } from './ui';

// The fields shared by the upload details column and the photo editor, laid out as a compact form: a short label on
// the left of each control, so the whole set fits beside the photo without scrolling.

export interface FieldsValue {
  title: string;
  note: string;
  visibility: Visibility;
  geoPrivacy: GeoPrivacy;
  inLiving: boolean;
  favorite: boolean;
}

export const VISIBILITY: SegOption<Visibility>[] = [
  { value: 'public', label: '公开', hint: '出现在图库、地图和 Living' },
  { value: 'unlisted', label: '仅链接', hint: '只有拿到链接的人能看到' },
  { value: 'private', label: '仅自己', hint: '只有你自己能看到' }
];
export const GEO: SegOption<GeoPrivacy>[] = [
  { value: 'exact', label: '精确', hint: '他人看到原始坐标' },
  { value: 'fuzzy', label: '约 500 m', hint: '他人只看到约 500 米精度的位置' },
  { value: 'hidden', label: '隐藏', hint: '他人看不到位置和地点' }
];

interface Props {
  value: FieldsValue;
  onChange: (patch: Partial<FieldsValue>) => void;
  tags: { value: string[]; onChange: (ids: string[]) => void };
  /** why location precision cannot be changed (photo inside a privacy zone) */
  geoLocked?: string | null;
  /** show the Living and favourite switches (the photo editor does; the upload form keeps their defaults) */
  toggles?: boolean;
  disabled?: boolean;
}

/** A labelled row of segmented buttons; `value` null presses none (photos edited together that differ). */
export function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  note
}: {
  label: string;
  value: T | null;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  note?: string;
}) {
  const id = useId();
  return (
    <div className="pf-row">
      <span className="pf-k" id={id}>
        {label}
      </span>
      <div className="pf-v">
        <div className="seg sf-seg pf-seg" role="group" aria-labelledby={id}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={value === o.value}
              title={o.hint}
              disabled={disabled}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {note && <span className="small muted pf-note">{note}</span>}
      </div>
    </div>
  );
}

export default function PhotoFields({ value, onChange, tags, geoLocked, toggles = true, disabled }: Props) {
  const id = useId();
  return (
    <div className="pf">
      <div className="pf-row">
        <label className="pf-k" htmlFor={`${id}-title`}>
          标题
        </label>
        <div className="pf-v">
          <input
            id={`${id}-title`}
            className="input pf-input"
            value={value.title}
            onChange={(e) => onChange({ title: e.target.value })}
            maxLength={120}
            placeholder="可不填"
            disabled={disabled}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="pf-row pf-top">
        <label className="pf-k" htmlFor={`${id}-note`}>
          笔记
        </label>
        <div className="pf-v">
          <textarea
            id={`${id}-note`}
            className="textarea pf-input"
            value={value.note}
            onChange={(e) => onChange({ note: e.target.value })}
            maxLength={PHOTO_LIMITS.noteMax}
            rows={3}
            placeholder="当时的天气、人、路线……"
            disabled={disabled}
          />
          {value.note.length > 4000 && <span className="small muted mono pf-count">{value.note.length} / 5000</span>}
        </div>
      </div>

      <div className="pf-row pf-top">
        <span className="pf-k">标签</span>
        <div className="pf-v">
          <TagPicker value={tags.value} onEdit={(e) => tags.onChange(applyTagEdit(tags.value, e))} disabled={disabled} />
        </div>
      </div>

      <SegRow
        label="公开"
        value={value.visibility}
        options={VISIBILITY}
        onChange={(v) => onChange({ visibility: v })}
        disabled={disabled}
      />
      <SegRow
        label="位置"
        value={value.geoPrivacy}
        options={GEO}
        onChange={(v) => onChange({ geoPrivacy: v })}
        disabled={disabled || !!geoLocked}
        note={geoLocked ?? undefined}
      />

      {toggles && (
        <div className="pf-row">
          <span className="pf-k" aria-hidden="true" />
          <div className="pf-v pf-toggles">
            <Toggle
              label="进入 Living"
              hint="参与全屏轮播"
              checked={value.inLiving}
              onChange={(v) => onChange({ inLiving: v })}
              disabled={disabled}
            />
            <Toggle label="收藏" checked={value.favorite} onChange={(v) => onChange({ favorite: v })} disabled={disabled} />
          </div>
        </div>
      )}
    </div>
  );
}
