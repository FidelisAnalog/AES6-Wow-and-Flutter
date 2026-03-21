# SPA Integration Plan — `wf_core.py`

## Overview

W&F analysis engine module (`wf_core.py`). Supports two input types (audio W&F signals and device text exports), a manifest-driven return structure, and on-demand plot data. Includes unweighted wow/flutter metrics and AM/FM coupling markers. Audio pipeline handles carriers from ~50 Hz to ~5 kHz (FG signals, test records, tape heads). A separate CLI wrapper (`wf_analyzer.py`) will consume this module — one codebase, multiple frontends.

---

## 1. API Surface

### `analyzeFull(data, sampleRate=None, inputType='audio', rpm=None, motor_slots=None, motor_poles=None, drive_ratio=1.0)`

Single entry point for all analysis.

**`inputType='audio'`**: `data` is PCM float64 array. `sampleRate` is required (Hz). Pipeline: carrier estimation → prefilter → zero-crossing → deviation → metrics → spectrum.

**`inputType='device'`**: `data` is a text string (device export). `sampleRate` is ignored — the parser extracts it from the data (e.g. 500 Hz for ShakNSpin). Dispatcher detects format from content, parses to a common intermediate `{ time_s, deviation_pct, fs, metadata }`, and enters the pipeline at the deviation stage. No carrier estimation, no prefilter, no zero-crossing recovery.

**Optional parameters (both input types):**
- `rpm` — platter/transport speed. Enables polar plot and rotation harmonic labeling. Without it, `available` omits `polar` and peaks get no rotation labels. For device input, `rpm` is extracted from the data automatically but can be overridden.
- `motor_slots`, `motor_poles` — enables electrical, slot passing, and torque ripple harmonic labels. Requires `rpm`.
- `drive_ratio` — motor-to-platter speed ratio for non-direct-drive (belt, idler). Default 1.0 (direct drive). Motor electrical frequency at the platter = `(motor_poles / 2) × (rpm / 60) × drive_ratio`.

Device format detection is pluggable. Currently only ShakNSpin (semicolon-delimited, identifiable header with `Session`, `Avg Speed`, etc.). Adding a new device format means adding a parser function and a detection rule — nothing else changes.

### Return structure

```python
{
    "metrics": {
        "f_mean": float,                # mean measured frequency (Hz). For audio: mean of ZC frequency series (= carrier). For device: RPM / 60 from parsed data.
        "carrier_freq": float or None,  # diagnostic: initial FFT carrier estimate used to set prefilter (audio only). Not a measurement — use f_mean for that.
        "rpm": float or None,           # platter/transport RPM if provided (or from device data). None if unknown.
        "f_rot": float or None,         # rotation frequency (rpm / 60) if rpm is known. None otherwise.
        "duration": float,              # seconds
        "input_type": str,              # 'audio' or 'device'
        "device_format": str or None,   # 'shaknspin', etc.
        "device_label": str or None,    # display string from device data (e.g. ShakNSpin serial number). Frontend renders as-is, no parsing needed.

        # confidence: int — 0 = full, 1 = medium, 2 = low (0 is the happy path)

        "standard": {                       # AES6-2008 / DIN 45507 / IEC 60386
            "weighted_peak":          { "value": float, "confidence": int },  # ITU-R weighted peak 2σ (%)
            "weighted_rms":           { "value": float, "confidence": int },  # ITU-R weighted RMS (%)
            "weighted_wow_rms":       { "value": float, "confidence": int },  # ITU-R weighted, LP 6 Hz (%)
            "weighted_flutter_rms":   { "value": float, "confidence": int },  # ITU-R weighted, HP 6 Hz (%)
            "unweighted_peak":        { "value": float, "confidence": int },  # 0.5–200 Hz unweighted peak 2σ (%)
            "unweighted_rms":         { "value": float, "confidence": int },  # 0.5–200 Hz unweighted RMS (%)
        },

        "non_standard": {                   # common practice, no standard
            "unweighted_wow_rms":     { "value": float, "confidence": int },  # 0.5–200 Hz, LP 6 Hz, no weighting (%)
            "unweighted_flutter_rms": { "value": float, "confidence": int },  # 0.5–200 Hz, HP 6 Hz, no weighting (%)
            "drift_rms":              { "value": float, "confidence": int },  # 0.05–0.5 Hz unweighted (%)
        },
    },

    "plots": {
        "dev_time": {
            "t": [...],                 # time array (s)
            "deviation_pct": [...],     # deviation (%)
        },
        "spectrum": {
            "freqs": [...],             # frequency array (Hz)
            "amplitude": [...],         # spectral density
            "peaks": [                  # detected peaks
                {
                    "freq": float,              # peak frequency (Hz)
                    "amplitude": float,         # spectral amplitude at peak
                    "rms": float,               # bandpassed RMS (%)
                    "fft_bin_index": int,        # bin index for frontend highlight
                    "label": str or None,       # motor harmonic ID, e.g. "1×rot", "cogging 4×"
                    "am_coupled": bool,         # True if coupling strength > significance line
                    "coupling_strength": float or None,  # R × sig (audio only, None for device)
                },
                ...
            ],
            "coupling_threshold": float or None,  # 3× median significance line (audio only)
        },
    },

    # coupling data is embedded in spectrum.peaks (am_coupled, coupling_strength)
    # coupling_threshold gives the significance line for display

    "available": {                      # on-demand plots — keys present only if available
        "polar":            { "max_revolutions": int },   # present only if rpm is known
        "histogram":        {},
        "harmonic_extract": {},
        "lissajous":        {},                           # audio only, absent for device
    },
}
```

