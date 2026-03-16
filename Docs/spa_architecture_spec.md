# AES6 Wow & Flutter Analyzer — SPA Architecture Spec

Working title: **AES6 W&F Analyzer**

## Overview

Single-page application for AES6-2008 (s2013) conformant wow & flutter analysis, compatible with DIN 45507 and IEC 60386. Converts the `fg_analyze.py` prototype into an interactive web tool.

Key differentiator: self-adaptive carrier detection and auto-tuned prefilter supporting carrier frequencies from 50 Hz to 3.15 kHz. No other open-source W&F analyzer handles carriers below ~1 kHz.

---

## Stack

| Layer | Technology |
|---|---|
| Front-end framework | React + Vite |
| Component library | MUI (Material UI) |
| Signal processing | PyScript / Pyodide (Python in-browser) |
| FLAC decoding | @wasm-audio-decoders/flac (WASM, bit-perfect) |
| Waveform rendering | SVG or Canvas (adapted from Browser-ABX patterns) |
| Plot rendering | Custom SVG / lightweight charting (TBD per plot type) |
| CORS isolation | mini-coi.js service worker (for SharedArrayBuffer / PyScript) |

---

## Data Flow

```
File Input (JS)
  ├── Drag-drop / click-browse / URL param
  ├── FLAC → WASM decode to PCM
  └── WAV → FileReader → Uint8Array
        │
        ▼
Pre-processing (JS)
  ├── Sample rate check (44.1 kHz minimum)
  ├── Quick FFT carrier detection (dominant spectral peak)
  ├── Adaptive downsample via OfflineAudioContext:
  │     Carrier < ~500 Hz  → downsample to 10 kHz
  │     Carrier < ~4.8 kHz → downsample to 48 kHz
  │     (OfflineAudioContext provides native anti-alias filtering)
  ├── Non-signal trimming (RMS threshold from file midpoint)
  └── Duration cap enforcement (120s configurable)
        │
        ▼  (downsampled PCM)
        │
Python Pipeline (PyScript/Pyodide) — full file, one call
  ├── Carrier detection (own FFT — pipeline stands on its own)
  ├── Bandpass prefilter (auto-tuned, coefficients cached)
  ├── Zero-crossing detection (sinc interp + Brent's method)
  ├── Per-cycle frequency extraction
  ├── Edge trimming + outlier rejection
  ├── Uniform grid interpolation
  ├── AES6 weighting + band separation
  └── Returns structured data (not images)
        │
        ▼
JS Rendering
  ├── Deviation waveform (interactive, zoomable)
  ├── Spectrum with selectable harmonics
  ├── Stats panel (AES6 metrics)
  ├── Polar plot (optional)
  └── Histogram (optional)
```

### Region Re-processing

When the user selects a measurement region via loop handles:

1. Full-file deviation waveform **does not change** — it's from the initial run
2. Python pipeline **re-runs on the raw audio segment** for the selected region
3. Full pipeline re-runs on the segment (carrier detection and filter design are trivially fast — no caching needed)
4. Zero-crossing detection and downstream processing **must re-run** — this is the expensive part
5. All metrics, spectrum, polar, and histogram update to reflect the selected region
6. UI shows processing indicator during re-run

The pipeline cost scales linearly with region length. Not instant, but manageable for 10–60s regions.

---

## Python Module Architecture

Refactor `fg_analyze.py` into a clean module callable from PyScript. Single entry point for full analysis, returns all data needed for JS rendering.

### Return Data Structure

```python
{
    # Display data (from initial full-file run)
    't_uniform': [],          # uniform time grid (seconds)
    'deviation_pct': [],      # speed deviation (%) on uniform grid

    # Spectrum data
    'spectrum_freqs': [],     # modulation frequencies (Hz)
    'spectrum_amplitude': [], # amplitude spectral density (% RMS/√Hz)
    'harmonic_peaks': [       # auto-detected peaks, sorted by amplitude
        {'freq': float, 'amplitude': float, 'rms': float, 'index': int},
        ...
    ],

    # Polar plot data
    'inst_freq': [],          # instantaneous frequency array
    'f_mean': float,          # mean carrier frequency

    # Histogram data
    # (deviation_pct array reused)

    # AES6 metrics
    'aes6': {
        'peak_unweighted': float,   # %
        'rms_unweighted': float,    # %
        'peak_weighted': float,     # %
        'rms_weighted': float,      # %
        'drift_rms': float,         # %
        'wow_rms': float,           # %
        'flutter_rms': float,       # %
    },

    # Signal info
    'fs': int,                # sample rate
    'f_mean': float,          # detected carrier frequency
    'output_rate': float,     # deviation signal sample rate
    'duration': float,        # signal duration (seconds)

    'carrier_freq': float,    # detected carrier frequency
}
```

