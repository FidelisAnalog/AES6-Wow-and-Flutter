import { useMemo } from 'react';
import { SPECTRUM_MIN_FREQ } from '../../config/constants.js';

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
 * Hook: given log-frequency viewport bounds and pixel dimensions,
 * prepare spectrum data for display.
 *
 * @param {object} params
 * @param {number[]} params.freqs - frequency array (Hz)
 * @param {number[]} params.amplitude - spectral density array
 * @param {number} params.viewFMin - viewport lower freq (Hz)
 * @param {number} params.viewFMax - viewport upper freq (Hz)
 * @param {number} params.width - pixel width of canvas
 * @param {number} params.height - pixel height of canvas
 * @param {number|null} params.lockedAmpMax - explicit Y max (null = auto from visible)
 */
/** Decades of dynamic range for log Y-axis */
const LOG_DYNAMIC_RANGE_DB = 60;

export default function useSpectrumData({
  freqs,
  amplitude,
  viewFMin,
  viewFMax,
  width,
  height,
  lockedAmpMax = null,
  logAmpScale = false,
}) {
  return useMemo(() => {
    if (!freqs || !amplitude || !width || !height || viewFMin >= viewFMax) {
      return {
        startIdx: 0, endIdx: 0,
        ampMin: 0, ampMax: 1,
        freqToX: () => 0, xToFreq: () => 1, ampToY: () => 0,
        visibleCount: 0, logAmpScale,
      };
    }

    // Binary search for visible range
    const startIdx = Math.max(0, lowerBound(freqs, viewFMin) - 1);
    const endIdx = Math.min(freqs.length, upperBound(freqs, viewFMax) + 1);

    // Y-axis: 0 to max amplitude
    let ampMax;
    if (lockedAmpMax != null) {
      ampMax = lockedAmpMax;
    } else {
      let maxVal = 0;
      for (let i = startIdx; i < endIdx; i++) {
        if (amplitude[i] > maxVal) maxVal = amplitude[i];
      }
      ampMax = Math.max(maxVal * 1.25, 1e-6);
    }

    // Log scale: add headroom in log space for labels/markers above highest peak,
    // and set floor at dynamic range limit below max
    if (logAmpScale) {
      // ~6 dB headroom above max so labels fit (peak marker + text ≈ 22px on 200px plot ≈ 11%)
      ampMax = ampMax * Math.pow(10, 6 / 20);
    }
    const ampFloor = logAmpScale ? ampMax * Math.pow(10, -LOG_DYNAMIC_RANGE_DB / 20) : 0;
    const ampMin = logAmpScale ? ampFloor : 0;

    // Coordinate transforms — log X
    const logFMin = Math.log10(Math.max(viewFMin, SPECTRUM_MIN_FREQ));
    const logFMax = Math.log10(Math.max(viewFMax, SPECTRUM_MIN_FREQ));
    const logRange = logFMax - logFMin;

    function freqToX(f) {
      const logF = Math.log10(Math.max(f, SPECTRUM_MIN_FREQ));
      return ((logF - logFMin) / logRange) * width;
    }

    function xToFreq(x) {
      return Math.pow(10, logFMin + (x / width) * logRange);
    }

    // Y transform: linear or log amplitude
    let ampToY;
    if (logAmpScale) {
      const logMax = Math.log10(ampMax);
      const logMin = Math.log10(ampFloor);
      const logAmpRange = logMax - logMin;
      ampToY = (a) => {
        const clamped = Math.max(a, ampFloor);
        return ((logMax - Math.log10(clamped)) / logAmpRange) * height;
      };
    } else {
      ampToY = (a) => {
        return ((ampMax - a) / ampMax) * height;
      };
    }

    return {
      startIdx,
      endIdx,
      ampMin,
      ampMax,
      freqToX,
      xToFreq,
      ampToY,
      visibleCount: endIdx - startIdx,
      logAmpScale,
    };
  }, [freqs, amplitude, viewFMin, viewFMax, width, height, lockedAmpMax, logAmpScale]);
}

/**
 * Get amplitude scale from full data (for locking Y-axis).
 * @param {number[]} amplitude
 * @returns {{ ampMin: number, ampMax: number }}
 */
/**
 * headroomFraction accounts for peak marker + label above the highest peak.
 * Default 1.25 = 25% headroom (marker ~8px + label ~14px on a 200px plot ≈ 11%).
 */
export function getAmpScale(amplitude, headroomFraction = 1.25) {
  let maxVal = 0;
  for (let i = 0; i < amplitude.length; i++) {
    if (amplitude[i] > maxVal) maxVal = amplitude[i];
  }
  return { ampMin: 0, ampMax: Math.max(maxVal * headroomFraction, 1e-6) };
}
