# Wow & Flutter Analysis Engine

Turntable and tape transport wow & flutter measurement from FG (frequency generator) signals, test records, and device sensor exports. Implements AES6-2008 / DIN 45507 / IEC 60386 weighted and unweighted metrics with calibration-verified accuracy.

Two main files: `wf_core.py` (analysis engine) and `wf_analyze.py` (CLI frontend). The engine is designed for multiple consumers — a web SPA frontend also uses `wf_core.py` with identical results.

---

## wf_analyze.py — CLI Usage

### Basic usage

```bash
# Audio FG signal — direct drive, no motor params
python wf_analyze.py recording.wav

# Audio FG signal — belt drive with motor identification
python wf_analyze.py recording.wav \
    --rpm 33.333 --motor-poles 24 --motor-slots 2 --drive-ratio 7.5

# Device sensor export (ShakNSpin .txt)
python wf_analyze.py device_export.txt
```

### Input types

The tool accepts two input types, distinguished by file extension:

**Audio (.wav)** — FG signal recorded from a turntable motor's frequency generator or a test record groove. Any carrier frequency from ~50 Hz to ~5 kHz. The full DSP pipeline runs: carrier detection, prefiltering, zero-crossing demodulation, deviation extraction, metrics, spectrum analysis, and AM/FM coupling.

**Device text (.txt)** — Exported speed data from a measurement device (currently ShakNSpin). The data is already angular velocity, so the pipeline enters at the deviation/metrics stage. No carrier detection, no FM demodulation.

### CLI arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `input` | (required) | Path to .wav or .txt file |
| `--rpm` | 33.333 | Platter RPM. Enables polar plot and rotation harmonic labels |
| `--motor-poles` | None | Motor pole count. Enables electrical and torque ripple labels |
| `--motor-slots` | None | Motor slot count. Enables slot passing labels |
| `--drive-ratio` | 1.0 | Motor-to-platter speed ratio. 1.0 = direct drive. For belt/idler, this is the pulley ratio (e.g. 7.5 for a typical belt drive) |
| `--polar-revs` | 2 | Number of revolutions in polar plot |
| `--lissajous-freq` | None | One or more frequencies (Hz) for AM/FM Lissajous plots. Single value gives a single plot; multiple values give a 2-row panel (same layout as `--lissajous-peaks`). Audio only |
| `--lissajous-peaks` | off | Generate AM/FM Lissajous panel for all detected spectrum peaks (top 12, >8% of max amplitude). Audio only |
| `--plot-am` | off | Overlay AM envelope spectrum on the FM spectrum plot. Audio only |

### Output

Console output reports mean frequency and all standard/non-standard metrics. A 4-panel PNG is saved automatically:

1. Speed deviation zoomed (4 revolutions)
2. Speed deviation full capture
3. FM deviation spectrum with peak markers and motor harmonic identification
4. Histogram (left) + polar plot (right)

Optional outputs: Lissajous plots (per-frequency or per-peak panel).

### Metrics reported

**Standard (AES6/DIN/IEC):** Unweighted peak 2σ, unweighted RMS, weighted peak 2σ, weighted RMS (JIS), weighted wow RMS, weighted flutter RMS. All weighted metrics use the AES6-2008 frequency weighting filter. Band split at 6 Hz for wow/flutter separation.

**Non-standard:** Drift RMS (0.05–0.5 Hz), unweighted wow RMS (0.5–6 Hz), unweighted flutter RMS (>6 Hz), peak-to-peak.

### Motor harmonic identification

When `--rpm` is provided, spectrum peaks are labeled with platter rotation harmonics. Adding `--motor-poles` and/or `--motor-slots` enables electrical, slot passing, and torque ripple labels. For non-direct-drive turntables, `--drive-ratio` shifts motor-related frequencies to their platter-referenced values. The identification priority (most specific first):

