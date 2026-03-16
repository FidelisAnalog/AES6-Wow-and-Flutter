# AES6 Wow & Flutter Analyzer — SPA Architecture Spec

Working title: **AES6 W&F Analyzer**

## Overview

Single-page application for AES6-2008 (s2013) conformant wow & flutter analysis, compatible with DIN 45507 and IEC 60386. Converts the `fg_analyze.py` prototype into an interactive web tool.

Key differentiator: self-adaptive carrier detection and auto-tuned prefilter supporting carrier frequencies from 50 Hz to 3.15 kHz. No other open-source W&F analyzer handles carriers below ~1 kHz.

### Transport Agnosticism

The AES6-2008, DIN 45507, and IEC 60386 standards define W&F measurement methodology — they are transport-agnostic. The weighting filter, band definitions (wow/flutter/drift), and peak/RMS calculations are identical whether the source is a turntable, tape deck, or any other transport mechanism. The entire measurement pipeline (carrier detection → zero crossings → frequency extraction → AES6 metrics) produces valid, standards-compliant results regardless of transport type.

Transport-specific features (polar plot, motor harmonic identification, RPM) are layered on top of the core pipeline and are optional. The UI must not bake in turntable assumptions — labels, controls, and optional features should adapt based on transport type selection (see Advanced Panel).

---

## Stack

| Layer | Technology |
|---|---|
| Front-end framework | React + Vite |
| Component library | MUI (Material UI) |
| Signal processing | Pyodide (Python in-browser) in a **Web Worker** — never blocks main thread |
| FLAC decoding | @wasm-audio-decoders/flac (WASM, bit-perfect) |
| Waveform rendering | SVG or Canvas (adapted from Browser-ABX patterns) |
| Plot rendering | Custom SVG / lightweight charting (TBD per plot type) |
| CORS isolation | mini-coi.js service worker (for SharedArrayBuffer / Pyodide) |

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
        ▼  (downsampled PCM via postMessage transferable)
        │
  ══════╪═══════════════════════════════════════════
        │  Web Worker boundary (UI never blocks)
  ══════╪═══════════════════════════════════════════
        │
