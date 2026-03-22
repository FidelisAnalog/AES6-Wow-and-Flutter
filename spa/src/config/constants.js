// All configurable constants — single source of truth.
// Easy to adjust by us, not exposed to users.

/** Maximum file duration in seconds */
export const MAX_FILE_DURATION_SECONDS = 120;

/** Minimum measurement region in seconds (hard enforced) */
export const MIN_MEASUREMENT_SECONDS = 5;

/** Minimum seconds required for drift measurement */
export const MIN_DRIFT_SECONDS = 20;

/** Minimum sample rate we accept */
export const MIN_SAMPLE_RATE = 22050;

/** Downsample targets based on detected carrier frequency */
export const DOWNSAMPLE_THRESHOLDS = {
  /** Carrier below this Hz → downsample to LOW_TARGET */
  LOW_CARRIER_HZ: 500,
  LOW_TARGET_RATE: 10000,
  /** Carrier below this Hz → downsample to HIGH_TARGET */
  HIGH_CARRIER_HZ: 4800,
  HIGH_TARGET_RATE: 48000,
};

/** Maximum seconds for a single deviation plot in export (legibility) */
export const MAX_EXPORT_PLOT_SECONDS = 60;

/** Default export plot duration when no region selected */
export const DEFAULT_EXPORT_SHORT_SECONDS = 5;

// ── Spectrum ──

/** Log axis lower bound (Hz) — below any real peak */
export const SPECTRUM_MIN_FREQ = 0.3;

/** Minimum zoom range in decades */
export const SPECTRUM_MIN_VIEW_DECADES = 0.3;

/** Peak marker triangle height (px) */
export const SPECTRUM_PEAK_MARKER_SIZE = 8;
