import type { PhotoSummary } from '../../shared/types';
import { mediaUrl } from '../lib/api';

/** The `sizes` hint of the slideshow: the picture always spans the viewport. */
export const STAGE_SIZES = '100vw';

/**
 * Start downloading a photo before it is shown. The element mirrors what `<Img sizes="100vw">`
 * renders (same srcset, same sizes, same fallback), so the browser picks the same candidate and the
 * real image is served from cache.
 */
export function preloadPhoto(photo: PhotoSummary): HTMLImageElement {
  const v = photo.variants;
  const img = new Image();
  img.sizes = STAGE_SIZES;
  img.srcset = `${mediaUrl(v.s.key)} ${v.s.w}w, ${mediaUrl(v.m.key)} ${v.m.w}w, ${mediaUrl(v.l.key)} ${v.l.w}w`;
  img.src = mediaUrl(v.m.key);
  return img;
}
