/**
 * Canvas-rendered zoomed waveform view.
 *
 * Full-fidelity polyline — every visible point rendered (measurement data).
 * Redraws via requestAnimationFrame, not on every React render.
 * Parent passes width/height — no internal ResizeObserver.
 */

import { useRef, useEffect } from 'react';
import { useTheme } from '@mui/material/styles';

export default function WaveformMain({
  tUniform,
  deviationPct,
  viewStart,
  viewEnd,
  wfPeak2Sigma,
  harmonicOverlays = [],
  loopStart,
  loopEnd,
  totalDuration,
  startIdx,
  endIdx,
  yMin,
  yMax,
  timeToX,
  deviationToY,
  width,
  height,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const theme = useTheme();
  const wf = theme.palette.waveform;

  // Size canvas for HiDPI
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }, [width, height]);

  // Redraw when data/view changes
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [tUniform, deviationPct, viewStart, viewEnd, startIdx, endIdx, yMin, yMax, wfPeak2Sigma, harmonicOverlays, loopStart, loopEnd, totalDuration, theme.palette.mode, width, height]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !tUniform || !deviationPct || !width || !height) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = wf.background;
    ctx.fillRect(0, 0, width, height);

    // Grid lines (horizontal)
    drawGrid(ctx, width, height);

    // Zero line
    const zeroY = deviationToY(0);
    ctx.strokeStyle = wf.zeroLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();

    // 2σ reference lines (dashed)
    if (wfPeak2Sigma != null) {
      ctx.strokeStyle = wf.sigmaLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      const sigmaPos = deviationToY(wfPeak2Sigma);
      const sigmaNeg = deviationToY(-wfPeak2Sigma);
      ctx.beginPath();
      ctx.moveTo(0, sigmaPos);
      ctx.lineTo(width, sigmaPos);
      ctx.moveTo(0, sigmaNeg);
      ctx.lineTo(width, sigmaNeg);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Loop region visuals (dimming + highlight + handle lines)
    const EPSILON = 0.001;
    const isFullFile = loopStart <= EPSILON && loopEnd >= (totalDuration || 1) - EPSILON;
    if (!isFullFile && loopStart != null && loopEnd != null) {
      const lx = timeToX(loopStart);
      const rx = timeToX(loopEnd);

      // Dim outside loop region
      ctx.fillStyle = wf.loopDim;
      if (lx > 0) ctx.fillRect(0, 0, lx, height);
      if (rx < width) ctx.fillRect(rx, 0, width - rx, height);

      // Loop region highlight
      ctx.fillStyle = wf.loopRegion;
      ctx.fillRect(lx, 0, rx - lx, height);

      // Handle lines
      ctx.strokeStyle = wf.loopHandle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, 0); ctx.lineTo(lx, height);
      ctx.moveTo(rx, 0); ctx.lineTo(rx, height);
      ctx.stroke();

      // Handle triangles (8px) at top and bottom of each handle
      ctx.fillStyle = wf.loopHandle;
      // Start handle — triangles point right (outward = left, but visually pointing inward)
      ctx.beginPath();
      ctx.moveTo(lx, 0); ctx.lineTo(lx + 8, 0); ctx.lineTo(lx, 8); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(lx, height); ctx.lineTo(lx + 8, height); ctx.lineTo(lx, height - 8); ctx.closePath(); ctx.fill();
      // End handle — triangles point left
      ctx.beginPath();
      ctx.moveTo(rx, 0); ctx.lineTo(rx - 8, 0); ctx.lineTo(rx, 8); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(rx, height); ctx.lineTo(rx - 8, height); ctx.lineTo(rx, height - 8); ctx.closePath(); ctx.fill();
    }

    // Harmonic overlays (behind main trace when overlays present)
    const hasOverlays = harmonicOverlays.length > 0;
    if (hasOverlays) {
      for (const overlay of harmonicOverlays) {
        drawTrace(ctx, overlay.data, overlay.tUniform || tUniform, overlay.color, 1.5, startIdx, endIdx);
      }
    }

    // Main deviation trace
    const traceColor = hasOverlays ? wf.traceDimmed : wf.trace;
    drawTrace(ctx, deviationPct, tUniform, traceColor, 1.5, startIdx, endIdx);

    ctx.restore();
  }

  function drawGrid(ctx, w, h) {
    const range = yMax - yMin;
    const rawStep = range / 6;
    const niceStep = niceNum(rawStep);

    ctx.strokeStyle = wf.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    let val = Math.ceil(yMin / niceStep) * niceStep;
    while (val <= yMax) {
      if (Math.abs(val) > 1e-10) {
        const y = deviationToY(val);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      val += niceStep;
    }
    ctx.stroke();
  }

  function drawTrace(ctx, data, timeArr, color, lineWidth, si, ei) {
    if (ei - si < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let started = false;
    for (let i = si; i < ei; i++) {
      const x = timeToX(timeArr[i]);
      const y = deviationToY(data[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        position: 'sticky',
        left: 0,
        width: width || 0,
        height: height || 0,
      }}
    />
  );
}

function niceNum(x) {
  const exp = Math.floor(Math.log10(Math.abs(x) || 1e-10));
  const frac = x / Math.pow(10, exp);
  let nice;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3.5) nice = 2;
  else if (frac <= 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}
