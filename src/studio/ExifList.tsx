import { compass, fmtLat, fmtLng } from '../../shared/geo';
import { fmtBytes, fmtStamp } from './util';

export interface ExifView {
  takenAt: string | null;
  tz: string | null;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  heading: number | null;
  camera: string | null;
  lens: string | null;
  focal: number | null;
  focal35: number | null;
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
}

const trim = (n: number) => String(Number(n.toFixed(1)));

/** Compact capture summary: only what the file actually carries, plus an explicit "无" for time and position. */
export default function ExifList({ x }: { x: ExifView }) {
  const rows: [string, string | null, boolean?][] = [
    ['拍摄时间', x.takenAt ? `${fmtStamp(x.takenAt)}${x.tz ? ` (${x.tz})` : ''}` : null, true],
    ['坐标', x.lat != null && x.lng != null ? `${fmtLat(x.lat)} ${fmtLng(x.lng)}` : null, true],
    ['海拔', x.alt != null ? `${Math.round(x.alt)} m` : null],
    ['朝向', x.heading != null ? `${compass(x.heading)} ${Math.round(x.heading)}°` : null],
    ['相机', x.camera],
    ['镜头', x.lens],
    ['焦距', x.focal != null ? `${trim(x.focal)} mm${x.focal35 != null ? `（等效 ${trim(x.focal35)} mm）` : ''}` : null],
    ['光圈', x.aperture != null ? `f/${trim(x.aperture)}` : null],
    ['快门', x.shutter],
    ['ISO', x.iso != null ? String(x.iso) : null],
    ['尺寸', x.width && x.height ? `${x.width} × ${x.height}${x.bytes ? ` · ${fmtBytes(x.bytes)}` : ''}` : null]
  ];
  return (
    <dl className="ex">
      {rows
        .filter(([, v, always]) => v != null || always)
        .map(([k, v]) => (
          <div key={k} className="ex-row">
            <dt>{k}</dt>
            <dd className={v == null ? 'muted' : 'mono'}>{v ?? '无'}</dd>
          </div>
        ))}
    </dl>
  );
}
