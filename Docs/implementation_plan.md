# AES6 W&F Analyzer — Implementation Plan

Detailed phase-by-phase implementation plans for the VS Code agent to execute against.
Reference: `Docs/spa_architecture_spec.md` for full spec.

---

## Phase 1: Prove the Bridge

**Goal:** End-to-end proof that React + PyScript + the Python pipeline works in-browser. Drop a WAV file, get metrics displayed. No polish, no fancy UI — just prove the architecture.

### 1.1 Project Scaffolding

- `npm create vite@latest` — React template (plain JS/JSX, no TypeScript)
- Install MUI: `@mui/material @emotion/react @emotion/styled`
- Set up project structure:
  ```
  /
  ├── public/
  │   ├── mini-coi.js          # service worker for CORS isolation
  │   └── python/
  │       └── wf_analyzer.py   # Python module (refactored from fg_analyze.py)
  ├── src/
  │   ├── App.jsx
  │   ├── main.jsx
  │   ├── config/
  │   │   └── constants.js     # all configurable constants
  │   ├── components/
  │   │   └── ...
  │   ├── hooks/
  │   │   └── ...
  │   ├── workers/
  │   │   └── pyodideWorker.js # Web Worker: loads Pyodide + wf_analyzer.py
  │   ├── services/
  │   │   ├── pyBridge.js      # main-thread ↔ Worker bridge (postMessage)
  │   │   └── audioLoader.js   # file loading + pre-processing
  │   └── theme/
  │       └── ...
  ├── index.html               # PyScript script tags loaded here
  └── vite.config.js
  ```

### 1.2 Python Module Refactor

Refactor `fg_analyze.py` → `public/python/wf_analyzer.py`. Key changes:

**a) Remove all matplotlib / plotting code.** The module returns data only.

**b) Remove CLI / argparse.** Module is called programmatically.

**c) Remove file I/O.** Module receives PCM data + sample rate, not file paths.
  - Current: `load_wav(filepath)` reads from disk
  - New: `analyze(pcm_array, sample_rate, channel=0)` receives data directly

**d) Structured return.** `analyze()` returns a dict with everything the front-end needs:
  ```python
  {
      # Deviation trace (for waveform display)
      't_uniform': ndarray,        # time grid (seconds)
      'deviation_pct': ndarray,    # speed deviation (%)

      # Spectrum data
      'spectrum_freqs': ndarray,   # modulation frequencies (Hz)
      'spectrum_amplitude': ndarray, # % RMS/√Hz
      'harmonic_peaks': [          # top N peaks, sorted by amplitude
          {'freq': float, 'amplitude': float, 'rms': float, 'index': int},
      ],

      # Polar + histogram source data
      'inst_freq': ndarray,        # instantaneous frequency
      'f_mean': float,             # mean carrier frequency
      'output_rate': float,        # deviation signal sample rate

      # AES6 metrics
      'aes6': {
          'peak_unweighted': float,
          'rms_unweighted': float,
          'wow_unweighted_rms': float,
          'flutter_unweighted_rms': float,
          'peak_weighted': float,
          'rms_weighted': float,
          'drift_rms': float,
          'wow_rms': float,           # from weighted signal
          'flutter_rms': float,       # from weighted signal
      },

      # Signal info
      'duration': float,
      'carrier_freq': float,
      'wf_peak_2sigma': float,
      'wf_peak_to_peak': float,

  }
  ```

**e) Add spectrum computation** to `analyze()`. Move the FFT + peak detection logic from the old `plot_results()` into the pipeline:
  ```python
  def compute_spectrum(deviation_pct, output_rate, max_peaks=12, peak_threshold=0.08):
      """Compute spectrum and detect harmonic peaks. Returns (freqs, amplitude, peaks_list)."""
  ```

**f) Region re-processing — no separate entry point needed.**
  The front-end slices the raw PCM for the selected region and calls the same `analyze()` function. No `analyze_region()` in Python. The full pipeline re-runs on the shorter segment, returning the same result structure. The front-end is responsible for:
  - Preserving the full-file waveform data (t_uniform, deviation_pct) so it never changes
  - Preserving the full-file measurement results so the user can revert
  - Storing the region result separately from the full-file result