### `getPlotData(plotId, params={})`

Returns arrays for the requested plot. Errors if `plotId` not in `available` or no analysis has been run.

| plotId | params | returns | notes |
|---|---|---|---|
| `polar` | `{ revolutions: int }` | `{ angle, radius, f_mean, revolutions }` | Default 2 revolutions. Starts at revolution 0 — no skip (preconditioning already trims filter artifacts). Computed from inst_freq. |
| `histogram` | `{}` | `{ bins, counts, bin_edges }` | Deviation histogram |
| `harmonic_extract` | `{ freqs: [float] }` | `{ components: [[float]] }` | Bandpassed deviation at each freq |
| `lissajous` | `{ freq: float }` | `{ am_norm, fm_norm, R, phase, strength, significant }` | Audio only. Bandpass AM+FM at freq, return normalized arrays + coupling metadata |

The frontend reads `available` keys to know which plots exist for this dataset, and reads the metadata (e.g. `max_revolutions`) to configure UI controls. Plots not available for the input type (e.g. `lissajous` for device) are omitted entirely. When a new plot type is added, it appears in `available` with no frontend changes needed beyond a renderer for that plot type.

---

## 2. Device Input Path (Option B — Direct)

For `inputType='device'`, the text data is parsed directly to a deviation signal. No FM synthesis, no zero-crossing round-trip. This avoids the 15% unweighted metric smoothing caused by interpolating a 500 Hz staircase to audio rate.

```
analyzeFull(textData, sampleRate, inputType='device')
  → detect_device_format(textData)
  → parse_device_data(textData, format)
      returns { time_s, deviation_pct, sample_rate, nominal_rpm, metadata }
  → enter pipeline at deviation stage
  → compute_wf_metrics(deviation_frac, sample_rate)
  → compute_spectrum(deviation_pct, sample_rate)
  → return { metrics, plots, available }
```

**What's available for device input:**
- Deviation time trace — directly from parsed data
- Spectrum + peaks — FFT of deviation signal
- Polar — if rpm is known (always the case for ShakNSpin, which includes RPM in header)
- Histogram — deviation distribution
- Harmonic extraction — bandpass the deviation

**What's NOT available:**
- Lissajous / AM-FM coupling — no raw carrier, no AM envelope. Coupling fields are null/false, `lissajous` not in `available`.