1. Torque ripple — 3 × pole_pairs × f_rot × drive_ratio
2. Slot passing — slots × f_rot × drive_ratio
3. Electrical — pole_pairs × f_rot × drive_ratio
4. Motor rotation — f_rot × drive_ratio (only when drive_ratio ≠ 1.0)
5. Platter rotation harmonics — N × f_rot

---

## wf_core.py — Engine Internals

### Architecture

`wf_core.py` is a stateless-API, stateful-session module. It exposes two functions:

- `analyzeFull(data, sampleRate, inputType, rpm, motor_slots, motor_poles, drive_ratio)` — runs the full pipeline, returns a structured result dict, and stashes internal state for on-demand plot data.
- `getPlotData(plotId, params)` — returns arrays for plots that are expensive to precompute (polar, histogram, lissajous, AM spectrum, harmonic extract). Requires a prior `analyzeFull` call.

There is no file I/O, no plotting, no CLI parsing. Consumers handle all presentation.

The module uses `async` internally to support status callbacks (for web frontend progress indicators), but `analyzeFull` auto-detects the execution context: returns a coroutine in an async environment (Pyodide/browser), runs synchronously via `asyncio.run()` in CLI.

### Audio signal flow

```
Raw PCM (any sample rate)
  │
  ├─ 1. Carrier estimation ─── FFT peak detection on first 2s
  │
  ├─ 2. Bandpass prefilter ─── 2nd-order Butterworth, BW = 45% of carrier
  │                             (capped at 150 Hz for carriers >500 Hz)
  │
  ├─ 3. Zero-crossing detection ── positive-going, hysteresis-armed,
  │                                  linear interpolation for sub-sample precision
  │
  ├─ 4. Per-cycle frequency ─── period between consecutive crossings → Hz
  │
  ├─ 5. Cleanup ─── edge trim (prefilter settling + amplitude outliers)
  │                  → MAD outlier rejection
  │                  → median despike (>500 Hz carriers)
  │
  ├─ 6. Interpolation ─── CubicSpline to uniform time grid
  │                        (output rate ≈ crossing rate)
  │
  ├─ 7. Deviation ─── fractional: (f - f_mean) / f_mean
  │
  ├─ 8. Metrics ─── SRC to 1 kHz → unweighted BP + weighted AES6 filter
  │                  (parallel paths from SRC output, see below)
  │
  ├─ 9. Spectrum ─── Hanning-windowed FFT, peak detection, motor harmonic ID
  │
  └─ 10. AM/FM coupling ── Hilbert envelope of prefiltered signal → decimated
                            → normalized to % → bandpass comparison with FM
                            at each detected peak frequency
```

### Device signal flow

Device data (e.g. ShakNSpin gyro at 500 Hz) is already angular velocity — functionally equivalent to post-zero-crossing frequency data from the audio path. The pipeline enters at step 7 (deviation) with a fake carrier_freq of 500 Hz that sets the unweighted bandpass upper limit. No AM/FM coupling is computed for device input.

### Metrics computation

All metric computation happens at 1 kHz after SRC via `resample_poly` with odd-extension padding (filtfilt-style boundary handling). This eliminates bilinear warp variation across carriers and ensures one validated filter design works for everything.

From the 1 kHz deviation signal, two parallel paths:

**Unweighted path:** 4th-order Butterworth bandpass, 0.2 Hz to min(0.4 × carrier, 200 Hz), applied via `sosfiltfilt` (zero-phase). Peak metric is 95th percentile of |deviation| (2σ equivalent). Band-separated wow (0.5–6 Hz) and flutter (>6 Hz) as RMS.

**Weighted path:** AES6-2008 frequency weighting filter applied via `lfilter` (causal) with `lfilter_zi` for zero-transient startup. Same peak and RMS statistics. Band-separated wow/flutter via 6th-order Butterworth LP/HP at 6 Hz on the weighted signal.

**Drift:** 10th-order Butterworth bandpass 0.05–0.5 Hz on the raw deviation (pre-weighting) with cosine taper to prevent edge spectral leakage.

### AES6-2008 weighting filter

