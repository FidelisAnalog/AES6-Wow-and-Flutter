/**
 * usePlotLayout — measures container, controls, and plot area for the tabbed plot card.
 *
 * Returns containerWidth, squareSize (raw plot area width), maxTabHeight, isMobile,
 * plotAreaRef (callback), controlsRef (callback), OVERHEAD.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const OVERHEAD = 78;

export default function usePlotLayout(containerRef, _unused, minimized) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [controlsWidth, setControlsWidth] = useState(0);
  const [plotAreaWidth, setPlotAreaWidth] = useState(0);

  const controlsNodeRef = useRef(null);
  const plotAreaNodeRef = useRef(null);
  const roRef = useRef(null);

  // Single ResizeObserver for all three elements
  useEffect(() => {
    if (minimized) return;
    const handlers = new Map();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = handlers.get(e.target);
        if (h) h(e.contentRect.width);
      }
    });
    roRef.current = ro;

    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
      handlers.set(containerRef.current, (w) => setContainerWidth(w));
      ro.observe(containerRef.current);
    }
    if (controlsNodeRef.current) {
      setControlsWidth(controlsNodeRef.current.clientWidth);
      handlers.set(controlsNodeRef.current, (w) => setControlsWidth(w));
      ro.observe(controlsNodeRef.current);
    }
    if (plotAreaNodeRef.current) {
      setPlotAreaWidth(plotAreaNodeRef.current.clientWidth);
      handlers.set(plotAreaNodeRef.current, (w) => setPlotAreaWidth(w));
      ro.observe(plotAreaNodeRef.current);
    }

    return () => { ro.disconnect(); roRef.current = null; };
  }, [minimized, containerRef]);

  // Callback ref for controls column
  const controlsRef = useCallback((node) => {
    if (controlsNodeRef.current && roRef.current) {
      try { roRef.current.unobserve(controlsNodeRef.current); } catch {}
    }
    controlsNodeRef.current = node;
    if (node) {
      setControlsWidth(node.clientWidth);
      if (roRef.current) roRef.current.observe(node);
    }
  }, []);

  // Callback ref for plot area
  const plotAreaRef = useCallback((node) => {
    if (plotAreaNodeRef.current && roRef.current) {
      try { roRef.current.unobserve(plotAreaNodeRef.current); } catch {}
    }
    plotAreaNodeRef.current = node;
    if (node) {
      setPlotAreaWidth(node.clientWidth);
      if (roRef.current) roRef.current.observe(node);
    } else {
      setPlotAreaWidth(0);
    }
  }, []);

  const isMobile = containerWidth > 0 && containerWidth < 600;

  // Max square: use measured values. containerWidth - controlsWidth is always current.
  // plotAreaWidth may lag, so clamp with container-based bound.
  const containerBound = containerWidth > 0 && controlsWidth > 0
    ? containerWidth - controlsWidth
    : Math.max(200, containerWidth * 0.7);
  const maxPlotSquare = plotAreaWidth > 0
    ? Math.min(plotAreaWidth, containerBound)
    : containerBound;
  const maxTabHeight = maxPlotSquare + OVERHEAD;

  return {
    containerWidth,
    squareSize: plotAreaWidth,
    maxTabHeight,
    isMobile,
    plotAreaRef,
    controlsRef,
    OVERHEAD,
  };
}