**g) Motor harmonic labeling.** Keep the identification logic but make it optional:
  ```python
  def identify_motor_harmonics(peaks, motor_slots, motor_poles, rpm, freq_resolution):
      """Tag peaks with motor harmonic identities. Returns annotated peaks list."""
  ```
  The identification logic itself is not finalized — the classification rules will evolve.
  Peak data structure must cleanly separate immutable detection data (freq, amplitude, RMS,
  FFT bin index) from a flexible/nullable identity layer (source label, harmonic order,
  matched fundamental, etc.) with peak index mapping. Identity fields are optional/nullable
  and the identity schema must be loose enough to accommodate changes to the classification
  logic without touching the detection data or the front-end contract.
  Labels are re-computed when motor params change — no re-processing needed.

**h) Keep all signal processing constants internal** (PREFILTER_BW_FACTOR, OUTLIER_THRESH_PCT, etc.). Not exposed to the front-end.

**i) Ensure Pyodide compatibility:**
  - `scipy` is available in Pyodide
  - `numpy` is available in Pyodide
  - Remove any `os` / `sys` / filesystem dependencies
  - Replace `print()` statements with a callback or logging mechanism that can push status to JS

### 1.3 Pyodide Web Worker Integration

**Pyodide runs in a dedicated Web Worker — the main thread must never block during analysis.**

**a) Remove PyScript `<script type="py">` from `index.html`.** No PyScript tags on the main thread. Pyodide is loaded entirely within the Worker. Keep `mini-coi.js` for CORS isolation (SharedArrayBuffer support).

**b) Copy `mini-coi.js`** from SJPlot/online into `public/`. This service worker injects COOP/COEP headers for SharedArrayBuffer support (required by Pyodide).

**c) Create `src/workers/pyodideWorker.js`:**
  Web Worker that:
  - Loads Pyodide via `importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.x/full/pyodide.js')` (pin version)
  - Loads micropip, installs numpy + scipy
  - Fetches `wf_analyzer.py` from `/python/wf_analyzer.py` and executes it
  - Wires up a status callback that posts `{type: 'status', message}` to main thread
  - Listens for `postMessage` commands:
    - `{type: 'analyze', pcm: ArrayBuffer, sampleRate: int}` → runs `analyze()`, posts `{type: 'result', data}` or `{type: 'error', message, traceback}`
  - Posts `{type: 'ready'}` when Pyodide + wf_analyzer.py are fully loaded
  - PCM received as `ArrayBuffer` (transferred, zero-copy), converted to numpy array inside Worker

**d) Create `src/services/pyBridge.js`:**
  Main-thread interface:
  - Spawns the Worker on init
  - Provides `analyzeFull(pcmData, sampleRate)` → Promise<AnalysisResult>
  - Sends PCM as `Transferable` ArrayBuffer (zero-copy to Worker)
  - Dispatches Worker messages: `status` → `onStatus` callback, `result` → resolve Promise, `error` → `onError` callback / reject Promise
  - Exposes `isReady()` state (true after Worker posts `ready`)
  - Exposes `onStatus(cb)`, `onResult(cb)`, `onError(cb)` for UI binding

**e) Data flow through Worker:**
  ```javascript
  // Main thread → Worker (pyBridge.js)
  const buffer = pcmFloat64Array.buffer;
  worker.postMessage(
    { type: 'analyze', pcm: buffer, sampleRate },
    [buffer]  // transfer, not copy
  );

  // Worker → Main thread
  // During processing: { type: 'status', message: 'Finding zero crossings...' }
  // On completion:     { type: 'result', data: { ...analysisResult } }
  // On error:          { type: 'error', message: '...', traceback: '...' }
  ```

  ```python
  # Inside Worker (Python side)
  import numpy as np
  # PCM arrives as JS ArrayBuffer, convert via Pyodide
  pcm = np.asarray(pcm_js_proxy, dtype=np.float64)
  result = analyze(pcm, sample_rate)
  # Result serialized as JSON, posted back to main thread
  ```

### 1.4 Minimal File Input

- Simple drag-drop zone (MUI Box + event handlers)
- WAV parsing: `FileReader.readAsArrayBuffer()` → extract PCM as Float32Array
  - Parse RIFF header, extract sample rate, channels, bit depth
  - Convert to Float32Array
- No FLAC yet, no URL loading, no pre-processing (downsample, trim) — just raw WAV → Python

### 1.5 Minimal Stats Display

- MUI Card showing the AES6 metrics dict returned from Python
- No styling, just prove data flows end-to-end

### 1.6 Validation

