/**
 * useResizableHeight — hook that makes a container's bottom edge draggable
 * for vertical resizing, like an OS window border.
 *
 * Attach the returned props to the Paper/container element.
 * The bottom 6px acts as the resize zone (ns-resize cursor).
 * Double-click the border to reset to default height.
 * Height persists to localStorage.
 */

import { useRef, useState, useCallback } from 'react';

const EDGE_ZONE = 6; // px from bottom border that triggers resize cursor
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

/**
 * @param {string} storageKey - localStorage key
 * @param {number} defaultHeight - fallback height
 * @returns {{ plotHeight, containerProps }}
 */
export default function useResizableHeight(storageKey, defaultHeight) {
  const [plotHeight, setPlotHeight] = useState(() => {
    try {
      const val = localStorage.getItem(storageKey);
      if (val) {
        const n = parseInt(val, 10);
        if (n >= MIN_HEIGHT && n <= MAX_HEIGHT) return n;
      }
    } catch {}
    return defaultHeight;
  });

  const dragRef = useRef({ active: false, startY: 0, startHeight: 0 });
  const containerElRef = useRef(null);

  const isInEdgeZone = useCallback((e) => {
    const el = containerElRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return e.clientY >= rect.bottom - EDGE_ZONE;
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (!isInEdgeZone(e)) return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, startY: e.clientY, startHeight: plotHeight };
  }, [plotHeight, isInEdgeZone]);

  const handlePointerMove = useCallback((e) => {
    // Update cursor based on edge zone
    const el = containerElRef.current;
    if (el && !dragRef.current.active) {
      el.style.cursor = isInEdgeZone(e) ? 'ns-resize' : '';
    }

    if (!dragRef.current.active) return;
    const dy = e.clientY - dragRef.current.startY;
    const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startHeight + dy));
    setPlotHeight(newHeight);
  }, [isInEdgeZone]);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current.active) return;
    const newHeight = plotHeight;
    dragRef.current = { active: false, startY: 0, startHeight: 0 };
    try { localStorage.setItem(storageKey, String(Math.round(newHeight))); } catch {}
  }, [storageKey, plotHeight]);

  const handleDoubleClick = useCallback((e) => {
    if (!isInEdgeZone(e)) return;
    setPlotHeight(defaultHeight);
    try { localStorage.setItem(storageKey, String(defaultHeight)); } catch {}
  }, [storageKey, defaultHeight, isInEdgeZone]);

  const containerProps = {
    ref: containerElRef,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onDoubleClick: handleDoubleClick,
  };

  return { plotHeight, setPlotHeight, containerProps };
}
