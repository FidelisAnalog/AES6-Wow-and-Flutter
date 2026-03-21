/**
 * Canvas-rendered spectrum plot — spectral density line with peak markers.
 * Adapted from WaveformMain.jsx.
 */

import { useRef, useEffect } from 'react';
import { useTheme } from '@mui/material/styles';
import { SPECTRUM_PEAK_MARKER_SIZE } from '../../config/constants.js';
import { getPeakColor, getPeakColorDimmed } from './peakColors.js';

export default function SpectrumPlot({
  freqs,
  amplitude,
  peaks = [],
  couplingThreshold,
  selectedPeakIndices = [],
  startIdx,
  endIdx,
  ampMax,
  freqToX,
  ampToY,
  width,
  height,
  onTogglePeak,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const theme = useTheme();
  const sp = theme.palette.spectrum;

  // Size canvas for HiDPI
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }, [width, height]);

  // Redraw
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [freqs, amplitude, peaks, couplingThreshold, selectedPeakIndices,
      startIdx, endIdx, ampMax, theme.palette.mode, width, height]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !amplitude || !width || !height) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = sp.background;
    ctx.fillRect(0, 0, width, height);

    // Grid — horizontal amplitude lines
    drawGrid(ctx, width, height, ampMax, ampToY, sp.grid);

    // Coupling threshold line (horizontal dashed)
    if (couplingThreshold != null && couplingThreshold > 0) {
      const y = ampToY(couplingThreshold);
      if (y >= 0 && y <= height) {
        ctx.strokeStyle = sp.couplingThreshold;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Spectrum trace
    ctx.strokeStyle = sp.trace;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = startIdx; i < endIdx && i < freqs.length; i++) {
      const x = freqToX(freqs[i]);
      const y = ampToY(amplitude[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Peak markers
    const markerH = SPECTRUM_PEAK_MARKER_SIZE;
    const selectedSet = new Set(selectedPeakIndices);

    for (let pi = 0; pi < peaks.length; pi++) {
      const peak = peaks[pi];
      const x = freqToX(peak.freq);
      if (x < -20 || x > width + 20) continue;

      const y = ampToY(peak.amplitude);
      const isSelected = selectedSet.has(pi);
      const color = isSelected ? getPeakColor(pi) : getPeakColorDimmed(pi, 0.5);

      // Filled inverted triangle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - markerH / 2, y - markerH - 2);
      ctx.lineTo(x + markerH / 2, y - markerH - 2);
      ctx.lineTo(x, y - 2);
      ctx.closePath();
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = getPeakColor(pi);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label
      const label = buildPeakLabel(peak);
      ctx.font = '10px monospace';
      const metrics = ctx.measureText(label);
      const labelX = Math.min(x - metrics.width / 2, width - metrics.width - 4);
      const labelY = y - markerH - 6;

      ctx.fillStyle = sp.labelBackground;
      ctx.fillRect(
        Math.max(0, labelX - 2), labelY - 10,
        metrics.width + 4, 13
      );
      ctx.fillStyle = sp.labelText;
      ctx.fillText(label, Math.max(2, labelX), labelY);
    }

    ctx.restore();
  }

  const hitDist = 20; // px

  const findClosestPeak = (clientX, clientY, rect) => {
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let closest = null;
    let closestDist = hitDist;
    for (let pi = 0; pi < peaks.length; pi++) {
      const px = freqToX(peaks[pi].freq);
      const py = ampToY(peaks[pi].amplitude);
      const dist = Math.hypot(mx - px, my - py);
      if (dist < closestDist) {
        closest = pi;
        closestDist = dist;
      }
    }
    return closest;
  };

  const handleClick = (e) => {
    if (!onTogglePeak || !peaks.length || !freqToX) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const closest = findClosestPeak(e.clientX, e.clientY, rect);
    if (closest != null) onTogglePeak(closest);
  };

  const handleMouseMove = (e) => {
    if (!peaks.length || !freqToX) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const closest = findClosestPeak(e.clientX, e.clientY, rect);
    e.currentTarget.style.cursor = closest != null ? 'pointer' : 'default';
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{
        width: width || '100%',
        height: height || 200,
        display: 'block',
        position: 'sticky',
        left: 0,
        cursor: 'default',
      }}
    />
  );
}

function buildPeakLabel(peak) {
  return peak.freq.toFixed(2);
}

function drawGrid(ctx, width, height, ampMax, ampToY, gridColor) {
  const rawStep = ampMax / 5;
  const step = niceNum(rawStep);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;

  let val = step;
  while (val < ampMax) {
    const y = ampToY(val);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    val += step;
  }
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
