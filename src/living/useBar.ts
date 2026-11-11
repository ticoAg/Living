import { useCallback, useState } from 'react';
import { useAutoHide } from './hooks';

/**
 * Whether the control bar (and the brand line) is showing. It hides after 3 s without activity and comes back on
 * pointer movement, a key, or a tap on the picture. It stays up while `hold` (paused, drawer open, nothing to play),
 * while the pointer is over the bar, and while keyboard focus is inside it.
 */
export function useBar(hold: boolean) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = hold || hover || focus;
  const ui = useAutoHide(held);
  /** Controls' onEngage: the pointer is over the bar, or keyboard focus is inside it */
  const onEngage = useCallback((kind: 'pointer' | 'focus', on: boolean) => (kind === 'pointer' ? setHover(on) : setFocus(on)), []);
  return { shown: ui.visible || held, poke: ui.poke, toggle: ui.toggle, onEngage };
}
