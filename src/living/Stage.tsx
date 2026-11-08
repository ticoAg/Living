import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PhotoSummary } from '../../shared/types';
import Img from '../components/Img';
import { useLatest } from './hooks';
import { STAGE_SIZES } from './preload';
import type { Fit, Fx } from './settings';

/** Crossfade length. Matches the spec: fade = 1.4 s. */
export const FADE_MS = 1400;
/** A photo that has not loaded after this long is shown anyway. */
const READY_TIMEOUT_MS = 5000;
/** Layers kept at once: the current photo plus those still fading out. */
const MAX_LAYERS = 3;

interface LayerRec {
  photo: PhotoSummary;
  z: number;
  /** the image has loaded, so the layer may fade in */
  ready: boolean;
  /** leaving: fading out underneath the newer photo */
  out: boolean;
}
interface StageState {
  id: string | null;
  z: number;
  layers: LayerRec[];
}

/**
 * Next layer stack when the current photo changes. The previous photo stays fully visible until the
 * new one has loaded (see `markReady`), so a slow image never flashes black. A photo that is still
 * fading out comes straight back if it is shown again, keeping its place in the animation.
 */
function advance(st: StageState, photo: PhotoSummary | null): StageState {
  if (!photo) return { id: null, z: st.z, layers: st.layers.map((l) => ({ ...l, out: true })) };
  const z = st.z + 1;
  const existing = st.layers.find((l) => l.photo.id === photo.id);
  // Layers that never became visible are dropped; they have nothing to fade.
  let layers = st.layers.filter((l) => l.ready && l !== existing);
  if (existing?.ready) {
    layers = [...layers.map((l) => ({ ...l, out: true })), { ...existing, z, out: false }];
  } else {
    layers = [...layers, { photo, z, ready: false, out: false }];
  }
  if (layers.length > MAX_LAYERS) layers = [...layers].sort((a, b) => b.z - a.z).slice(0, MAX_LAYERS);
  return { id: photo.id, z, layers: layers.sort((a, b) => (a.photo.id < b.photo.id ? -1 : 1)) };
}

/** The photo `id` has loaded: show it and send everything else away. */
function markReady(st: StageState, id: string, cut: boolean): StageState {
  const layer = st.layers.find((l) => l.photo.id === id);
  if (!layer || layer.ready) return st;
  const layers = st.layers
    .filter((l) => !(cut && l.photo.id !== id && l.ready))
    .map((l) => (l.photo.id === id ? { ...l, ready: true, out: false } : l.ready ? { ...l, out: true } : l));
  return { ...st, layers };
}

interface Props {
  photo: PhotoSummary | null;
  fit: Fit;
  /** effective transition (drift already replaced by fade under reduced motion) */
  fx: Fx;
  everySec: number;
  /** freeze the slow zoom while paused */
  paused: boolean;
  /** a photo finished loading and is now on screen */
  onShown?: () => void;
  /** a photo's image could not be loaded */
  onBroken?: (id: string) => void;
}

/** Two (briefly three) stacked layers keyed by photo id; the newest is on top. */
export default function Stage({ photo, fit, fx, everySec, paused, onShown, onBroken }: Props) {
  const [st, setSt] = useState<StageState>({ id: null, z: 0, layers: [] });
  const id = photo?.id ?? null;
  if (st.id !== id) setSt(advance(st, photo));

  const fxRef = useRef(fx);
  useLayoutEffect(() => {
    fxRef.current = fx;
  });
  const onReady = useCallback((photoId: string) => setSt((s) => markReady(s, photoId, fxRef.current === 'cut')), []);
  const shownRef = useLatest(onShown);
  const brokenRef = useLatest(onBroken);
  const onLoaded = useCallback(
    (photoId: string) => {
      onReady(photoId);
      shownRef.current?.();
    },
    [onReady, shownRef]
  );
  const onFailed = useCallback((photoId: string) => brokenRef.current?.(photoId), [brokenRef]);

  // Give up waiting for a photo that does not load.
  const waiting = st.layers.find((l) => !l.ready)?.photo.id ?? null;
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => onReady(waiting), READY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [waiting, onReady]);

  // Remove layers once their fade-out has finished (the countdown restarts whenever the set of
  // leaving layers changes, so a layer is never cut short).
  const leaving = st.layers.filter((l) => l.out).map((l) => l.photo.id).join('|');
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setSt((s) => ({ ...s, layers: s.layers.filter((l) => !l.out) })), FADE_MS + 250);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <div className="lv-layers" aria-hidden="true">
      {st.layers.map((l) => (
        <Layer key={l.photo.id} rec={l} fit={fit} fx={fx} everySec={everySec} paused={paused} onLoaded={onLoaded} onFailed={onFailed} />
      ))}
    </div>
  );
}

interface LayerProps {
  rec: LayerRec;
  fit: Fit;
  fx: Fx;
  everySec: number;
  paused: boolean;
  onLoaded: (id: string) => void;
  onFailed: (id: string) => void;
}

function Layer({ rec, fit, fx, everySec, paused, onLoaded, onFailed }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Commit the opacity:0 style once, so that the later change to 1 runs as a transition.
  useLayoutEffect(() => {
    void ref.current?.offsetWidth;
  }, []);

  const { photo } = rec;
  // Img does not report failures, so watch its <img> directly.
  useEffect(() => {
    const img = ref.current?.querySelector('img');
    if (!img) return;
    const fail = () => onFailed(photo.id);
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) fail();
    img.addEventListener('error', fail);
    return () => img.removeEventListener('error', fail);
  }, [photo.id, onFailed]);

  const visible = rec.ready && !rec.out;
  const drift = fx === 'drift';
  // A new zoom length (or turning the zoom on) must restart the animation. Swapping between two
  // identical keyframe names does that without remounting the image.
  const zoomSig = `${drift}:${everySec}`;
  const [zoom, setZoom] = useState({ sig: zoomSig, n: 0 });
  if (zoom.sig !== zoomSig) setZoom({ sig: zoomSig, n: zoom.n + 1 });
  const style = {
    zIndex: rec.z,
    opacity: visible ? 1 : 0,
    '--lv-fade': fx === 'cut' ? '0s' : `${FADE_MS}ms`
  } as CSSProperties;
  const driftStyle = {
    '--lv-drift': `${everySec}s`,
    // zoom towards the subject, not the middle
    transformOrigin: fit === 'cover' && photo.focus ? `${photo.focus[0] * 100}% ${photo.focus[1] * 100}%` : undefined
  } as CSSProperties;

  return (
    <div ref={ref} className="lv-layer" style={style} data-photo={photo.id} data-ready={rec.ready} data-out={rec.out}>
      <div className="lv-drift" data-drift={drift} data-seq={zoom.n % 2} data-paused={paused} style={driftStyle}>
        <Img photo={photo} fit={fit} ratio="fill" sizes={STAGE_SIZES} alt="" eager onLoad={() => onLoaded(photo.id)} />
      </div>
    </div>
  );
}