### Region Re-processing Entry Point

Separate function that accepts raw audio segment, runs the full pipeline (carrier detection and filter design are trivially fast — no caching needed), returns the same structure minus the full-file display data.

---

## UI Layout

Panel-based layout using a Layout container component. Panel order is a prop/config — rearranging is trivial.

### Panel Order

1. **Header** — app title, theme toggle, about/info
2. **File Input** — drag-drop zone, click-browse button, URL input
3. **Stats Panel** — AES6 metrics (always visible after analysis)
4. **Deviation Waveform** — primary interactive view (always visible after analysis)
5. **Spectrum** — harmonic spectrum with selectable peaks (always visible after analysis)
6. **Advanced Panel** — collapsible (channel selector, motor params, RPM)
7. **Optional Plots** — expandable area for polar and histogram
8. **Footer** — attribution, links

### Layout Container

- Theme-driven colors (dark/light)
- Configurable panel sections (show/hide, reorder via props)
- Gutter control for embed mode (drop gutters when embedded)
- Responsive — mobile-aware, may shed features on small screens

---

## Deviation Waveform (Primary View)

Adapted from Browser-ABX waveform component UX patterns.

### Features

- **Overview bar** at top showing full-file deviation trace with viewport indicator
- **Main view** showing zoomed region with pan and zoom
- **Loop handles** for measurement region selection (visible in both overview and main view)
- **Zoom/pan gestures** — mouse wheel zoom, click-drag pan, pinch-zoom on mobile
- **Harmonic overlay** — selected harmonics from spectrum rendered on the deviation trace; when active, the deviation datum becomes less prominent
- **2σ reference lines** — dashed horizontal lines at ±peak(2σ)
- **Zero line** — center reference

### Axis Conventions

- **X-axis:** Time (seconds)
- **Y-axis:** Speed Deviation (%), symmetric around 0, auto-scaled

### Measurement Region Constraints

- **Hard minimum: 10 seconds** — loop handles snap to enforce this, user cannot select less
- **Drift threshold: 20 seconds** — if selected region < 20s, drift metric hidden and user informed that 20s must be selected for drift measurement
- These thresholds are configurable constants defined in one place

### Region Change Behavior

The user will adjust loop handles multiple times before settling on a region. The re-processing flow must account for this:

- Region selection does **not** auto-trigger processing on handle release — a human won't nail the region on the first try
- Explicit **"Measure"** button (or similar) to trigger re-processing of the selected region
- If re-processing is in flight and user triggers again, the in-flight run is **cancelled** and the new region is processed
- Show processing indicator during re-run
- Stats, spectrum, polar, histogram all update to selected region
- Deviation waveform itself does not change (always shows initial full-file result)

---

## Spectrum Plot

Always visible below the deviation waveform.

### Display

- **X-axis:** Modulation frequency (Hz), log scale, starting at 0.4 Hz
- **X-axis ticks:** 0.5, 1, 2, 5, 10, 20, 50 Hz
- **Y-axis:** Speed Deviation (% RMS/√Hz)
- Top 8–12 harmonic peaks auto-tagged with colored markers

### Harmonic Selection

- **Desktop:** Click directly on labeled peaks to toggle selection on/off. Selected peaks highlighted, unselected dimmed.
- **Mobile:** Scrollable chip/pill list below the spectrum for selection (click-to-select on small screens is impractical)
- Selected harmonics are overlaid on the deviation waveform
- When harmonics are overlaid, the deviation datum becomes less prominent

### Motor Harmonic Labeling

When motor parameters are provided (via Advanced panel):
- Peaks are identified as rotation fundamental, electrical, slot passing, torque ripple
- Color-coded by source type (same scheme as prototype)
- When motor params not provided, peaks still detected but unlabeled

---

## Stats Panel

Dedicated, always-visible panel showing AES6 metrics after analysis.

### Metrics Displayed