**What requires rpm (any input type):**
- Polar plot — needs rotation period to define one revolution
- Rotation harmonic labels — needs `f_rot = rpm / 60`
- Motor harmonic labels — additionally needs `motor_slots`/`motor_poles` and `drive_ratio`

### ShakNSpin parser

Reuse the parsing logic from `shaknspin_analyze.py`. Adapt to accept a string (not file path) since data arrives from the browser. Detection: look for semicolon-delimited header with known ShakNSpin keys (`Session`, `Avg Speed`, `W&F peak`, etc.).

### Adding future device formats

1. Write a `parse_<device>(text_data)` function returning the common intermediate
2. Add a detection rule to `detect_device_format()`
3. No other changes needed — metrics, plots, API contract all stay the same

---

## 3. Unweighted Wow & Flutter

Added alongside the existing weighted computation in the metrics function (renamed from `compute_aes6_metrics` to `compute_wf_metrics`).

**Why a bandpass is needed:** The AES6 weighting filter inherently rolls off below ~0.5 Hz and above ~200 Hz. Without weighting, the raw deviation includes DC drift and high-frequency noise. The explicit 0.5–200 Hz bandpass matches the effective measurement band of the weighted path, making weighted and unweighted directly comparable.

**Computation (at 1 kHz after SRC):**
1. Bandpass deviation at 0.2–min(0.4×carrier, 200) Hz (Butterworth order 4, per AES6 6.1.1 NOTE 0.2 Hz lower bound)
2. Unweighted peak (2σ) and RMS from bandpassed signal → `metrics.standard`
3. Wow: bandpass 0.5–6 Hz → unweighted wow RMS → `metrics.non_standard`
4. Flutter: HP at 6 Hz on bandpassed signal → unweighted flutter RMS → `metrics.non_standard`

---

## 4. AM/FM Coupling Markers

Computed during `analyzeFull` for audio input only.

### During initial analysis:
1. Extract AM envelope via Hilbert transform of the prefiltered signal, normalize to percent deviation from mean, resample to match deviation grid (stashed in module state as `_am_full`)
2. FM deviation already computed by the zero-crossing pipeline (stashed as `_fm_full`, same as `deviation_pct`)
3. Find data-driven test frequencies from peaks in both AM and FM spectra (`_find_coupling_freqs`) — merges and deduplicates peaks within 0.1 Hz
4. For each test frequency, compute `_compute_coupling_at_freq()`:
   - `sosfiltfilt` Butterworth bandpass (order 4, bandwidth = max(0.15, freq × 0.3))
   - Skip 3s edges (filter settling)
   - Compute R (circular mean resultant length of instantaneous phase difference via Hilbert)
   - Signal amplitude = geometric mean of bandpassed AM/FM RMS
   - Combined strength = R × amplitude
5. Significance line = 3× median of all coupling values → stored as `spectrum.coupling_threshold`
6. Match each spectrum peak to nearest test frequency (within tolerance: max(0.15 Hz, 15% of freq)). Assign `coupling_strength` and `am_coupled` (bool: above threshold)
7. Motor harmonic identification (`_identify_motor_harmonics()`) assigns `label` per peak — requires `rpm` for rotation harmonics, additionally `motor_slots`/`motor_poles`/`drive_ratio` for electrical/slot/ripple. Peaks remain `label: None` if the needed parameters weren't provided.

### On-demand Lissajous:
When `getPlotData('lissajous', { freq })` is called:
- Retrieve stashed AM/FM arrays (already in module state from initial pass)
- `sosfiltfilt` Butterworth bandpass at requested freq (same method as coupling markers)
- Skip 3s edges, normalize both to peak amplitude
- Compute phase stats via Hilbert transform
- Check significance against stored `coupling_threshold`
- Return `{ am_norm, fm_norm, R, phase, strength, significant }`
- Frontend draws the scatter plot

### Performance in Pyodide:
- Per-peak: `sosfiltfilt` Butterworth bandpass + Hilbert phase stats
- ~12 peaks on ~6000 samples: fast in Pyodide (all NumPy/SciPy vector ops)

