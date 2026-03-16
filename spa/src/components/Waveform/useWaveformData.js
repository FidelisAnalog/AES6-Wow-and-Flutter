import { useMemo } from 'react';

/**
 * Binary search: find first index where arr[i] >= value.
 */
function lowerBound(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Binary search: find first index where arr[i] > value.
 */
function upperBound(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Hook: given viewport bounds and pixel width, prepare deviation data for display.
 *
 * Full fidelity — every visible point is rendered (no min/max downsampling).
 * This is measurement data.
 *
 * @param {object} params
 * @param {Float64Array|number[]} params.tUniform - uniform time array (seconds)
 * @param {Float64Array|number[]} params.deviationPct - deviation % array
 * @param {number} params.viewStart - viewport start (seconds)
 * @param {number} params.viewEnd - viewport end (seconds)
 * @param {number} params.width - pixel width of the canvas
 * @param {number} params.height - pixel height of the canvas
 * @param {number|null} params.yBoundsExplicit - explicit ±Y bound (null = auto)
 * @param {number|null} params.wfPeak2Sigma - ±2σ reference value
 */
export default function useWaveformData({
  tUniform,
  deviationPct,
  viewStart,
  viewEnd,
  width,
  height,
  yBoundsExplicit = null,
  wfPeak2Sigma = null,
}) {
  return useMemo(() => {
    if (!tUniform || !deviationPct || !width || !height || viewStart >= viewEnd) {
      return { startIdx: 0, endIdx: 0, yMin: -1, yMax: 1, timeToX, deviationToY: () => 0, xToTime: () => 0, visibleCount: 0 };
    }

    // Binary search for visible range
    const startIdx = Math.max(0, lowerBound(tUniform, viewStart) - 1);
    const endIdx = Math.min(tUniform.length, upperBound(tUniform, viewEnd) + 1);

    // Y-axis: symmetric around 0
    let yMax;
    if (yBoundsExplicit != null) {
      yMax = Math.abs(yBoundsExplicit);
    } else {
      // Auto-scale: find max absolute deviation in visible range
      let maxAbs = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const v = Math.abs(deviationPct[i]);
        if (v > maxAbs) maxAbs = v;
      }
      // Include 2σ reference if available
      if (wfPeak2Sigma != null) {
        maxAbs = Math.max(maxAbs, Math.abs(wfPeak2Sigma));
      }
      // Add 10% headroom, minimum ±0.01%
      yMax = Math.max(maxAbs * 1.1, 0.01);
    }
    const yMin = -yMax;

    // Coordinate transforms
    const duration = viewEnd - viewStart;

    function timeToX(t) {
      return ((t - viewStart) / duration) * width;
    }

    function deviationToY(d) {
      // Top of canvas = +yMax, bottom = -yMax (yMin)
      return ((yMax - d) / (yMax - yMin)) * height;
    }

    function xToTime(x) {
      return viewStart + (x / width) * duration;
    }

    return {
      startIdx,
      endIdx,
      yMin,
      yMax,
      timeToX,
      deviationToY,
      xToTime,
      visibleCount: endIdx - startIdx,
    };
  }, [tUniform, deviationPct, viewStart, viewEnd, width, height, yBoundsExplicit, wfPeak2Sigma]);
}

/**
 * Get Y scale bounds (exported for use by overview).
 */
export function getYScale(deviationPct, explicitBounds = null, wfPeak2Sigma = null) {
  if (explicitBounds != null) {
    return { yMin: -Math.abs(explicitBounds), yMax: Math.abs(explicitBounds) };
  }
  let maxAbs = 0;
  for (let i = 0; i < deviationPct.length; i++) {
    const v = Math.abs(deviationPct[i]);
    if (v > maxAbs) maxAbs = v;
  }
  if (wfPeak2Sigma != null) {
    maxAbs = Math.max(maxAbs, Math.abs(wfPeak2Sigma));
  }
  const yMax = Math.max(maxAbs * 1.1, 0.01);
  return { yMin: -yMax, yMax };
}
