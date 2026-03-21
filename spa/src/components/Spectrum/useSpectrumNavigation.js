/**
 * Log-frequency zoom/pan gesture state machine — adapted from useWaveformGestures.
 *
 * All zoom/pan math operates in log10(Hz) space.
 * Native scroll wrapper provides iOS momentum — no custom momentum math.
 *
 * Input methods:
 * - Ctrl+scroll / trackpad pinch → zoom centered on cursor
 * - Shift+scroll → horizontal pan
 * - Unmodified horizontal scroll → pan (when zoomed)
 * - Mouse drag on plot → pan (touch uses native scroll)
 * - Touch pinch → zoom
 * - Double-click → reset to full view
 * - Keyboard: +/- zoom, 0 reset, Shift+Arrow pan
 */

import { useRef, useEffect, useCallback } from 'react';
import { SPECTRUM_MIN_FREQ, SPECTRUM_MIN_VIEW_DECADES } from '../../config/constants.js';

const ZOOM_FACTOR = 0.008;
const PAN_FACTOR = 0.25;
const EPSILON = 0.001;

function logF(f) {
  return Math.log10(Math.max(f, SPECTRUM_MIN_FREQ));
}

function isViewZoomed(fMin, fMax, dataFMin, dataFMax) {
  return logF(fMin) > logF(dataFMin) + EPSILON || logF(fMax) < logF(dataFMax) - EPSILON;
}

/**
 * @param {object} params
 * @param {React.RefObject} params.containerRef - main spectrum container
 * @param {React.RefObject} params.scrollRef - scrollable wrapper
 * @param {number} params.viewFMin - viewport lower frequency (Hz)
 * @param {number} params.viewFMax - viewport upper frequency (Hz)
 * @param {number} params.dataFMin - data lower bound (Hz)
 * @param {number} params.dataFMax - data upper bound (Hz)
 * @param {number} params.containerWidth
 * @param {(fMin: number, fMax: number) => void} params.onViewChange
 * @param {React.MutableRefObject} params.gestureRef
 * @param {boolean} params.hasData
 */
