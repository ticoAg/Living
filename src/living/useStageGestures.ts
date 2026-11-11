import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Shortest horizontal travel that counts as a swipe, in px. */
const SWIPE_MIN = 48;

/**
 * Pointer handlers for the picture: a tap toggles the controls, a quick horizontal swipe (touch or pen) changes
 * photo. The click that ends a swipe is swallowed so it does not also toggle the controls.
 */
export function useStageGestures(go: (delta: number) => void, toggleControls: () => void) {
  const swipe = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      swiped.current = false;
      swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - s.t < 900) {
        swiped.current = true;
        go(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel: () => {
      swipe.current = null;
    },
    onClick: () => {
      if (swiped.current) {
        swiped.current = false;
        return;
      }
      toggleControls();
    }
  };
}