- Drop a known WAV file (from `Data/` directory)
- Compare metrics output against the Python CLI script output
- They must match exactly (same pipeline, same data)

---

## Phase 2: File Input + Stats + Theme

**Goal:** Production-quality file input, stats panel, and theme system. The app should look good and handle files properly, even though the waveform isn't built yet.

### 2.1 Theme System

Reference: Browser-ABX theme implementation.

- Create `src/theme/` with dark and light palettes
- Borrow Browser-ABX color palette as starting point
- OS preference detection via `prefers-color-scheme` media query
- Manual toggle (Ctrl+Shift+T keyboard shortcut)
- Query param override: `?theme=dark|light|system`
- postMessage override: `setTheme` message from host
- Priority: postMessage > query param > manual toggle > OS preference
- Theme context provider wrapping the app

### 2.2 Layout System

Reference: Browser-ABX Layout component.

- Create `src/components/Layout/` — Layout container component
- Panel order defined as props/config (trivial to rearrange):
  1. Header
  2. File Input
  3. Stats
  4. Waveform (placeholder for Phase 3)
  5. Spectrum (placeholder for Phase 4)
  6. Advanced (collapsible)
  7. Optional Plots (expandable)
  8. Footer
- Gutter control: normal mode vs embed mode (drop gutters)
- `?embed=true` query param hides header/footer, compact layout

### 2.3 File Input Panel

- Drag-drop zone with visual feedback (dragover highlight, file icon)
- Click-to-browse button (`<input type="file" accept=".wav,.flac">`)
- File info display after load (name, duration, sample rate, channels)
- Error display for rejected files (wrong format, too short, etc.)

### 2.4 JS Pre-processing Pipeline

Create `src/services/audioLoader.js`:

**a) WAV Parser**
  - Parse RIFF/WAVE header
  - Extract PCM data as Float32Array
  - Handle 16-bit, 24-bit, 32-bit int and 32-bit float formats

**b) Quick carrier detection (JS-side, for downsample decision only)**
  - FFT on first 2 seconds of audio
  - Find dominant spectral peak above 20 Hz
  - This is only used to choose downsample target — Python runs its own detection

**c) Adaptive downsample**
  - Carrier < 500 Hz → target 10 kHz
  - Carrier < 4.8 kHz → target 48 kHz
  - Skip if file sample rate ≤ target
  - Use `OfflineAudioContext` for anti-alias + decimation:
    ```javascript
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();
    ```
  - Validate: if carrier > 4.8 kHz and original SR is only 48 kHz, error

**d) Non-signal trimming**
  - Compute RMS of middle 10% of file (guaranteed to be signal)
  - Scan from head: find first point where running RMS (short window) exceeds threshold (midpoint RMS − X dB, configurable)
  - Scan from tail: same in reverse
  - Trim with minimal margin (e.g., ~50–100ms before onset — err on the side of trimming
    close to the signal. The concern is cutting into signal, not leaving dead air.
    Benchmark with real files to find the right value.)

**e) Duration cap enforcement**
  - If trimmed signal > MAX_FILE_DURATION_SECONDS, truncate to cap and show info notice ("File truncated to 120s for analysis.") — not an error, just inform the user

**f) Channel extraction**
  - Default: left channel (index 0)
  - If stereo, extract selected channel (advanced panel controls this later)

### 2.5 Stats Panel

- MUI Card/Paper component
- Grid layout for metrics:
  - DIN/IEC Unwtd Peak (2σ), RMS, Wow, Flutter
  - DIN/IEC Wtd Peak (2σ), RMS (JIS), Wow, Flutter
  - Drift (non-standard, conditionally shown — hidden with message if region < 20s)
  - Carrier Frequency
- Tooltip/info icons on weighted vs unweighted (brief explanation of the standard)
- Values formatted to 4 decimal places (matching prototype)
- Placeholder state when no file loaded
- Loading state during processing

### 2.6 Constants Module

Create `src/config/constants.js` with all configurable values per spec. Single source of truth.

### 2.7 Error Handling

- Error display component (top-line message + expandable stack trace)
- Wire up all pre-processing error states from the spec
- Python pipeline errors caught and displayed

---

## Phase 3: Deviation Waveform

**Goal:** Interactive deviation waveform with zoom, pan, overview bar, and loop handles. This is the core UI and the most complex component.

### 3.1 Waveform Component Architecture

Reference: Browser-ABX Waveform component. Adapt patterns, not code — the data format is different (deviation % vs audio samples).

