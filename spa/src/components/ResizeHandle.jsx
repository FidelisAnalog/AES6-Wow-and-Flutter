/**
 * useResizableHeight — hook that makes a container vertically resizable
 * via a visible handle bar at the bottom.
 *
 * Returns { plotHeight, setPlotHeight, ResizeBar }.
 * Render <ResizeBar /> as the last child inside the Paper/container.
 * Double-click the bar to reset to default height.
 * Height persists to localStorage.
 */

import { useRef, useState, useCallback, useMemo } from 'react';
import { Box } from '@mui/material';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 800;
const BAR_HEIGHT = 10;

/** Standalone component — must be defined outside the hook for stable identity. */
function ResizeBarComponent({ onPointerDown, onDoubleClick }) {
  return (
    <Box
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      sx={{
        width: '100%',
        height: BAR_HEIGHT,
        cursor: 'ns-resize',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        '&:hover > div, &:active > div': {
          opacity: 0.6,
        },
      }}
    >
      <Box sx={{
        width: 40,
        height: 3,
        borderRadius: 1.5,
        bgcolor: 'text.disabled',
        opacity: 0.3,
        transition: 'opacity 0.15s',
      }} />
    </Box>
  );
}

/**
 * @param {string} storageKey - localStorage key
 * @param {number} defaultHeight - fallback height
 * @param {number} [maxHeight] - optional max height override (default 800)
 * @returns {{ plotHeight, setPlotHeight, ResizeBar }}
 */
export default function useResizableHeight(storageKey, defaultHeight, maxHeight) {
  const maxRef = useRef(maxHeight ?? MAX_HEIGHT);
  maxRef.current = maxHeight ?? MAX_HEIGHT;

  const [plotHeight, setPlotHeight] = useState(() => {
    try {
      const val = localStorage.getItem(storageKey);
      if (val) {
        const n = parseInt(val, 10);
        if (n >= MIN_HEIGHT && n <= maxRef.current) return n;
      }
    } catch {}
    return defaultHeight;
  });

  const dragRef = useRef({ active: false, startY: 0, startHeight: 0 });
  const heightRef = useRef(plotHeight);
  heightRef.current = plotHeight;

  const TOUCH_DWELL_MS = 200;

  const handlePointerDown = useCallback((e) => {
    const startY = e.clientY;
    const startHeight = heightRef.current;
    const target = e.target;
    const isTouch = e.pointerType === 'touch';
    let dragging = false;
    let dwellPassed = !isTouch; // mouse skips dwell
    let dwellTimer = null;
    let cancelled = false;

    if (isTouch) {
      dwellTimer = setTimeout(() => { dwellPassed = true; }, TOUCH_DWELL_MS);
    }

    const onMove = (ev) => {
      if (cancelled) return;
      const dy = ev.clientY - startY;
      // Touch: if moved before dwell, cancel — let page scroll
      if (isTouch && !dwellPassed && Math.abs(dy) > 3) {
        cancelled = true;
        clearTimeout(dwellTimer);
        cleanup();
        return;
      }
      if (!dwellPassed) return;
      if (!dragging && Math.abs(dy) < 3) return;
      if (!dragging) {
        dragging = true;
        target.setPointerCapture(e.pointerId);
      }
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxRef.current, startHeight + dy));
      setPlotHeight(newHeight);
    };

    const cleanup = () => {
      if (dragging) {
        try { localStorage.setItem(storageKey, String(Math.round(heightRef.current))); } catch {}
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      clearTimeout(dwellTimer);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
  }, [storageKey]);

  const handleDoubleClick = useCallback(() => {
    setPlotHeight(defaultHeight);
    try { localStorage.setItem(storageKey, String(defaultHeight)); } catch {}
  }, [storageKey, defaultHeight]);

  const ResizeBar = useMemo(() => {
    return function StableResizeBar() {
      return <ResizeBarComponent onPointerDown={handlePointerDown} onDoubleClick={handleDoubleClick} />;
    };
  }, [handlePointerDown, handleDoubleClick]);

  return { plotHeight, setPlotHeight, ResizeBar };
}
