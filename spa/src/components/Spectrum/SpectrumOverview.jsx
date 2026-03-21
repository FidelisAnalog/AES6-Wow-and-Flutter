/**
 * SpectrumOverview — Canvas minimap for the spectrum plot.
 * Shows the full spectral density trace with viewport rectangle.
 * All coordinates in log-frequency space.
 * Adapted from WaveformOverview.jsx.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, useTheme } from '@mui/material';
import { SPECTRUM_MIN_FREQ } from '../../config/constants.js';
import { getAmpScale } from './useSpectrumData.js';

const OVERVIEW_HEIGHT = 30;
const TOUCH_HIT = 20;
const MOUSE_HIT = 8;
const CURSOR_ZONE = 6;
const EPSILON = 0.001;

function logF(f) {
  return Math.log10(Math.max(f, SPECTRUM_MIN_FREQ));
}

function isViewZoomed(fMin, fMax, dataFMin, dataFMax) {
  return logF(fMin) > logF(dataFMin) + EPSILON || logF(fMax) < logF(dataFMax) - EPSILON;
}

const SpectrumOverview = React.memo(function SpectrumOverview({
  freqs,
  amplitude,
  dataFMin,
  dataFMax,
  viewFMin,
  viewFMax,
  logAmpScale = false,
  onViewChange,
  onGestureStart,
  onGestureEnd,
}) {
  const theme = useTheme();
  const sp = theme.palette.spectrum;
  const wf = theme.palette.waveform;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const draggingRef = useRef(null);
  const dragStartRef = useRef({ x: 0, viewFMin: 0, viewFMax: 0 });

  // Refs for pointer handlers
  const viewFMinRef = useRef(viewFMin);
  viewFMinRef.current = viewFMin;
  const viewFMaxRef = useRef(viewFMax);
  viewFMaxRef.current = viewFMax;
  const dataFMinRef = useRef(dataFMin);
  dataFMinRef.current = dataFMin;
  const dataFMaxRef = useRef(dataFMax);
  dataFMaxRef.current = dataFMax;
  const containerWidthRef = useRef(containerWidth);
  containerWidthRef.current = containerWidth;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  // Log-space viewport positions (pixels)
  const totalLogRange = logF(dataFMax) - logF(dataFMin);
  const vpLeft = totalLogRange > 0
    ? ((logF(viewFMin) - logF(dataFMin)) / totalLogRange) * containerWidth
    : 0;
  const vpRight = totalLogRange > 0
    ? ((logF(viewFMax) - logF(dataFMin)) / totalLogRange) * containerWidth
    : containerWidth;
  const vpLeftRef = useRef(vpLeft);
  vpLeftRef.current = vpLeft;
  const vpRightRef = useRef(vpRight);
  vpRightRef.current = vpRight;

  const zoomed = isViewZoomed(viewFMin, viewFMax, dataFMin, dataFMax);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerWidth) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(containerWidth * dpr);
    canvas.height = Math.round(OVERVIEW_HEIGHT * dpr);
  }, [containerWidth]);

  // Redraw
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [freqs, amplitude, viewFMin, viewFMax, dataFMin, dataFMax, logAmpScale, theme.palette.mode, containerWidth]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !amplitude || !containerWidth) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = containerWidth;
    const cssH = OVERVIEW_HEIGHT;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = wf.overviewBackground;
    ctx.fillRect(0, 0, cssW, cssH);

    const { ampMax } = getAmpScale(amplitude);
    const dataLogMin = logF(dataFMin);
    const dataLogMax = logF(dataFMax);
    const logRange = dataLogMax - dataLogMin;
    if (logRange <= 0 || ampMax <= 0) { ctx.restore(); return; }

    // Build Y transform matching main plot's scale
    let ampToY;
    if (logAmpScale) {
      const LOG_DR = 60;
      const ampFloor = ampMax * Math.pow(10, -LOG_DR / 20);
      const logAmpMax = Math.log10(ampMax * Math.pow(10, 6 / 20)); // match 6dB headroom
      const logAmpMin = Math.log10(ampFloor);
      const logAmpRange = logAmpMax - logAmpMin;
      ampToY = (a) => {
        const clamped = Math.max(a, ampFloor);
        return ((logAmpMax - Math.log10(clamped)) / logAmpRange) * cssH;
      };
    } else {
      ampToY = (a) => ((ampMax - a) / ampMax) * cssH;
    }

    // Grey base trace
    ctx.strokeStyle = sp.overviewFill;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] <= 0) continue;
      const x = ((logF(freqs[i]) - dataLogMin) / logRange) * cssW;
      const y = ampToY(amplitude[i]);
      if (i === 0 || freqs[i - 1] <= 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Active region trace (clipped to viewport)
    if (zoomed) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(vpLeft, 0, vpRight - vpLeft, cssH);
      ctx.clip();

      ctx.strokeStyle = sp.overviewActiveFill || sp.trace;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] <= 0) continue;
        const x = ((logF(freqs[i]) - dataLogMin) / logRange) * cssW;
        const y = ampToY(amplitude[i]);
        if (i === 0 || freqs[i - 1] <= 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // Edge handles
      ctx.strokeStyle = sp.overviewActiveFill || sp.handle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(vpLeft, 0); ctx.lineTo(vpLeft, cssH);
      ctx.moveTo(vpRight, 0); ctx.lineTo(vpRight, cssH);
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- Pointer handlers (log-space adapted from WaveformOverview) ---

  const xToFreq = useCallback((x) => {
    const w = containerWidthRef.current;
    const dMin = dataFMinRef.current;
    const dMax = dataFMaxRef.current;
    const dataLogMin = logF(dMin);
    const dataLogMax = logF(dMax);
    const logRange = dataLogMax - dataLogMin;
    if (w <= 0 || logRange <= 0) return dMin;
    const logVal = dataLogMin + (x / w) * logRange;
    return Math.pow(10, Math.max(dataLogMin, Math.min(logVal, dataLogMax)));
  }, []);

  const updateCursor = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const vl = vpLeftRef.current;
    const vr = vpRightRef.current;
    let cursor = 'pointer';
    if (draggingRef.current === 'left' || draggingRef.current === 'right') {
      cursor = 'col-resize';
    } else if (draggingRef.current === 'pan') {
      cursor = 'grabbing';
    } else if (Math.abs(x - vl) <= CURSOR_ZONE || Math.abs(x - vr) <= CURSOR_ZONE) {
      cursor = 'col-resize';
    } else if (x >= vl && x <= vr) {
      cursor = 'grab';
    }
    containerRef.current.style.cursor = cursor;
  }, []);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    if (onGestureStartRef.current) onGestureStartRef.current();
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const vl = vpLeftRef.current;
    const vr = vpRightRef.current;
    const vFMin = viewFMinRef.current;
    const vFMax = viewFMaxRef.current;

    const hitWidth = e.pointerType === 'mouse' ? MOUSE_HIT : TOUCH_HIT;
    if (Math.abs(x - vl) <= hitWidth) {
      draggingRef.current = 'left';
    } else if (Math.abs(x - vr) <= hitWidth) {
      draggingRef.current = 'right';
    } else if (x >= vl && x <= vr) {
      draggingRef.current = 'pan';
    } else {
      // Click outside — recenter
      const clickFreq = xToFreq(x);
      const logDur = logF(vFMax) - logF(vFMin);
      const clickLog = logF(clickFreq);
      let newLogMin = clickLog - logDur / 2;
      let newLogMax = clickLog + logDur / 2;
      const dataLogMin = logF(dataFMinRef.current);
      const dataLogMax = logF(dataFMaxRef.current);
      if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = dataLogMin + logDur; }
      if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - logDur, dataLogMin); }
      const newFMin = Math.pow(10, newLogMin);
      const newFMax = Math.pow(10, newLogMax);
      onViewChangeRef.current(newFMin, newFMax);
      draggingRef.current = 'pan';
      dragStartRef.current = { x, viewFMin: newFMin, viewFMax: newFMax };
      return;
    }
    dragStartRef.current = { x, viewFMin: vFMin, viewFMax: vFMax };
  }, [xToFreq]);

  const handlePointerMove = useCallback((e) => {
    updateCursor(e);
    if (!draggingRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = containerWidthRef.current;
    const dataLogMin = logF(dataFMinRef.current);
    const dataLogMax = logF(dataFMaxRef.current);
    const totalLog = dataLogMax - dataLogMin;
    const dx = x - dragStartRef.current.x;
    const dLog = (dx / w) * totalLog;
    const origLogMin = logF(dragStartRef.current.viewFMin);
    const origLogMax = logF(dragStartRef.current.viewFMax);
    const origLogDur = origLogMax - origLogMin;
    const onChange = onViewChangeRef.current;

    if (draggingRef.current === 'pan') {
      let newLogMin = origLogMin + dLog;
      let newLogMax = origLogMax + dLog;
      if (newLogMin < dataLogMin) { newLogMin = dataLogMin; newLogMax = dataLogMin + origLogDur; }
      if (newLogMax > dataLogMax) { newLogMax = dataLogMax; newLogMin = Math.max(dataLogMax - origLogDur, dataLogMin); }
      onChange(Math.pow(10, newLogMin), Math.pow(10, newLogMax));
    } else if (draggingRef.current === 'left') {
      let newLogMin = Math.max(dataLogMin, origLogMin + dLog);
      if (newLogMin > origLogMax) {
        draggingRef.current = 'right';
        dragStartRef.current = { x, viewFMin: Math.pow(10, origLogMax), viewFMax: Math.pow(10, Math.min(dataLogMax, newLogMin)) };
        onChange(Math.pow(10, origLogMax), Math.pow(10, Math.min(dataLogMax, newLogMin)));
      } else {
        onChange(Math.pow(10, newLogMin), Math.pow(10, origLogMax));
      }
    } else if (draggingRef.current === 'right') {
      let newLogMax = Math.min(dataLogMax, origLogMax + dLog);
      if (newLogMax < origLogMin) {
        draggingRef.current = 'left';
        dragStartRef.current = { x, viewFMin: Math.pow(10, Math.max(dataLogMin, newLogMax)), viewFMax: Math.pow(10, origLogMin) };
        onChange(Math.pow(10, Math.max(dataLogMin, newLogMax)), Math.pow(10, origLogMin));
      } else {
        onChange(Math.pow(10, origLogMin), Math.pow(10, newLogMax));
      }
    }
  }, [updateCursor]);

  const handlePointerUp = useCallback((e) => {
    draggingRef.current = null;
    if (onGestureEndRef.current) onGestureEndRef.current();
    updateCursor(e);
  }, [updateCursor]);

  return (
    <Box
      ref={containerRef}
      onPointerEnter={updateCursor}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => { if (containerRef.current) containerRef.current.style.cursor = ''; }}
      sx={{
        width: '100%',
        position: 'relative',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        borderRadius: '4px 4px 0 0',
        border: `1px solid ${theme.palette.divider}`,
        overflow: 'hidden',
        minHeight: OVERVIEW_HEIGHT,
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      {containerWidth > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: containerWidth,
            height: OVERVIEW_HEIGHT,
            pointerEvents: 'none',
          }}
        />
      )}
    </Box>
  );
});

export default SpectrumOverview;