export default function useSpectrumNavigation({
  containerRef,
  scrollRef,
  viewFMin,
  viewFMax,
  dataFMin,
  dataFMax,
  containerWidth,
  onViewChange,
  gestureRef,
  hasData = false,
}) {
  const viewFMinRef = useRef(viewFMin);
  viewFMinRef.current = viewFMin;
  const viewFMaxRef = useRef(viewFMax);
  viewFMaxRef.current = viewFMax;
  const dataFMinRef = useRef(dataFMin);
  dataFMinRef.current = dataFMin;
  const dataFMaxRef = useRef(dataFMax);
  dataFMaxRef.current = dataFMax;
  const widthRef = useRef(containerWidth);
  widthRef.current = containerWidth;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const scrollCausedViewChangeRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const panDragRef = useRef({ startX: null, moved: false, viewFMin: 0, viewFMax: 0 });
  const pinchRef = useRef(null);

  // --- Zoom/pan helpers (all in log10 space) ---

  const setUserView = useCallback((newFMin, newFMax) => {
    onViewChangeRef.current?.(newFMin, newFMax);
  }, []);

  const applyZoom = useCallback((delta, centerX) => {
    const dFMin = dataFMinRef.current;
    const dFMax = dataFMaxRef.current;
    const totalLogRange = logF(dFMax) - logF(dFMin);
    if (totalLogRange <= 0) return;

    const vFMin = viewFMinRef.current;
    const vFMax = viewFMaxRef.current;
    const logMin = logF(vFMin);
    const logMax = logF(vFMax);
    const logDur = logMax - logMin;
    const w = widthRef.current;

    // Center frequency from cursor position
    const centerLog = w > 0 ? logMin + (centerX / w) * logDur : (logMin + logMax) / 2;
    const scale = Math.exp(delta * ZOOM_FACTOR);
    const newLogDur = Math.max(SPECTRUM_MIN_VIEW_DECADES, Math.min(totalLogRange, logDur * scale));

    const ratio = w > 0 ? centerX / w : 0.5;
    let newLogMin = centerLog - newLogDur * ratio;
    let newLogMax = centerLog + newLogDur * (1 - ratio);

    const dataLogMin = logF(dFMin);
    const dataLogMax = logF(dFMax);

    if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = Math.min(dataLogMin + newLogDur, dataLogMax); }
    if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - newLogDur, dataLogMin); }

    setUserView(Math.pow(10, newLogMin), Math.pow(10, newLogMax));
  }, [setUserView]);

  const applyPan = useCallback((deltaFraction) => {
    const dFMin = dataFMinRef.current;
    const dFMax = dataFMaxRef.current;
    const vFMin = viewFMinRef.current;
    const vFMax = viewFMaxRef.current;
    const logMin = logF(vFMin);
    const logMax = logF(vFMax);
    const logDur = logMax - logMin;
    const shift = logDur * deltaFraction;

    let newLogMin = logMin + shift;
    let newLogMax = logMax + shift;

    const dataLogMin = logF(dFMin);
    const dataLogMax = logF(dFMax);

    if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = dataLogMin + logDur; }
    if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - logDur, dataLogMin); }

    setUserView(Math.pow(10, newLogMin), Math.pow(10, newLogMax));
  }, [setUserView]);

  const resetZoom = useCallback(() => {
    setUserView(dataFMinRef.current, dataFMaxRef.current);
  }, [setUserView]);

  // --- Wheel event handler (zoom + pan) ---

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let gestureEndTimer = null;
    let lastGestureScale = 1;
    let scrollAxis = null;
    let axisTimer = null;
    let accumX = 0;
    let accumY = 0;
    const AXIS_TIMEOUT = 300;
    const H_LOCK = 6;

    const startWheelGesture = () => {
      gestureRef.current = 'wheel';
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        if (gestureRef.current === 'wheel') gestureRef.current = 'idle';
      }, 150);
    };

    const resetAxis = () => {
      scrollAxis = null;
      accumX = 0;
      accumY = 0;
      if (gestureRef.current === 'detecting') gestureRef.current = 'idle';
    };

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        startWheelGesture();
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        applyZoom(e.deltaY, x);
      } else if (e.shiftKey) {
        e.preventDefault();
        startWheelGesture();
        const delta = e.deltaX || e.deltaY;
        applyPan(delta / 500);
      } else {
        if (axisTimer) clearTimeout(axisTimer);
        axisTimer = setTimeout(resetAxis, AXIS_TIMEOUT);

        accumX += Math.abs(e.deltaX);
        accumY += Math.abs(e.deltaY);

        if (scrollAxis === 'h') {
          e.preventDefault();
          const vFMin = viewFMinRef.current;
          const vFMax = viewFMaxRef.current;
          const dFMin = dataFMinRef.current;
          const dFMax = dataFMaxRef.current;
          if (isViewZoomed(vFMin, vFMax, dFMin, dFMax)) {
            startWheelGesture();
            applyPan(e.deltaX / 500);
          }
        } else if (scrollAxis === 'v') {
          // native scroll
        } else {
          gestureRef.current = 'detecting';
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
          }

          if (accumX > accumY + H_LOCK) {
            scrollAxis = 'h';
            e.preventDefault();
            const vFMin = viewFMinRef.current;
            const vFMax = viewFMaxRef.current;
            const dFMin = dataFMinRef.current;
            const dFMax = dataFMaxRef.current;
            if (isViewZoomed(vFMin, vFMax, dFMin, dFMax)) {
              startWheelGesture();
              applyPan(e.deltaX / 500);
            }
          } else if (accumY > accumX) {
            scrollAxis = 'v';
            gestureRef.current = 'idle';
          }
        }
      }
    };

    // Safari gesture events for trackpad pinch
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
    let initialLogMin = 0;
    let initialLogMax = 0;
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
        initialLogMin = logF(viewFMinRef.current);
        initialLogMax = logF(viewFMaxRef.current);
      }
    };

    const handleTouchMove = (e) => {
      if (!pinchActive || e.touches.length !== 2) return;
      const newDist = getDistance(e.touches[0], e.touches[1]);
      const scale = initialDistance / newDist;
      const rect = el.getBoundingClientRect();
      const midX = getMidX(e.touches[0], e.touches[1], rect);
      const w = widthRef.current;

      const dataLogMin = logF(dataFMinRef.current);
      const dataLogMax = logF(dataFMaxRef.current);
      const totalLogRange = dataLogMax - dataLogMin;

      const initialLogDur = initialLogMax - initialLogMin;
      const newLogDur = Math.max(SPECTRUM_MIN_VIEW_DECADES, Math.min(totalLogRange, initialLogDur * scale));
      const centerLog = w > 0
        ? initialLogMin + (midX / w) * initialLogDur
        : (initialLogMin + initialLogMax) / 2;

      const ratio = w > 0 ? midX / w : 0.5;
      let newLogMin = centerLog - newLogDur * ratio;
      let newLogMax = centerLog + newLogDur * (1 - ratio);

      if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = Math.min(dataLogMin + newLogDur, dataLogMax); }
      if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - newLogDur, dataLogMin); }

      setUserView(Math.pow(10, newLogMin), Math.pow(10, newLogMax));
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

      const dFMin = dataFMinRef.current;
      const dFMax = dataFMaxRef.current;
      const vFMin = viewFMinRef.current;
      const vFMax = viewFMaxRef.current;
      const dataLogMin = logF(dFMin);
      const dataLogMax = logF(dFMax);
      const logDur = logF(vFMax) - logF(vFMin);
      const totalLogRange = dataLogMax - dataLogMin;
      const w = widthRef.current;

      if (totalLogRange <= 0 || w <= 0 || logDur >= totalLogRange - EPSILON) return;

      const spacerW = w * (totalLogRange / logDur);
      const maxScroll = spacerW - w;
      if (maxScroll <= 0) return;

      const scrollLeft = el.scrollLeft;
      const newLogMin = dataLogMin + (scrollLeft / maxScroll) * (totalLogRange - logDur);
      const newLogMax = newLogMin + logDur;

      scrollCausedViewChangeRef.current = true;
      gestureRef.current = 'scroll';
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        if (gestureRef.current === 'scroll') gestureRef.current = 'idle';
      }, 150);

      setUserView(
        Math.pow(10, Math.max(dataLogMin, Math.min(newLogMin, dataLogMax - logDur))),
        Math.pow(10, Math.max(dataLogMin + logDur, Math.min(newLogMax, dataLogMax)))
      );
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
    };
  }, [setUserView, scrollRef, gestureRef, containerWidth, hasData]);

  // --- Pointer drag-to-pan (mouse only, touch uses native scroll) ---

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handlePointerDown = (e) => {
      if (gestureRef.current === 'handleDrag') return;
      if (e.button !== 0) return;
      if (e.pointerType !== 'touch') {
        e.target.setPointerCapture(e.pointerId);
      }
      panDragRef.current = {
        startX: e.clientX,
        moved: false,
        viewFMin: viewFMinRef.current,
        viewFMax: viewFMaxRef.current,
      };
    };

    const handlePointerMove = (e) => {
      const pd = panDragRef.current;
      if (pd.startX == null) return;
      const dx = e.clientX - pd.startX;
      if (!pd.moved && Math.abs(dx) > 3) {
        pd.moved = true;
      }
      if (pd.moved && e.pointerType !== 'touch') {
        const w = widthRef.current;
        const dFMin = dataFMinRef.current;
        const dFMax = dataFMaxRef.current;
        if (w > 0) {
          const origLogMin = logF(pd.viewFMin);
          const origLogMax = logF(pd.viewFMax);
          const origLogDur = origLogMax - origLogMin;
          const dLog = -(dx / w) * origLogDur;
          let newLogMin = origLogMin + dLog;
          let newLogMax = origLogMax + dLog;

          const dataLogMin = logF(dFMin);
          const dataLogMax = logF(dFMax);
          if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = dataLogMin + origLogDur; }
          if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - origLogDur, dataLogMin); }

          gestureRef.current = 'waveformPan';
          el.style.cursor = 'grabbing';
          setUserView(Math.pow(10, newLogMin), Math.pow(10, newLogMax));
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
        applyZoom(-30, widthRef.current / 2);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        applyZoom(30, widthRef.current / 2);
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
  const zoomIn = useCallback(() => applyZoom(-30, widthRef.current / 2), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(30, widthRef.current / 2), [applyZoom]);

  const zoomed = isViewZoomed(viewFMin, viewFMax, dataFMin, dataFMax);
  const logDur = logF(viewFMax) - logF(viewFMin);
  const maxZoom = logDur <= SPECTRUM_MIN_VIEW_DECADES + EPSILON;

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