Create `src/components/Waveform/`:
  ```
  Waveform/
  ├── Waveform.jsx          # main container
  ├── WaveformMain.jsx      # zoomed view (SVG or Canvas)
  ├── WaveformOverview.jsx  # overview bar with viewport indicator
  ├── LoopHandles.jsx       # draggable region selection handles
  ├── TimeAxis.jsx          # time axis with labels
  ├── DeviationAxis.jsx     # Y-axis (% deviation)
  ├── useWaveformGestures.js # zoom/pan gesture state machine
  └── useWaveformData.js    # data downsampling for display
  ```

### 3.2 Data Downsampling for Display

The deviation array can be large (e.g., 3000 points/sec × 120s = 360K points). Can't render all as SVG paths at all zoom levels.

- `useWaveformData` hook: given the current viewport (time start/end) and pixel width, prepare the deviation array for display
- This is measurement data, not orientation — visual fidelity loss is not acceptable at any zoom level
- Reference Browser-ABX waveform rendering approach (not SJPlot — SJPlot's downsampling is acceptable there because it's for orientation only)
- At high zoom, render every point; at low zoom, use min/max per bin to preserve peaks while reducing point count, but ensure the visual output is faithful to the data

### 3.3 Main Waveform View

- Renders the deviation trace for the current viewport
- Horizontal zero line
- 2σ reference lines (±peak 2σ, dashed red)
- Y-axis auto-scaled, symmetric around 0
- X-axis in seconds
- Theme-aware colors
- **Fully responsive:** waveform and all interactive elements (handles, overview bar,
  gestures) must reflow and scale correctly at any viewport width, from phone to
  ultrawide. This is not a Phase 5 polish item — responsiveness is core to the
  waveform component from day one.

### 3.4 Overview Bar

- Compact view of entire file's deviation trace
- Viewport indicator (semi-transparent rectangle showing what the main view displays)
- Draggable edge handles on viewport indicator for resizing the view
- Click to jump viewport
- Drag viewport indicator body to pan

### 3.5 Zoom and Pan

`useWaveformGestures` hook — state machine for gesture handling:

- **Mouse wheel:** zoom in/out centered on cursor position
- **Click-drag on main view:** pan horizontally
- **Pinch-zoom:** mobile/trackpad zoom
- **Double-click:** reset to full view
- Clamp viewport to signal boundaries
- Smooth animation for zoom transitions (required)
- Momentum scroll/pan (required)

### 3.6 Loop Handles (Measurement Region)

`LoopHandles` component — adapted from Browser-ABX `LoopRegion.jsx` + `Waveform.jsx` handle pattern:

- Two draggable handles (start/end) visible in both overview and main view
- **Handle lines and triangles are ALWAYS visible**, even at default full-file position — following Browser-ABX pattern where visuals (vertical lines + 8px corner triangles at top/bottom) render unconditionally. Only the dimming/shading of regions outside the selection is gated by `!isFullFile`.
- Default: full file (handles at start and end)
- Drag to select measurement region
- **Hard enforce 5s minimum** — handles snap to maintain at least 5s selection
- Display selected duration near the handles or in a label
- Visual shading of the selected region vs unselected
- When region < 20s: show indicator that drift requires 20s
- Interaction: HTML overlay divs (outside scroll wrapper) provide hit areas; visuals rendered by canvas. Same architecture as Browser-ABX.

### 3.7 Measure Button

- Button appears when loop handles are moved from default (full file)
- Label: **"Measure"** for first region analysis, **"Re-measure"** after that
- Front-end slices raw PCM for the selected region and calls `analyzeFull()` — no separate `analyzeRegion()` needed
- Disabled during processing, shows spinner
- If clicked while processing is in-flight, cancel previous and start new
- **Full-file results preserved:** App maintains both the full-file result and the most recent region result. When handles are reset to full file, the original full-file metrics are restored without re-processing. The deviation waveform always shows the full-file data.

### 3.8 Axis Scaling

- **Default:** Y-axis auto-scaled to data range, symmetric around 0. This is the right
  default and should not change.
- **Future enhancement (custom scaling):** Per-plot user-selectable axis scaling. Needed
  for visual comparison across files — setting a fixed Y-axis range (e.g., ±0.2%) makes
  it easy to compare two measurements side by side. Build the waveform component so the
  Y-axis range is a prop/state value (not hardcoded to auto), so custom scaling can be
  wired up later without refactoring. Same pattern applies to spectrum Y-axis and all
  optional plots. The UI for setting custom ranges comes later, but the components must
  accept explicit axis bounds from the start.

