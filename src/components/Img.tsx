import { useState, type CSSProperties } from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import type { PhotoSummary } from '../../shared/types';
import { mediaUrl } from '../lib/api';

const placeholders = new Map<string, string>();
function placeholder(hash: string | null): string | undefined {
  if (!hash) return undefined;
  let url = placeholders.get(hash);
  if (!url) {
    try {
      url = thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)));
      placeholders.set(hash, url);
    } catch {
      return undefined;
    }
  }
  return url;
}

export type ImgPhoto = Pick<PhotoSummary, 'variants' | 'thumbhash' | 'width' | 'height' | 'title' | 'focus'>;

interface Props {
  photo: ImgPhoto;
  /** `sizes` attribute; defaults suit a 4-column masonry */
  sizes?: string;
  /** `cover` crops to the box (respecting the focus point); `contain` letterboxes */
  fit?: 'cover' | 'contain';
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** load immediately (above the fold, slideshow) */
  eager?: boolean;
  /** box aspect ratio, e.g. '1 / 1'; defaults to the photo's own; 'fill' fills the parent */
  ratio?: string;
  onLoad?: () => void;
  onError?: () => void;
}

/** Responsive photo with a ThumbHash placeholder that fades to the real image. */
export default function Img({ photo, sizes = '(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw', fit = 'cover', alt, className, style, eager, ratio, onLoad, onError }: Props) {
  const [loaded, setLoaded] = useState(false);
  const v = photo.variants;
  const srcSet = `${mediaUrl(v.s.key)} ${v.s.w}w, ${mediaUrl(v.m.key)} ${v.m.w}w, ${mediaUrl(v.l.key)} ${v.l.w}w`;
  const ph = placeholder(photo.thumbhash);
  const box: CSSProperties =
    ratio === 'fill'
      ? { width: '100%', height: '100%' }
      : { aspectRatio: ratio ?? `${photo.width} / ${photo.height}` };
  return (
    <span
      className={`img${className ? ` ${className}` : ''}`}
      style={{ ...box, backgroundImage: ph && fit === 'cover' ? `url(${ph})` : undefined, ...style }}
    >
      <img
        src={mediaUrl(v.m.key)}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt ?? photo.title ?? ''}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        data-loaded={loaded}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        onError={onError}
        style={{
          objectFit: fit,
          objectPosition: photo.focus ? `${photo.focus[0] * 100}% ${photo.focus[1] * 100}%` : undefined
        }}
      />
    </span>
  );
}
