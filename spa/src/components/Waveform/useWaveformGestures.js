/**
 * Zoom/pan gesture state machine — adapted from Browser-ABX Waveform.
 *
 * Gesture state: 'idle' | 'wheel' | 'pinch' | 'overviewDrag' | 'handleDrag' | 'scroll' | 'waveformPan'
 * Single enum prevents conflicting interactions.
 *
 * Input methods:
 * - Ctrl+scroll / trackpad pinch → zoom centered on cursor
 * - Shift+scroll → horizontal pan
 * - Unmodified horizontal scroll → pan (when zoomed)
 * - Mouse drag on waveform → pan (touch uses native scroll)
 * - Touch pinch → zoom
 * - Double-click → reset to full view
 * - Keyboard: +/- zoom, 0 reset, Shift+Arrow pan
 *
 * Native scroll wrapper provides iOS momentum — no custom momentum math.
 */

import { useRef, useEffect, useCallback } from 'react';

const MIN_VIEW_DURATION = 0.05; // 50ms minimum visible range
const ZOOM_FACTOR = 0.008;      // zoom sensitivity for wheel events
const PAN_FACTOR = 0.25;        // pan by 25% of view width per Shift+scroll step
const EPSILON = 0.001;

function isViewZoomed(vs, ve, dur) {
  return vs > EPSILON || ve < dur - EPSILON;
}

/**
 * @param {object} params
 * @param {React.RefObject} params.containerRef - main waveform container
 * @param {React.RefObject} params.scrollRef - scrollable wrapper
 * @param {number} params.viewStart
 * @param {number} params.viewEnd
 * @param {number} params.totalDuration
 * @param {number} params.containerWidth
 * @param {(start: number, end: number) => void} params.onViewChange
 * @param {React.MutableRefObject} params.gestureRef - shared gesture state
 */