### 3.9 Harmonic Overlay Preparation

- Waveform component accepts an optional `harmonicOverlays` prop (array of time-series data)
- When present, renders additional traces on top of the deviation
- When harmonics are overlaid, reduce deviation trace opacity
- Actual harmonic data comes from Phase 4

---

## Phase 4: Spectrum + Harmonics

**Goal:** Spectrum plot with selectable harmonic peaks that overlay on the deviation waveform.

### 4.1 Spectrum Plot Component

Create `src/components/Spectrum/`:
  ```
  Spectrum/
  ├── Spectrum.jsx           # main container
  ├── SpectrumPlot.jsx       # the actual plot (SVG or charting lib)
  ├── PeakMarkers.jsx        # clickable peak markers
  ├── PeakChips.jsx          # mobile: scrollable chip list
  └── useSpectrumData.js     # data preparation
  ```

### 4.2 Spectrum Plot Rendering

- Log frequency X-axis, starting at 0.4 Hz
- X-axis ticks at: 0.5, 1, 2, 5, 10, 20, 50 Hz
- Y-axis: % RMS/√Hz
- Line plot of spectrum amplitude vs frequency
- Theme-aware colors
- Y-axis auto-scaled by default; accept explicit bounds prop for future custom scaling (see 3.8)

### 4.3 Peak Detection + Display

- Top 8–12 peaks auto-tagged (from Python data)
- Colored triangle markers (▼) at each peak, matching prototype style
- Peak label: frequency (Hz) + RMS (%)
- Motor harmonic labels when motor params provided (from Advanced panel)

### 4.4 Peak Selection — Desktop / Tablet

- Click/tap on a peak marker to toggle selection
- Selected: highlighted color, full opacity
- Unselected: dimmed
- Multi-select supported

### 4.5 Peak Selection — Phone

- Scrollable horizontal chip/pill list below the spectrum
- Each chip shows frequency + RMS
- Tap to toggle selection
- Synchronized with peak markers on the plot

### 4.6 Harmonic Overlay on Waveform

When peaks are selected:
1. For each selected peak, extract the corresponding frequency component from the deviation signal
   - Bandpass filter the deviation signal around the peak frequency (narrow band)
   - This produces a time-series showing that harmonic's contribution
2. Pass these time-series to the Waveform component as `harmonicOverlays`
3. Each overlay rendered in the peak's assigned color
4. Deviation datum (main trace) becomes less prominent (reduced opacity)

**Implementation note:** Harmonic extraction is already solved in `Utilities/fg_harmonics.py`.
  The `extract_harmonic()` function uses 4th-order Butterworth SOS bandpass via `sosfiltfilt`
  with smart bandwidth selection (80% of f_rot to avoid sideband capture, 0.3 Hz floor,
  or 5% of center freq when f_rot is unknown). The overlay pattern (total signal dimmed,
  components colored by identity) is also already implemented. Refactor this into the
  Python module as-is — do not rewrite. Batch call for multiple harmonics to avoid
  JS↔Python round-trip overhead.

### 4.7 Motor Harmonic Identification

- When motor params (slots, poles, RPM) are provided via Advanced panel:
  - Call `identify_motor_harmonics()` on the peaks list
  - Color-code by source: Rotation (red), Electrical (green), Slot passing (purple), Torque ripple (orange)
  - Unidentified peaks get sequential colors from a neutral palette
- When motor params not provided: all peaks use the neutral palette

---

## Phase 5: Polish + Remaining Features

**Goal:** Everything else. Each sub-item is relatively independent and can be done in any order.

### 5.1 FLAC Support

- Install `@wasm-audio-decoders/flac`
- In `audioLoader.js`: detect FLAC by file header (fLaC magic bytes) or extension
- Decode FLAC → PCM Float32Array using the WASM decoder
- Feed into the same pre-processing pipeline as WAV
- Reference: Browser-ABX FLAC integration

### 5.2 URL File Loading

- Parse `?file=<URL>` query parameter on app load
- `fetch()` the URL → ArrayBuffer → process as WAV or FLAC
- Dropbox URL handling: auto-append `?dl=1` if dropbox.com URL detected
- Show loading indicator during fetch
- Error handling for CORS failures, 404, etc.

