import { useMemo, useRef, useState } from 'react';
import type { DropPos } from './items';

export interface DropTarget {
  key: string;
  pos: DropPos;
}

/**
 * Drag-and-drop ordering of the editor's rows. The row being dragged and the drop marker are state (the rows draw
 * them); refs hold the same values for the drop handler, which may run before a re-render. `onMove` must be stable.
 */
export function useItemDrag(onMove: (fromKey: string, toKey: string, pos: DropPos) => void) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const dragRef = useRef<string | null>(null);
  const overRef = useRef<DropTarget | null>(null);

  const handlers = useMemo(() => {
    const reset = () => {
      dragRef.current = null;
      overRef.current = null;
      setDragKey(null);
      setOver(null);
    };
    return {
      dragStart: (key: string) => {
        dragRef.current = key;
        setDragKey(key);
      },
      dragOver: (key: string, pos: DropPos) => {
        if (overRef.current?.key === key && overRef.current.pos === pos) return;
        overRef.current = { key, pos };
        setOver(overRef.current);
      },
      drop: () => {
        const from = dragRef.current;
        const target = overRef.current;
        if (from && target) onMove(from, target.key, target.pos);
        reset();
      },
      dragEnd: reset
    };
  }, [onMove]);

  return { dragKey, over, handlers };
}