| Label | Value | Notes |
|---|---|---|
| DIN/IEC Unwtd Peak (2σ) | ±X.XXXX% | |
| DIN/IEC Unwtd RMS | X.XXXX% | |
| DIN/IEC Wtd Peak (2σ) | ±X.XXXX% | |
| DIN/IEC Wtd RMS (JIS) | X.XXXX% | JIS designation in label |
| Wow RMS | X.XXXX% | |
| Flutter RMS | X.XXXX% | |
| Drift RMS | X.XXXX% | Hidden if region < 20s |
| Carrier Frequency | XXX.X Hz | Detected carrier |

- Tooltip/info icon on weighted vs unweighted explaining the standard
- Updates when measurement region changes (after Python re-processing)

---

## Optional Plots

Expandable area below the spectrum. User chooses which to show.

### Polar Plot

- 0.1% per radial division, 20 divisions
- Angular ticks at 45° intervals (0°–315°, platter position)
- User-selectable number of revolutions to display
- "0.1%/div" scale annotation

### Deviation Distribution (Histogram)

- X-axis: Speed Deviation (%), symmetric around 0
- X-axis minimum range: ±0.1%
- Y-axis: Density
- 256 bins

---

## Advanced Panel

Collapsible section.

### Controls

- **Channel selector** (L/R) — shown for stereo files, default left
- **Motor parameters** — slots, poles, RPM inputs (optional)
- **RPM auto-detect** — attempt to identify rotation fundamental from spectrum (strongest sub-2Hz peak × 60). Show confidence indicator; user can override.

---

## File Input

### Methods

1. **Drag-and-drop** — primary UX, drop zone in File Input panel
2. **Click-to-browse** — fallback file picker button (important for mobile)
3. **URL parameter** — `?file=<URL>` for sharing/demos. Dropbox support with `?dl=1` auto-append.

### Supported Formats

- **WAV** — direct PCM extraction
- **FLAC** — WASM decoder (@wasm-audio-decoders/flac) for bit-perfect decode to PCM

### Pre-processing (JS, before Python)

1. **Sample rate check** — 44.1 kHz minimum, reject below
2. **Quick carrier detection (JS-side, for downsample decision only)** — FFT on first 2s of raw audio to find dominant spectral peak. Used solely to choose the downsample target rate. Python pipeline runs its own independent carrier detection — the pipeline is proven and stands on its own.
3. **Adaptive downsample** — target rate chosen by detected carrier frequency:
   - Carrier < ~500 Hz → 10 kHz (e.g., motor FG signals)
   - Carrier < ~4.8 kHz → 48 kHz (e.g., test records at 3/3.15 kHz)
   - Implemented via `OfflineAudioContext` which provides native anti-alias filtering before decimation. No custom filter needed.
   - Validated: 48 kHz is measurement-accurate for carriers up to 4.8 kHz. No known test signals exceed 3.15 kHz.
4. **Non-signal trimming** — detect RMS from file midpoint, scan head and tail, cut where energy drops X dB below midpoint RMS. Removes noise/hum before and after carrier signal.
5. **Duration cap** — 120 seconds (configurable constant). Reject files exceeding cap.

---

## Export / Download

### Individual Plot Downloads

Each visible plot downloadable as PNG:
- Deviation waveform — **re-rendered as presentation plot** for the current selected region (not a screenshot of the interactive view)
- Spectrum — clean plot matching prototype styling
- Polar — clean plot
- Histogram — clean plot

### Full Test Set Download

Mirrors prototype's two-plot approach:

- **If region selected:** Plot 1 = selected region, Plot 2 = 60s view
- **If no region selected:** Plot 1 = 10s view, Plot 2 = 60s view
- Plus spectrum, polar, histogram
- **60s maximum** for any single deviation plot in the download set (legibility cap)
- All plots styled consistently (presentation quality)

---

## Theme

### Modes

- Dark and light themes
- OS preference detection (default)
- Manual toggle (Ctrl+Shift+T, matching Browser-ABX)
- Borrow Browser-ABX palette as starting point

### Priority (highest to lowest)

1. postMessage from host page (runtime override)
2. Query param `?theme=dark|light|system` (initial load)
3. Manual toggle by user
4. OS preference detection (default fallback)

---

## Embed Support

### Layout Adjustments

- Drop gutters when embedded
- Query param `?embed=true` — sets sensible defaults (hide header/footer, compact layout)
- Additional query params to control UI: hide specific panels, disable file input (host provides file via URL)

### postMessage API (defined contract)

**Inbound (host → app):**