Python Pipeline (Pyodide in Web Worker) — full file, one call
  ├── Carrier detection (own FFT — pipeline stands on its own)
  ├── Bandpass prefilter (auto-tuned, coefficients cached)
  ├── Zero-crossing detection (sinc interp + Brent's method)
  ├── Per-cycle frequency extraction
  ├── Edge trimming + outlier rejection
  ├── Uniform grid interpolation
  ├── AES6 weighting + band separation
  ├── Status messages → postMessage → main thread (progress updates)
  └── Returns structured JSON (not images)
        │
  ══════╪═══════════════════════════════════════════
        │  postMessage (result JSON)
  ══════╪═══════════════════════════════════════════
        │
        ▼
JS Rendering (main thread)
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
6. UI shows processing indicator during re-run (non-blocking — Worker handles processing while main thread stays responsive)

---

## Python Module Architecture

Refactor `fg_analyze.py` into a clean module callable from Pyodide. Single entry point for full analysis, returns all data needed for JS rendering.

### Web Worker Requirement

**Pyodide MUST run in a dedicated Web Worker.** The Python pipeline takes 10–60+ seconds depending on file length and carrier frequency. Running on the main thread freezes the UI completely — no progress updates, no cancel, no responsiveness. This is not acceptable.

Architecture:
- `src/workers/pyodideWorker.js` — Web Worker that loads Pyodide, fetches and executes `wf_analyzer.py`, exposes `analyze`/`analyzeRegion` via `postMessage`
- `src/services/pyBridge.js` — Main-thread interface. Sends PCM data to worker via `postMessage` with `Transferable` ArrayBuffer (zero-copy). Receives status updates and results via `postMessage` callbacks.
- **No `<script type="py">` in index.html** — Pyodide is loaded entirely within the Worker, not via PyScript tags on the main thread
- Status callback: Worker posts `{type: 'status', message: '...'}` messages during processing → pyBridge dispatches to UI
- Result: Worker posts `{type: 'result', data: {...}}` with the full analysis JSON
- Error: Worker posts `{type: 'error', message: '...', traceback: '...'}`
- PCM transfer: Main thread sends `{type: 'analyze', pcm: Float64Array.buffer, sampleRate: int}` with the buffer as a transferable (zero-copy to worker)

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
        'wow_unweighted_rms': float, # % (band-separated from unweighted signal)
        'flutter_unweighted_rms': float, # %
        'peak_weighted': float,     # %
        'rms_weighted': float,      # %
        'drift_rms': float,         # %
        'wow_rms': float,           # % (band-separated from weighted signal)
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

### Responsiveness

The waveform and all interactive elements (handles, overview bar, gestures) must reflow and scale correctly at any viewport width, from phone to ultrawide. This is a core requirement, not a polish item.

### Axis Conventions

- **X-axis:** Time (seconds)
- **Y-axis:** Speed Deviation (%), symmetric around 0, auto-scaled by default
- **Future: custom axis scaling** — per-plot user-selectable Y-axis range for visual comparison across files. Setting a fixed range (e.g., ±0.2%) makes side-by-side comparison far easier. Components must accept explicit axis bounds as props from the start so this can be wired up without refactoring. Same pattern applies to spectrum, polar, and histogram.

### Measurement Region Constraints

- **Hard minimum: 5 seconds** — loop handles snap to enforce this, user cannot select less
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
| DIN/IEC Unwtd Wow | X.XXXX% | Band-separated from unweighted signal |
| DIN/IEC Unwtd Flutter | X.XXXX% | Band-separated from unweighted signal |
| DIN/IEC Wtd Peak (2σ) | ±X.XXXX% | |
| DIN/IEC Wtd RMS (JIS) | X.XXXX% | JIS designation in label |
| DIN/IEC Wtd Wow | X.XXXX% | Band-separated from weighted signal |
| DIN/IEC Wtd Flutter | X.XXXX% | Band-separated from weighted signal |
| Drift | X.XXXX% | Non-standard; hidden if region < 20s |
| Carrier Frequency | XXX.X Hz | Detected carrier |

- Tooltip/info icon on weighted vs unweighted explaining the standard
- Updates when measurement region changes (after Python re-processing)

---

## Optional Plots

Expandable area below the spectrum. User chooses which to show.

### Polar Plot

- 0.1% per radial division, 20 divisions
- Angular ticks at 45° intervals (0°–315°, platter/capstan position)
- User-selectable number of revolutions to display
- "0.1%/div" scale annotation
- Revolution segmentation uses measured period from Python (not nominal RPM) — see note below
- **Future:** When spectrum peaks are selected, indicate where each decomposed harmonic's energy lands on the polar plot (angular positions where the component peaks). Connects spectral and rotational views for diagnosing position-dependent vs uniform harmonics.

**Revolution period accuracy:** Nominal RPM (e.g., 33⅓) gives a nominal period of 1.8s, but real turntable speed drifts. For 1–2 revolutions the error is negligible, but at higher revolution counts the cumulative drift causes the polar plot to smear. The Python module should provide a measured revolution period (from the rotation fundamental in the spectrum, or from the deviation signal autocorrelation) so the polar plot segments accurately. This is a future enhancement — use nominal RPM initially, add measured period when available.

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
- **Transport type** — turntable (default) or tape deck. Controls which parameters are shown, what labels are used, and which optional features are available. The core AES6 metrics are identical for both — transport type only affects optional/contextual features.
  - **Turntable:** RPM presets (33⅓, 45, 78), motor params (slots, poles), polar plot available, motor harmonic identification available
  - **Tape deck:** Speed presets (1⅞, 3¾, 7½, 15, 30 ips). Tape has linear speed, not RPM — though the capstan rotates, its RPM depends on capstan diameter which users rarely know. Motor params and polar plot hidden by default (polar could map to capstan revolution if RPM is manually entered, but this is niche). Motor harmonic identification not applicable in the turntable sense — tape mechanisms have different vibration sources (capstan bearing, pinch roller, idler).
  - **Custom / other:** Allow freeform use for any transport. Custom RPM input always available regardless of transport type.
- **Motor parameters** (turntable only) — slots, poles inputs (optional). When motor params change, re-run harmonic identification on existing peaks (no re-processing needed — just re-labeling).
- **RPM / rotation speed** — numeric input with presets per transport type. Custom value always allowed (any transport, any speed — W&F applies to any mechanism). Used for polar plot segmentation and motor harmonic identification.
- **RPM auto-detect** — attempt to identify rotation fundamental from spectrum (strongest sub-2Hz peak × 60). Show confidence indicator; user can accept or override.

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
5. **Duration cap** — 120 seconds (configurable constant). If file exceeds cap after trimming, truncate to 120s and inform the user (not an error — just a notice).

---

## Export / Download

### Individual Plot Downloads

Each visible plot downloadable as PNG and/or raw data:
- Deviation waveform — **re-rendered as presentation plot** for the current selected region (not a screenshot of the interactive view)
- Spectrum — clean plot matching prototype styling
- Polar — clean plot
- Histogram — clean plot

**Every exported plot must be self-contained and presentation-ready:**
- Title (e.g., "Deviation Trace — filename.wav")
- Measurement summary block (carrier freq, relevant AES6 metrics)
- Proper axis labels with units, grid lines, legend where applicable
- Consistent typography and styling across all exports
- These go into reports — they must look professional

**Data export (per-plot and bundled):**
- Per-plot CSV/JSON download of the underlying numerical data
- Deviation: time + deviation % columns; Spectrum: freq + amplitude + peaks; Polar: per-revolution angle + deviation; Histogram: bin edges + counts; Metrics: JSON with all values
- Data files include metadata header (filename, carrier, sample rate, measurement region)
- "Export All Data" option: ZIP with all data files + plot PNGs

### Full Test Set Download

Mirrors prototype's two-plot approach:

- **If region selected:** Plot 1 = selected region, Plot 2 = 60s view
- **If no region selected:** Plot 1 = 5s view, Plot 2 = 60s view
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
| `loadAudio` | `{buffer: ArrayBuffer, fileName?: string}` | Send raw WAV or FLAC file bytes directly. SPA decodes using its own decoders (same path as drag-drop, just a different input source). |

**Outbound (app → host):**

| Message Type | Payload | Description |
|---|---|---|
| `resize` | `{height: number}` | Window height for iframe sizing |
| `ready` | `{}` | App fully initialized (React + Pyodide Worker + all dependencies). Ready to accept files. |
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
| File too short (< 5s after trimming) | "Signal too short for valid W&F measurement. At least 5 seconds of carrier signal required." |
| Unsupported format | "Unsupported file format. Please use WAV or FLAC." |
| Sample rate too low | "Sample rate too low (minimum 44.1 kHz)." |
| Carrier too high for sample rate | "Detected carrier ({freq} Hz) requires a higher sample rate than the file provides after downsampling. Cannot process." |
| File exceeds duration cap | "File truncated to 120s for analysis." (info notice, not error) |
| Pyodide Worker failed to load | "Analysis engine failed to load. Try refreshing the page." |
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
- **Custom axis scaling UI** — per-plot controls for setting explicit Y-axis ranges (components accept bounds from the start; the UI comes later)
- **Harmonic markers on polar plot** — show where selected spectrum peaks land angularly on the polar view
- **Measured revolution period** — Python module computes actual revolution period from rotation fundamental or autocorrelation, replacing nominal RPM for polar plot segmentation. Critical for accuracy at high revolution counts where cumulative drift from nominal RPM causes smearing.

---

## Reference Projects

| Project | What to borrow |
|---|---|
| Browser-ABX (https://acidtest.io) | Layout/theme architecture, waveform UX (zoom/pan/gestures/loop handles), FLAC decoder integration, embed patterns |
| SJPlot/online (https://sjplot.com/online) | Pyodide integration pattern (note: SJPlot uses main-thread PyScript — we use a Web Worker instead), mini-coi.js, file loading (drag-drop + URL), error display with stack trace |