### 5.3 Advanced Panel

Create `src/components/AdvancedPanel/`:

- MUI Accordion (collapsible)
- **Channel selector:** L/R radio buttons, only shown for stereo files. Changing channel triggers full re-analysis.
- **Transport type:** Turntable (default) or Tape deck. Core AES6 metrics are identical
  for both — transport type only affects optional/contextual features.
  - Turntable: RPM presets (33⅓, 45, 78), motor params (slots, poles), polar plot, motor
    harmonic identification
  - Tape deck: Speed presets (1⅞, 3¾, 7½, 15, 30 ips). No RPM in the traditional sense
    (capstan RPM depends on capstan diameter which users rarely know). Motor params and
    polar plot hidden by default. Motor harmonic ID not applicable — tape mechanisms have
    different vibration sources (capstan bearing, pinch roller, idler).
  - Custom/other: freeform use for any transport. Custom RPM always available.
- **Motor parameters** (turntable only):
  - Motor slots (number input)
  - Motor poles (number input)
  - When motor params change, re-run harmonic identification on existing peaks (no re-processing needed — just re-labeling)
- **RPM / rotation speed:**
  - Numeric input with presets per transport type
  - Turntable presets: 33.333, 45, 78
  - Custom value always allowed (any transport, any speed — W&F applies to any rotating or moving media)
  - Used for polar plot segmentation and motor harmonic identification
  - RPM auto-detect button: finds strongest sub-2 Hz peak in spectrum × 60. Shows detected value with confidence indicator. User can accept or override.

### 5.4 Optional Plots

Create `src/components/OptionalPlots/`:

**a) Expandable container**
  - Area below spectrum where user can toggle additional views
  - MUI Accordion or button group to show/hide each plot

**b) Polar Plot** (`PolarPlot.jsx`)
  - SVG-based polar coordinate rendering
  - 0.1% per radial division, 20 divisions
  - Angular ticks at 45° intervals (0°–315°), labeled as platter/capstan position
  - "0.1%/div" scale annotation box
  - User-selectable number of revolutions to display (input control)
  - Color-code each revolution (tab10 palette)
  - Data: `inst_freq` array from Python, segment by revolution using nominal period (60/RPM)
  - **Future: measured revolution period.** Nominal RPM (e.g., 33⅓ → 1.8s) drifts on real
    transports. At 1–2 revolutions the error is negligible, but at higher counts cumulative
    drift causes the plot to smear. Python module should provide a measured period (from
    rotation fundamental or autocorrelation) to replace nominal RPM for segmentation.
    Initially use nominal; add measured period when available from Python.
  - **Future enhancement (harmonic markers on polar):** When spectrum peaks are selected
    (Phase 4), indicate where each decomposed harmonic's energy lands on the polar plot.
    E.g., if a 33 Hz slot-passing harmonic is selected, highlight the angular positions
    where that component peaks. This connects the spectral view to the spatial/rotational
    view — helps diagnose whether a harmonic is position-dependent or uniform around the
    platter. Design details TBD; accept selected peaks as a prop so the data path exists.

**c) Histogram** (`HistogramPlot.jsx`)
  - SVG bar chart or use a charting lib
  - 256 bins
  - X-axis: % deviation, symmetric around 0, minimum ±0.1%
  - Y-axis: density
  - Center line at 0
  - Accept explicit axis bounds props for future custom scaling (see 3.8)

### 5.5 Export / Download

Create `src/services/exportService.js`:

**a) Individual plot downloads**
  - Each plot component exposes a `renderForExport()` method that produces a clean PNG
  - For the deviation waveform: **re-render** the selected region (or current view) as a presentation-quality static plot — not a screenshot
  - Use an offscreen canvas or SVG → canvas → PNG pipeline
  - **Every exported plot must be presentation-ready and self-contained:**
    - Title (e.g., "Deviation Trace — filename.wav")
    - Measurement summary block: carrier freq, relevant AES6 metrics for that view
    - Proper axis labels with units, grid lines, legend where applicable
    - Consistent typography, spacing, and styling across all export types
    - These are meant to go into reports and comparisons — they must look professional,
      not like browser screenshots with a download button

**b) Full test set download**
  - Generate multiple PNGs:
    - Plot 1: selected region (or 5s default if no selection)
    - Plot 2: 60s view (or full file if < 60s)
    - Spectrum
    - Polar (if shown)
    - Histogram (if shown)
  - Bundle as individual downloads or a single ZIP (using JSZip or similar)
  - 60s maximum for any single deviation plot (legibility cap)

