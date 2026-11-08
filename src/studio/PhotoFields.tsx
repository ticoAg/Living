import { useId } from 'react';
import type { GeoPrivacy, Visibility } from '../../shared/types';
import TagPicker from './TagPicker';
import { Seg, Toggle } from './ui';

// The fields shared by the upload details column and the photo editor.

export interface FieldsValue {
  title: string;
  note: string;
  visibility: Visibility;
  geoPrivacy: GeoPrivacy;
  inLiving: boolean;
  favorite: boolean;
}

const VISIBILITY = [
  { value: 'public' as const, label: '公开', hint: '出现在图库、地图和 Living' },
  { value: 'unlisted' as const, label: '仅链接', hint: '只有拿到链接的人能看到' },
  { value: 'private' as const, label: '仅自己', hint: '只有你自己能看到' }
];
const GEO = [
  { value: 'exact' as const, label: '精确', hint: '他人看到原始坐标' },
  { value: 'fuzzy' as const, label: '约 500 m', hint: '他人只看到约 500 米精度的位置' },
  { value: 'hidden' as const, label: '隐藏', hint: '他人看不到位置和地点' }
];

interface Props {
  value: FieldsValue;
  onChange: (patch: Partial<FieldsValue>) => void;
  tags: { value: string[]; suggested?: string[]; onChange: (ids: string[]) => void };
  /** why location precision cannot be changed (photo inside a privacy zone) */
  geoLocked?: string | null;
  disabled?: boolean;
}

export default function PhotoFields({ value, onChange, tags, geoLocked, disabled }: Props) {
  const id = useId();
  return (
    <div className="stack pf" style={{ ['--gap' as string]: '20px' }}>
      <div className="field">
        <label className="label" htmlFor={`${id}-title`}>标题（可不填）</label>
        <input id={`${id}-title`} className="input" value={value.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={120} disabled={disabled} autoComplete="off" />
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-note`}>笔记</label>
        <textarea
          id={`${id}-note`}
          className="textarea"
          value={value.note}
          onChange={(e) => onChange({ note: e.target.value })}
          maxLength={5000}
          rows={4}
          placeholder="写几句：当时的天气、人、路线……"
          disabled={disabled}
        />
        {value.note.length > 4000 && <span className="small muted mono pf-count">{value.note.length} / 5000</span>}
      </div>

      <div className="field">
        <span className="label">标签</span>
        <TagPicker value={tags.value} suggested={tags.suggested} onChange={tags.onChange} disabled={disabled} />
      </div>

      <Seg label="公开范围" value={value.visibility} options={VISIBILITY} onChange={(v) => onChange({ visibility: v })} disabled={disabled} />
      <Seg
        label="位置精度"
        value={value.geoPrivacy}
        options={GEO}
        onChange={(v) => onChange({ geoPrivacy: v })}
        disabled={disabled || !!geoLocked}
        hint={geoLocked ?? '对他人生效，你自己始终看到原值'}
      />

      <div className="pf-toggles">
        <Toggle label="进入 Living" hint="参与全屏轮播" checked={value.inLiving} onChange={(v) => onChange({ inLiving: v })} disabled={disabled} />
        <Toggle label="收藏" checked={value.favorite} onChange={(v) => onChange({ favorite: v })} disabled={disabled} />
      </div>
    </div>
  );
}
