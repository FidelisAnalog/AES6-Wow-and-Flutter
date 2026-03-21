/**
 * Sequential color palette for spectrum peaks.
 * Each peak gets a unique color by index so overlays are always distinguishable.
 * Harmonic type identity conveyed via text labels, not color.
 */

const PEAK_COLORS = [
  '#ef5350', // red
  '#42a5f5', // blue
  '#66bb6a', // green
  '#ffa726', // orange
  '#ab47bc', // purple
  '#26c6da', // cyan
  '#ec407a', // pink
  '#8d6e63', // brown
];

/**
 * Get color for a peak by its index (wraps around).
 * @param {number} peakIndex
 * @returns {string} CSS color
 */
export function getPeakColor(peakIndex) {
  return PEAK_COLORS[peakIndex % PEAK_COLORS.length];
}

/**
 * Get a dimmed version of a peak color for unselected state.
 * @param {number} peakIndex
 * @param {number} [opacity=0.4]
 * @returns {string} CSS rgba color
 */
export function getPeakColorDimmed(peakIndex, opacity = 0.4) {
  const hex = getPeakColor(peakIndex);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export { PEAK_COLORS };