**c) Data export**
  - Per-plot CSV/JSON download of the underlying data:
    - Deviation waveform: time + deviation % columns (for the current view/selection)
    - Spectrum: frequency + amplitude columns, plus peaks list
    - Polar: per-revolution angle + deviation data
    - Histogram: bin edges + counts
    - AES6 metrics: JSON with all measurement values, carrier freq, file info
  - "Export All Data" option: ZIP containing all of the above plus the plot PNGs
  - Data files should be immediately usable — proper headers, units in column names,
    metadata block at top of CSV (filename, carrier, sample rate, measurement region)

**d) Download buttons**
  - Small download icon on each plot component (menu: PNG or data)
  - "Download All" button somewhere accessible (header? stats panel?)

### 5.6 Embed Support

**a) Query params:**
  - `?embed=true` — compact mode: hide header/footer, drop gutters
  - `?theme=dark|light|system` — initial theme
  - `?file=<URL>` — auto-load file (already in 5.2)
  - `?hidePanel=file,advanced,footer` — hide specific panels

**b) postMessage API** (per spec):
  - Inbound handler: `setTheme`, `loadFile`, `loadAudio`
  - `loadAudio`: receive `{buffer: ArrayBuffer, fileName?: string}` — raw WAV or FLAC file bytes from host. SPA decodes using its own decoders (same code path as drag-drop). This ensures consistent decoding behavior regardless of input source, and the SPA controls the FLAC decoder implementation.
  - Outbound: `resize`, `ready`, `stateChange`, `results`, `error`
  - `resize`: send on mount, on panel expand/collapse, on window resize (use ResizeObserver)
  - `ready`: send when React + PyScript + all deps are fully loaded
  - `stateChange`: send on each state transition
  - `results`: send AES6 metrics after processing completes
  - `error`: send on any error

**c) Layout adjustments:**
  - Drop gutters (padding/margins) in embed mode
  - Scroll containment: prevent scroll bubbling to host

### 5.7 Mobile Responsiveness

- Test all components at 375px width (iPhone SE)
- Panels stack vertically, full width
- Waveform: touch gestures (pinch-zoom, swipe pan) — already in Phase 3
- Spectrum: chip list for peak selection instead of click-on-peaks
- Stats panel: may need to reflow from grid to stacked
- Consider hiding optional plots by default on mobile
- Advanced panel: full-width accordion

### 5.8 Processing Feedback

- If processing takes > ~1s, show a progress indicator
- Python module can push status messages via callback:
  ```python
  def set_status(msg):
      from js import window
      if hasattr(window, 'updateProcessingStatus'):
          window.updateProcessingStatus(msg)
  ```
- Status messages: "Detecting carrier...", "Filtering signal...", "Finding zero crossings...", "Computing metrics..."
- Display as text below or on top of the processing spinner

---

## Dependency Order

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                              │
                              └──→ Phase 5 (items are independent,
                                           can be done in any order)
```

Phase 1 is the critical path. Everything builds on it. Phase 2 builds the real UI shell. Phases 3 and 4 are the core interactive features. Phase 5 items are independent and can be parallelized or reordered based on priority.

---

## Testing Strategy

- **Python module:** Validate against CLI script output using known test files. Metrics must match exactly.
- **Pre-processing:** Test downsample with known carrier files. Verify carrier detection accuracy. Verify trimming doesn't cut signal.
- **Waveform:** Visual testing. Verify zoom/pan math with known data ranges.
- **Integration:** End-to-end test with reference WAV files comparing SPA output to CLI output.

---

## Known Risks

1. **PyScript/Pyodide load time** — Pyodide is ~20MB. First load will be slow. Subsequent loads use browser cache. May want a loading screen with progress.
2. **scipy in Pyodide** — scipy is available but heavy. First import may take several seconds.
3. **Zero-crossing loop performance in Pyodide** — The `find_zero_crossings` function uses a Python loop with `brentq` per crossing. This will be slower in Pyodide than native Python. For a 120s file at 3 kHz carrier (~360K crossings), this could be slow. May need to optimize or explore vectorization.
4. **Memory** — Large files at high sample rates can consume significant memory in-browser. The adaptive downsampling helps significantly.
5. **OfflineAudioContext availability** — Should be available in all modern browsers. Need to test Safari specifically.
