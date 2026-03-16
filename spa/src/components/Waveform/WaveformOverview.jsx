/**
 * OverviewBar — Canvas minimap positioned above the main waveform.
 * Shows the entire file's deviation trace with a highlighted
 * viewport rectangle indicating the currently visible zoom region.
 *
 * Interactions:
 * - Drag the viewport rectangle to pan
 * - Drag edges of the viewport to adjust zoom
 * - Click outside the viewport to recenter on that position
 *
 * Adapted from Browser-ABX OverviewBar.jsx.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Box, useTheme } from '@mui/material';
import { getYScale } from './useWaveformData.js';

const OVERVIEW_HEIGHT = 30;
const HANDLE_WIDTH = 20; // px hit area on viewport edges
const CURSOR_WIDTH = 6;  // px cursor zone for mouse

const EPSILON = 0.001;
function isViewZoomed(vs, ve, dur) {
  return vs > EPSILON || ve < dur - EPSILON;
}

const WaveformOverview = React.memo(function WaveformOverview({
  tUniform,
  deviationPct,
  totalDuration,
  viewStart,
  viewEnd,
  wfPeak2Sigma,
  loopStart,
  loopEnd,
  onViewChange,
  onGestureStart,
  onGestureEnd,
}) {
  const theme = useTheme();
  const wf = theme.palette.waveform;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const draggingRef = useRef(null); // 'pan' | 'left' | 'right' | null
  const dragStartRef = useRef({ x: 0, viewStart: 0, viewEnd: 0 });

  // Refs so pointer handlers always read current values
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewEndRef = useRef(viewEnd);
  viewEndRef.current = viewEnd;
  const durationRef = useRef(totalDuration);
  durationRef.current = totalDuration;
  const containerWidthRef = useRef(containerWidth);
  containerWidthRef.current = containerWidth;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  // Viewport rectangle position (for hit testing)
  const vpLeft = totalDuration > 0 ? (viewStart / totalDuration) * containerWidth : 0;
  const vpRight = totalDuration > 0 ? (viewEnd / totalDuration) * containerWidth : containerWidth;
  const vpLeftRef = useRef(vpLeft);
  vpLeftRef.current = vpLeft;
  const vpRightRef = useRef(vpRight);
  vpRightRef.current = vpRight;

  const isZoomed = isViewZoomed(viewStart, viewEnd, totalDuration);

  // Measure container width
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
  }, [tUniform, deviationPct, viewStart, viewEnd, totalDuration, wfPeak2Sigma, loopStart, loopEnd, theme.palette.mode, containerWidth]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !tUniform || !deviationPct || !totalDuration || !containerWidth) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = containerWidth;
    const cssH = OVERVIEW_HEIGHT;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = wf.overviewBackground;
    ctx.fillRect(0, 0, cssW, cssH);

    // Deviation trace — full file, full fidelity
    const { yMin, yMax } = getYScale(deviationPct, null, wfPeak2Sigma);
    const range = yMax - yMin;

    // Grey base trace
    ctx.strokeStyle = wf.overviewFill;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < tUniform.length; i++) {
      const x = (tUniform[i] / totalDuration) * cssW;
      const y = ((yMax - deviationPct[i]) / range) * cssH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Active region trace (clipped to viewport) — only when zoomed
    if (isZoomed) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(vpLeft, 0, vpRight - vpLeft, cssH);
      ctx.clip();

      ctx.strokeStyle = wf.overviewActiveFill || wf.trace;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let i = 0; i < tUniform.length; i++) {
        const x = (tUniform[i] / totalDuration) * cssW;
        const y = ((yMax - deviationPct[i]) / range) * cssH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // Edge handles
      ctx.strokeStyle = wf.overviewActiveFill || wf.handle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(vpLeft, 0); ctx.lineTo(vpLeft, cssH);
      ctx.moveTo(vpRight, 0); ctx.lineTo(vpRight, cssH);
      ctx.stroke();
    }

    // Loop region highlight (display-only)
    const isFullLoop = loopStart <= 0.01 && loopEnd >= totalDuration - 0.01;
    if (!isFullLoop && loopStart != null && loopEnd != null) {
      const lx = (loopStart / totalDuration) * cssW;
      const rx = (loopEnd / totalDuration) * cssW;
      ctx.fillStyle = wf.loopRegion || wf.region;
      ctx.fillRect(lx, 0, rx - lx, cssH);
      ctx.strokeStyle = wf.loopHandle || wf.handle;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, 0); ctx.lineTo(lx, cssH);
      ctx.moveTo(rx, 0); ctx.lineTo(rx, cssH);
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- Pointer handlers (adapted from Browser-ABX OverviewBar) ---

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
    } else if (Math.abs(x - vl) <= CURSOR_WIDTH || Math.abs(x - vr) <= CURSOR_WIDTH) {
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
    const dur = durationRef.current;
    const w = containerWidthRef.current;
    const vl = vpLeftRef.current;
    const vr = vpRightRef.current;
    const vs = viewStartRef.current;
    const ve = viewEndRef.current;

    // Narrow hit zone for mouse, wide for touch
    const hitWidth = e.pointerType === 'mouse' ? CURSOR_WIDTH : HANDLE_WIDTH;
    if (Math.abs(x - vl) <= hitWidth) {
      draggingRef.current = 'left';
    } else if (Math.abs(x - vr) <= hitWidth) {
      draggingRef.current = 'right';
    } else if (x >= vl && x <= vr) {
      draggingRef.current = 'pan';
    } else {
      // Click outside viewport — recenter
      const clickTime = dur > 0 ? Math.max(0, Math.min((x / w) * dur, dur)) : 0;
      const viewDur = ve - vs;
      let newStart = clickTime - viewDur / 2;
      let newEnd = clickTime + viewDur / 2;
      if (newStart < 0) { newStart = 0; newEnd = viewDur; }
      if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - viewDur); }
      onViewChangeRef.current(newStart, newEnd);
      draggingRef.current = 'pan';
      dragStartRef.current = { x, viewStart: newStart, viewEnd: newEnd };
      return;
    }

    dragStartRef.current = { x, viewStart: vs, viewEnd: ve };
  }, []);

  const handlePointerMove = useCallback((e) => {
    updateCursor(e);
    if (!draggingRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dx = x - dragStartRef.current.x;
    const dur = durationRef.current;
    const w = containerWidthRef.current;
    const dTime = (dx / w) * dur;
    const origStart = dragStartRef.current.viewStart;
    const origEnd = dragStartRef.current.viewEnd;
    const origDur = origEnd - origStart;
    const onChange = onViewChangeRef.current;

    if (draggingRef.current === 'pan') {
      let newStart = origStart + dTime;
      let newEnd = origEnd + dTime;
      if (newStart < 0) { newStart = 0; newEnd = origDur; }
      if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - origDur); }
      onChange(newStart, newEnd);
    } else if (draggingRef.current === 'left') {
      let newStart = Math.max(0, origStart + dTime);
      if (newStart > origEnd) {
        draggingRef.current = 'right';
        dragStartRef.current = { x, viewStart: origEnd, viewEnd: Math.min(dur, newStart) };
        onChange(origEnd, Math.min(dur, newStart));
      } else {
        onChange(newStart, origEnd);
      }
    } else if (draggingRef.current === 'right') {
      let newEnd = Math.min(dur, origEnd + dTime);
      if (newEnd < origStart) {
        draggingRef.current = 'left';
        dragStartRef.current = { x, viewStart: Math.max(0, newEnd), viewEnd: origStart };
        onChange(Math.max(0, newEnd), origStart);
      } else {
        onChange(origStart, newEnd);
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      sx={{
        width: '100%',
        position: 'relative',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        borderRadius: '4px 4px 0 0',
        border: `1px solid ${theme.palette.divider}`,
        borderBottom: 'none',
        overflow: 'hidden',
        minHeight: OVERVIEW_HEIGHT,
        touchAction: 'none',
      }}
    >
      {containerWidth > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: containerWidth,
            height: OVERVIEW_HEIGHT,
          }}
        />
      )}
    </Box>
  );
});

export default WaveformOverview;
