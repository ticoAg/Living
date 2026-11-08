import { CategoryIcon } from '../components/icons';
import type { CaptionData } from './captionText';
import type { Pos, Size } from './settings';

interface Props {
  data: CaptionData;
  /** re-keys the block so the text fades in with every new photo */
  photoId: string;
  /** false while the fields are hidden (I key, or after the 6 s of "切换后 6 秒") */
  visible: boolean;
  pos: Pos;
  size: Size;
  /** the control bar is up, so the caption sits above it */
  barUp: boolean;
  /** fade the text in on each photo (not for direct cuts) */
  animate: boolean;
}

/** Place in large spaced serif with its category symbol, then title, mono meta, coordinates, camera and tags. */
export default function Caption({ data, photoId, visible, pos, size, barUp, animate }: Props) {
  return (
    <div className="lv-caption" data-pos={pos} data-size={size} data-bar={barUp ? 'up' : 'down'} data-visible={visible}>
      <div key={photoId} className="lv-caption-body" data-animate={animate}>
        {data.big && (
          <span className="lv-cap-big">
            {data.icon && <CategoryIcon category={data.icon} size={26} strokeWidth={1.5} style={{ flexShrink: 0 }} />}
            <span>{data.big}</span>
          </span>
        )}
        {data.sub && <span className="lv-cap-sub">{data.sub}</span>}
        {data.meta.length > 0 && (
          <span className="lv-cap-meta">
            {data.meta.map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </span>
        )}
        {data.geo.length > 0 && (
          <span className="lv-cap-geo">
            {data.geo.map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </span>
        )}
        {data.exif && <span className="lv-cap-geo">{data.exif}</span>}
        {data.tags && <span className="lv-cap-tags">{data.tags}</span>}
      </div>
    </div>
  );
}