| Message Type | Payload | Description |
|---|---|---|
| `setTheme` | `'dark' \| 'light' \| 'system'` | Override theme at runtime |
| `loadFile` | `{url: string}` | Load file from URL |

**Outbound (app → host):**

| Message Type | Payload | Description |
|---|---|---|
| `resize` | `{height: number}` | Window height for iframe sizing |
| `ready` | `{}` | App fully initialized (React + PyScript + all dependencies). Ready to accept files. |
| `stateChange` | `{state: 'initializing' \| 'ready' \| 'loading' \| 'processing' \| 'complete' \| 'error'}` | App/processing state |
| `results` | `{metrics: {...}, carrier: number}` | AES6 metrics for host page consumption |
| `error` | `{message: string, trace?: string}` | Error details |

---

## Error Handling

### Approach

- Top-line error message that is reasonably informative
- Expandable dropdown with Python stack trace (matching SJPlot pattern)
- No attempt to anticipate every edge case

### Common Error States

| Condition | Message |
|---|---|
| No carrier detected | "No carrier frequency detected. Ensure the file contains a test signal or motor FG signal." |
| File too short (< 10s after trimming) | "Signal too short for valid W&F measurement. At least 10 seconds of carrier signal required." |
| Unsupported format | "Unsupported file format. Please use WAV or FLAC." |
| Sample rate too low | "Sample rate too low (minimum 44.1 kHz)." |
| Carrier too high for sample rate | "Detected carrier ({freq} Hz) requires a higher sample rate than the file provides after downsampling. Cannot process." |
| File exceeds duration cap | "File exceeds maximum duration (120s). Please trim the file." |
| PyScript failed to load | "Analysis engine failed to load. Try refreshing the page." |
| Processing failure | "Analysis failed: {top-line from exception}" + expandable trace |

---

## Configurable Constants

Defined in one place (e.g., `constants.js` or config module):

```javascript
const CONFIG = {
  // Measurement constraints
  MIN_MEASUREMENT_SECONDS: 10,      // hard minimum for loop selection
  DRIFT_MIN_SECONDS: 20,            // minimum for drift calculation
  MAX_FILE_DURATION_SECONDS: 120,   // file duration cap
  MIN_SAMPLE_RATE: 44100,           // reject files below this

  // Adaptive downsample targets
  DOWNSAMPLE_LOW_CARRIER_HZ: 500,   // carriers below this → 10kHz target
  DOWNSAMPLE_LOW_TARGET: 10000,      // target rate for low carriers
  DOWNSAMPLE_HIGH_TARGET: 48000,     // target rate for higher carriers (up to 4.8kHz)

  // Export defaults
  EXPORT_DEFAULT_ZOOMED_SECONDS: 10,  // Plot 1 when no region selected
  EXPORT_FULL_VIEW_SECONDS: 60,       // Plot 2 max / legibility cap

  // Pre-processing
  SIGNAL_TRIM_THRESHOLD_DB: -20,    // TBD — dB below midpoint RMS

  // Spectrum
  MAX_HARMONIC_PEAKS: 12,           // auto-tag top N peaks
  SPECTRUM_PEAK_THRESHOLD: 0.08,    // fraction of max for peak detection

  // Polar
  POLAR_PCT_PER_DIV: 0.1,          // % deviation per radial tick
  POLAR_DIVISIONS: 20,

  // Histogram
  HISTOGRAM_BINS: 256,
  HISTOGRAM_MIN_RANGE_PCT: 0.1,    // minimum ±X% axis range
};
```

---

## Mobile Considerations

- Mobile is a requirement
- May shed features for usability on small screens (TBD which features)
- Harmonic selection via chip/pill list instead of click-on-peaks
- Touch gestures for waveform zoom/pan (pinch, swipe)
- Responsive panel layout — stack vertically, full-width panels

---

## Future Considerations (Not v1)

- **Multi-file comparison** — load two files, show metrics side-by-side (before/after motor service, etc.)
- **RPM auto-detection** — attempt from rotation fundamental; needs reliability assessment
- **Additional export formats** — CSV/JSON data export

---

## Reference Projects

| Project | What to borrow |
|---|---|
| Browser-ABX | Layout/theme architecture, waveform UX (zoom/pan/gestures/loop handles), FLAC decoder integration, embed patterns |
| SJPlot/online | PyScript/Pyodide integration pattern, JS↔Python data bridge via window globals, mini-coi.js, file loading (drag-drop + URL), error display with stack trace |