---

## 5. Module State

`analyzeFull` stashes intermediate arrays in a module-level `_state` dict so `getPlotData` can reuse them without recomputation:

- `_deviation_pct` — the deviation time series (%)
- `_t_uniform` — uniform time grid (s)
- `_output_rate` — sample rate of deviation signal (Hz)
- `_f_mean` — mean measured frequency (Hz)
- `_f_rot` — rotation frequency (rpm / 60), None if rpm unknown
- `_rpm` — platter RPM
- `_motor_slots`, `_motor_poles`, `_drive_ratio` — motor params for harmonic ID
- `_am_full` — AM signal resampled to deviation grid (% deviation from mean), audio only
- `_fm_full` — FM signal (same as deviation_pct), audio only
- `_am_envelope` — AM resampled array reference, audio only
- `_fm_deviation` — FM array reference, audio only
- `_coupling_threshold` — 3× median significance line, audio only
- `_input_type` — 'audio' or 'device', so getPlotData knows what's available

Cleared on each new `analyzeFull` call.

---

## 6. Metrics Grouping

Metrics grouped by provenance (implemented):

| Group | Contents | Standard |
|---|---|---|
| `standard` | weighted peak/rms/wow/flutter, unweighted peak/rms | AES6-2008 / DIN 45507 / IEC 60386 |
| `non_standard` | unweighted wow/flutter, drift | None |

No legacy flat keys. Each metric is `{ value, confidence }` — consumer accesses e.g. `metrics.standard.weighted_peak.value`.

Confidence is an int: `0` = full, `1` = medium, `2` = low. Higher = less confident. Extends downward without breaking existing consumer thresholds.

---

## 7. Files

- `/wf_core.py` — Engine module (shared by SPA and CLI). No plotting, no file I/O, no CLI.
- `/wf_analyze.py` — Standalone CLI wrapper. Consumes `wf_core`. Not used by the SPA.
- Old `fg_analyze.py` and variants deleted.

### Public API (`wf_core`):
- `analyzeFull(data, sampleRate=None, inputType='audio', rpm=None, motor_slots=None, motor_poles=None, drive_ratio=1.0)` — single entry point
- `getPlotData(plotId, params={})` — on-demand plot data from stashed state
- `set_status_callback(cb)` — progress updates during analysis

### Internal functions (prefixed `_`):
- `_analyze_audio()` / `_analyze_device()` — input-type-specific pipelines
- `_estimate_carrier_freq()`, `_bandpass_prefilter()`, `_find_zero_crossings()`, `_crossings_to_frequency()` — audio pipeline stages
- `_smooth_frequency()`, `_interpolate_to_uniform()`, `_edge_trim()`, `_outlier_reject()`, `_median_despike()` — signal conditioning
- `_src_to_1khz()`, `_make_aes6_weighting_filter()` — SRC + weighting
- `_compute_wf_metrics()` — all W&F metrics (weighted, unweighted, drift)
- `_compute_spectrum()` — deviation spectrum + peak detection
- `_identify_motor_harmonics()` — peak labeling from rotation/motor params
- `_compute_coupling_at_freq()` — sosfiltfilt Butterworth bandpass coupling at one frequency
- `_find_coupling_freqs()` — data-driven test frequencies from AM/FM spectra
- `_compute_coupling_markers()` — batch coupling for all spectrum peaks
- `_detect_device_format()`, `_parse_device_data()`, `_parse_shaknspin_text()` — device input
- `_plot_polar()`, `_plot_histogram()`, `_plot_harmonic_extract()`, `_plot_lissajous()` — on-demand plot handlers

---

## 8. Resolved Questions

- **Polar revolutions default:** 2. Frontend can request up to `max_revolutions` (reported in `available.polar`).
- **Coupling marker threshold:** 3× median, internal parameter. Not frontend-adjustable.
- **Device spectrum:** Always recompute from the deviation trace in our pipeline. Device-provided spectra (e.g. ShakNSpin's 3-peak summary) are ignored.
