import { useEffect, useRef, useState, type ComponentProps } from 'react';
import MapView from '../components/MapView';
import type { MapViewport } from './mapfit';

// MapView takes its starting view when it is created. To move to another view (another city) without
// the map area going blank while a fresh map loads its style and tiles, the new map is built on top of
// the old one, invisible, and faded in once it has drawn its markers; then the old one is dropped.

type MapProps = Omit<ComponentProps<typeof MapView>, 'center' | 'zoom' | 'fit' | 'className' | 'style'>;

interface Layer {
  id: number;
  key: string;
  viewport: MapViewport | null;
}

const READY_POLL_MS = 100;
const GIVE_UP_MS = 6000;
const FADE_MS = 260;

export default function SwapMap({ viewKey, viewport, ...props }: MapProps & { viewKey: string; viewport: MapViewport | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, key: viewKey, viewport }]);
  const [fading, setFading] = useState(false);
  const newest = layers[layers.length - 1];

  // another view key: build a second map (its viewport is captured now, with the key)
  useEffect(() => {
    setLayers((ls) => {
      const last = ls[ls.length - 1];
      return last.key === viewKey ? ls : [...ls.slice(-1), { id: last.id + 1, key: viewKey, viewport }];
    });
    setFading(false);
    // `viewport` travels with the key; later changes to it must not rebuild the map
  }, [viewKey]);

  // when the newest map shows its markers, fade it in, then retire the older map
  const stacked = layers.length > 1;
  useEffect(() => {
    if (!stacked) return;
    const start = Date.now();
    let fade: ReturnType<typeof setTimeout> | undefined;
    const poll = setInterval(() => {
      const drawn = box.current?.querySelector(`[data-layer="${newest.id}"] .map-pt`);
      if (!drawn && Date.now() - start < GIVE_UP_MS) return;
      clearInterval(poll);
      setFading(true);
      fade = setTimeout(() => setLayers((ls) => ls.slice(-1)), FADE_MS);
    }, READY_POLL_MS);
    return () => {
      clearInterval(poll);
      if (fade) clearTimeout(fade);
    };
  }, [stacked, newest.id]);

  return (
    <div ref={box} className="swapmap">
      {layers.map((l, i) => {
        const top = i === layers.length - 1;
        const pending = stacked && top && !fading;
        return (
          // the outgoing map and the not-yet-shown incoming one take no focus and are hidden from assistive tech
          <div
            key={l.id}
            className="swapmap-layer"
            data-layer={l.id}
            data-pending={pending ? 'true' : undefined}
            inert={!top || pending ? true : undefined}
          >
            <MapView
              {...props}
              className="swapmap-frame"
              fit={false}
              foldAttribution={false}
              center={l.viewport?.center}
              zoom={l.viewport?.zoom ?? 11}
            />
          </div>
        );
      })}
    </div>
  );
}