export default function useWaveformGestures({
  containerRef,
  scrollRef,
  viewStart,
  viewEnd,
  totalDuration,
  containerWidth,
  onViewChange,
  gestureRef,
  hasData = false,
}) {
  // Mutable refs for latest values (avoid stale closures)
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewEndRef = useRef(viewEnd);
  viewEndRef.current = viewEnd;
  const durationRef = useRef(totalDuration);
  durationRef.current = totalDuration;
  const widthRef = useRef(containerWidth);
  widthRef.current = containerWidth;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const scrollCausedViewChangeRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const panDragRef = useRef({ startX: null, moved: false, viewStart: 0, viewEnd: 0 });
  const pinchRef = useRef(null);

  // --- Zoom/pan helpers ---

  const setUserView = useCallback((newStart, newEnd) => {
    onViewChangeRef.current?.(newStart, newEnd);
  }, []);

  const applyZoom = useCallback((delta, centerX) => {
    const dur = durationRef.current;
    if (dur <= 0) return;

    const vs = viewStartRef.current;
    const ve = viewEndRef.current;
    const viewDur = ve - vs;
    const w = widthRef.current;

    const centerTime = w > 0 ? vs + (centerX / w) * viewDur : (vs + ve) / 2;
    const scale = Math.exp(delta * ZOOM_FACTOR);
    const newViewDur = Math.max(MIN_VIEW_DURATION, Math.min(dur, viewDur * scale));

    const ratio = w > 0 ? centerX / w : 0.5;
    let newStart = centerTime - newViewDur * ratio;
    let newEnd = centerTime + newViewDur * (1 - ratio);

    if (newStart < 0) { newStart = 0; newEnd = Math.min(newViewDur, dur); }
    if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - newViewDur); }

    setUserView(newStart, newEnd);
  }, [setUserView]);

  const applyPan = useCallback((deltaFraction) => {
    const dur = durationRef.current;
    const vs = viewStartRef.current;
    const ve = viewEndRef.current;
    const viewDur = ve - vs;
    const shift = viewDur * deltaFraction;

    let newStart = vs + shift;
    let newEnd = ve + shift;

    if (newStart < 0) { newStart = 0; newEnd = viewDur; }
    if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - viewDur); }

    setUserView(newStart, newEnd);
  }, [setUserView]);

  const resetZoom = useCallback(() => {
    setUserView(0, durationRef.current);
  }, [setUserView]);

  // --- Wheel event handler (zoom + pan) ---

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let gestureEndTimer = null;
    let lastGestureScale = 1;
    // Direction lock — don't preventDefault during detection phase.
    // Native scroll handles vertical naturally. scrollRef's handleScroll
    // is suppressed via gestureRef='detecting' so deltaX noise doesn't pan.
    // Only once horizontal is confirmed do we preventDefault and take control.
    let scrollAxis = null; // 'h' | 'v' | null
    let axisTimer = null;
    let accumX = 0;
    let accumY = 0;
    const AXIS_TIMEOUT = 300;
    const H_LOCK = 6;           // px accumX must lead accumY to lock horizontal


    const startWheelGesture = () => {
      gestureRef.current = 'wheel';
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        if (gestureRef.current === 'wheel') gestureRef.current = 'idle';
      }, 150);
    };

    const resetAxis = () => {
      // console.log(`[wf] === RESET (was axis:${scrollAxis ?? 'null'} accX:${accumX.toFixed(1)} accY:${accumY.toFixed(1)}) ===`);
      scrollAxis = null;
      accumX = 0;
      accumY = 0;
      if (gestureRef.current === 'detecting') gestureRef.current = 'idle';
    };

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+scroll or trackpad pinch → zoom
        e.preventDefault();
        startWheelGesture();
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        applyZoom(e.deltaY, x);
      } else if (e.shiftKey) {
        // Shift+scroll → horizontal pan (proportional to scroll amount)
        e.preventDefault();
        startWheelGesture();
        const delta = e.deltaX || e.deltaY;
        applyPan(delta / 500);
      } else {
        // Reset axis lock timer on every event
        if (axisTimer) clearTimeout(axisTimer);
        axisTimer = setTimeout(resetAxis, AXIS_TIMEOUT);

        // Accumulate continuously
        accumX += Math.abs(e.deltaX);
        accumY += Math.abs(e.deltaY);

        const prevAxis = scrollAxis;

        if (scrollAxis === 'h') {
          // Locked horizontal — always prevent default to block browser back/forward
          e.preventDefault();
          const vs = viewStartRef.current;
          const ve = viewEndRef.current;
          const dur = durationRef.current;
          if (isViewZoomed(vs, ve, dur)) {
            startWheelGesture();
            applyPan(e.deltaX / 500);
          }
        } else if (scrollAxis === 'v') {
          // Locked vertical — do nothing, native scroll handles it
        } else {
          // Undecided — suppress scrollRef's handleScroll so deltaX noise doesn't pan.
          // Always preventDefault horizontal-dominant events to block browser back/forward.
          gestureRef.current = 'detecting';
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
          }

          // Try to lock
          if (accumX > accumY + H_LOCK) {
            scrollAxis = 'h';
            // Immediately handle this event as horizontal
            e.preventDefault();
            const vs = viewStartRef.current;
            const ve = viewEndRef.current;
            const dur = durationRef.current;
            if (isViewZoomed(vs, ve, dur)) {
              startWheelGesture();
              applyPan(e.deltaX / 500);
            }
          } else if (accumY > accumX) {
            // Y leads at all → lock vertical, native scroll is already handling it
            scrollAxis = 'v';
            gestureRef.current = 'idle';
          }
          // else: keep accumulating, native scroll passes through
        }

        // Diagnostic logging (commented out — re-enable for gesture debugging)
        // const locked = scrollAxis !== prevAxis && scrollAxis !== null;
        // console.log(
        //   `[wf] dX:${e.deltaX.toFixed(1)} dY:${e.deltaY.toFixed(1)} | ` +
        //   `accX:${accumX.toFixed(1)} accY:${accumY.toFixed(1)} | ` +
        //   `axis:${scrollAxis ?? 'null'}${locked ? ' ←LOCK' : ''} | ` +
        //   `pd:${e.defaultPrevented} gesture:${gestureRef.current}`
        // );
      }
    };

    // Safari gesture events for trackpad pinch.
    // gesturestart fires for ALL two-finger trackpad interactions (scroll too).
    // Only preventDefault when scale changes (real pinch), otherwise native
    // vertical scroll is blocked.
    let gestureIsPinch = false;

    const handleGestureStart = (e) => {
      lastGestureScale = e.scale;
      gestureIsPinch = false;
    };

    const handleGestureChange = (e) => {
      const scaleDelta = Math.abs(e.scale - lastGestureScale);
      if (scaleDelta > 0.01) gestureIsPinch = true;
      if (!gestureIsPinch) return;

      e.preventDefault();
      // pinch overrides any scroll
      startWheelGesture();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const delta = -(e.scale - lastGestureScale) * 100;
      lastGestureScale = e.scale;
      applyZoom(delta, x);
    };

    const handleGestureEnd = () => {
      lastGestureScale = 1;
      gestureIsPinch = false;
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      if (gestureRef.current === 'wheel') gestureRef.current = 'idle';
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('gesturestart', handleGestureStart, { passive: false });
    el.addEventListener('gesturechange', handleGestureChange, { passive: false });
    el.addEventListener('gestureend', handleGestureEnd, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      if (axisTimer) clearTimeout(axisTimer);
    };
  }, [applyZoom, applyPan, containerRef, gestureRef, hasData]);

  // --- Touch pinch-to-zoom ---

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let initialDistance = 0;
    let initialViewStart = 0;
    let initialViewEnd = 0;
    let pinchActive = false;
    let gestureEndTimer = null;

    const getDistance = (t1, t2) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const getMidX = (t1, t2, rect) =>
      ((t1.clientX + t2.clientX) / 2) - rect.left;

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        pinchActive = true;
        gestureRef.current = 'pinch';
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialViewStart = viewStartRef.current;
        initialViewEnd = viewEndRef.current;
      }
    };

    const handleTouchMove = (e) => {
      if (!pinchActive || e.touches.length !== 2) return;
      const newDist = getDistance(e.touches[0], e.touches[1]);
      const scale = initialDistance / newDist;
      const rect = el.getBoundingClientRect();
      const midX = getMidX(e.touches[0], e.touches[1], rect);
      const dur = durationRef.current;
      const w = widthRef.current;

      const initialViewDur = initialViewEnd - initialViewStart;
      const newViewDur = Math.max(MIN_VIEW_DURATION, Math.min(dur, initialViewDur * scale));
      const centerTime = w > 0
        ? initialViewStart + (midX / w) * initialViewDur
        : (initialViewStart + initialViewEnd) / 2;

      const ratio = w > 0 ? midX / w : 0.5;
      let newStart = centerTime - newViewDur * ratio;
      let newEnd = centerTime + newViewDur * (1 - ratio);

      if (newStart < 0) { newStart = 0; newEnd = Math.min(newViewDur, dur); }
      if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - newViewDur); }

      setUserView(newStart, newEnd);
    };

    const handleTouchEnd = () => {
      if (!pinchActive) return;
      pinchActive = false;
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        if (gestureRef.current === 'pinch') gestureRef.current = 'idle';
      }, 150);
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
    };
  }, [setUserView, containerRef, gestureRef, hasData]);

  // --- Native scroll → view sync (touch pan with iOS momentum) ---

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let gestureEndTimer = null;

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      if (gestureRef.current === 'overviewDrag' || gestureRef.current === 'detecting') return;
      const dur = durationRef.current;
      const vs = viewStartRef.current;
      const ve = viewEndRef.current;
      const viewDur = ve - vs;
      const w = widthRef.current;
      if (dur <= 0 || w <= 0 || viewDur >= dur - EPSILON) return;

      const spacerW = w * (dur / viewDur);
      const maxScroll = spacerW - w;
      if (maxScroll <= 0) return;

      const scrollLeft = el.scrollLeft;
      const newStart = (scrollLeft / maxScroll) * (dur - viewDur);
      const newEnd = newStart + viewDur;

      scrollCausedViewChangeRef.current = true;
      gestureRef.current = 'scroll';
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        if (gestureRef.current === 'scroll') gestureRef.current = 'idle';
      }, 150);

      setUserView(
        Math.max(0, Math.min(newStart, dur - viewDur)),
        Math.max(viewDur, Math.min(newEnd, dur))
      );
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
    };
  }, [setUserView, scrollRef, gestureRef, containerWidth, hasData]);

  // --- Waveform pointer handlers: drag-to-pan (mouse only, touch uses native scroll) ---
  // Attached to scrollRef (inside scroll wrapper), NOT containerRef.
  // Handle overlays sit outside the scroll wrapper on containerRef —
  // keeping pan handlers on scrollRef prevents pointer event conflicts
  // (same pattern as Browser-ABX where pan is on the SVG, not the container).

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handlePointerDown = (e) => {
      if (gestureRef.current === 'handleDrag') return;
      if (e.button !== 0) return;
      // Don't capture for touch — let browser handle native scroll
      if (e.pointerType !== 'touch') {
        e.target.setPointerCapture(e.pointerId);
      }
      panDragRef.current = {
        startX: e.clientX,
        moved: false,
        viewStart: viewStartRef.current,
        viewEnd: viewEndRef.current,
      };
    };

    const handlePointerMove = (e) => {
      const pd = panDragRef.current;
      if (pd.startX == null) return;
      const dx = e.clientX - pd.startX;
      if (!pd.moved && Math.abs(dx) > 3) {
        pd.moved = true;
      }
      // Mouse drag-to-pan (touch uses native scroll instead)
      if (pd.moved && e.pointerType !== 'touch') {
        const w = widthRef.current;
        const dur = durationRef.current;
        if (w > 0 && dur > 0) {
          const origViewDur = pd.viewEnd - pd.viewStart;
          const dTime = -(dx / w) * origViewDur;
          let newStart = pd.viewStart + dTime;
          let newEnd = pd.viewEnd + dTime;
          if (newStart < 0) { newStart = 0; newEnd = origViewDur; }
          if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - origViewDur); }
          gestureRef.current = 'waveformPan';
          el.style.cursor = 'grabbing';
          setUserView(newStart, newEnd);
        }
      }
    };

    const handlePointerUp = () => {
      const pd = panDragRef.current;
      if (pd.startX == null) return;
      if (pd.moved) {
        el.style.cursor = '';
        if (gestureRef.current === 'waveformPan') gestureRef.current = 'idle';
      }
      pd.startX = null;
    };

    // Double-click: reset to full view
    const handleDblClick = () => {
      resetZoom();
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);
    el.addEventListener('dblclick', handleDblClick);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
      el.removeEventListener('dblclick', handleDblClick);
    };
  }, [setUserView, resetZoom, scrollRef, gestureRef, hasData]);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const w = widthRef.current;
        applyZoom(-30, w / 2);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        const w = widthRef.current;
        applyZoom(30, w / 2);
        return;
      }
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        resetZoom();
        return;
      }
      if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        applyPan(-PAN_FACTOR);
        return;
      }
      if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        applyPan(PAN_FACTOR);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [applyZoom, applyPan, resetZoom]);

  // Toolbar-friendly zoom functions
  const zoomIn = useCallback(() => {
    const w = widthRef.current;
    applyZoom(-30, w / 2);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    const w = widthRef.current;
    applyZoom(30, w / 2);
  }, [applyZoom]);

  // Zoom state for toolbar button disabled states
  const vs = viewStartRef.current;
  const ve = viewEndRef.current;
  const dur = durationRef.current;
  const zoomed = isViewZoomed(vs, ve, dur);
  const viewDur = ve - vs;
  const maxZoom = viewDur <= MIN_VIEW_DURATION + EPSILON;

  return {
    scrollCausedViewChangeRef,
    programmaticScrollRef,
    zoomIn,
    zoomOut,
    resetZoom,
    isZoomed: zoomed,
    isMaxZoom: maxZoom,
  };
}