The DIN 45507, IEC 60386, and AES6-2008 standards all specify the same weighting curve: approximately 6 dB/oct rolloff above and below the 4 Hz peak, with an additional steepening below ~0.5 Hz (approaching 18 dB/oct asymptotically from 3 zeros at DC).

The filter was designed using Scott Wurcer's optimization methodology (Linear Audio Vol. 10): brute-force grid search + differential evolution of z-domain pole/zero locations, minimizing peak-to-peak error against all 17 Table 1 spec points.

Analog prototype:
```
H(s) = G · s³ · (s + 2π·227.9) / [(s + 2π·0.6265)³ · (s + 2π·11.32)]
```

- 3 zeros at DC (s³) — 18 dB/oct HP asymptote
- Triple pole at 0.6265 Hz — HP-to-BP transition shaping
- LPF pole at 11.32 Hz — ~6 dB/oct upper rolloff
- Finite zero at 227.9 Hz — HF rolloff shaping (Wurcer's "bring infinity in" technique)

Performance: 1.013 dB PTP error, 17/17 Table 1 points within tolerance, minimum margin 1.32 dB. Implemented as 4th-order IIR (2 biquad sections) via bilinear transform at fs=1000 Hz.

Causal filtering (`lfilter`) is deliberate — it matches analog meter behavior. `lfilter_zi` eliminates the startup transient that would otherwise require discarding 3+ seconds of signal.

For the full design derivation, pole/zero optimization methodology, and tolerance analysis, see [`Filter/README.md`](Filter/README.md).

### AM/FM coupling analysis (audio only)

For audio input, the engine extracts an AM (amplitude modulation) envelope via Hilbert transform of the prefiltered signal, decimated to ~500 Hz and normalized to percent deviation from mean amplitude.

At each detected FM spectrum peak, a Butterworth bandpass isolates the AM and FM components at that frequency. Coupling strength is R × √(AM_RMS × FM_RMS), where R is the phase-lock value (magnitude of mean unit phasor of instantaneous phase difference). Peaks exceeding 3× the median coupling strength across all test frequencies are flagged as AM-coupled.

On-demand Lissajous plots show the normalized AM vs FM traces at any requested frequency, with R, phase angle, and significance reported.

### Spectrum and peak detection

Hanning-windowed FFT of the deviation signal, normalized to %RMS/√Hz spectral density. Truncated to the prefilter bandwidth (audio) or 50 Hz (device). Peaks detected via `scipy.signal.find_peaks` with a 2% threshold relative to the maximum, capped at 16 peaks.

Each peak carries: frequency, spectral density amplitude, bin RMS (%), motor harmonic label (if identifiable), coupling strength, and AM-coupled flag.

### Calibration status

Validated against 40 synthetic calibration files (8 signal types × 5 carrier frequencies: 50, 100, 200, 1000, 3000 Hz). Typical weighted metric accuracy within ±3% for carriers 200 Hz and above.

Key accuracy characteristics:

- Weighting filter introduces a systematic +7% bias at 0.8 Hz, +4.5% at 0.2 Hz (within AES6 Table 1 tolerances but consistently above nominal)
- At 50 Hz carrier, 20 Hz modulation falls at the unweighted bandpass cutoff (bp_hi = 20 Hz), producing ~83% attenuation
- SRC to 1 kHz is verified transparent (<0.1% metric change) except at 50 Hz carrier where 20 Hz modulation is near the native Nyquist
- Prefilter bandwidth caps at 150 Hz for carriers >500 Hz, limiting maximum measurable modulation depth to 150/f_carrier at high carriers
- Outlier rejection threshold of 10% sets the absolute ceiling for modulation depth at any carrier

For a detailed breakdown of known limitations, weighting filter accuracy, and prefilter bandwidth constraints, see [`Docs/wf_core_spec_limitations.md`](Docs/wf_core_spec_limitations.md).

## Dependencies

Python 3.8+, numpy, scipy, matplotlib (plotting only — wf_core itself needs only numpy and scipy).
