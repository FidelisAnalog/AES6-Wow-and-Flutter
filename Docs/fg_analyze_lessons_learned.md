# FG Signal Analyzer — Lessons Learned

Development notes for `fg_analyze.py`, a turntable motor FG signal wow & flutter analyzer targeting AES6-2008 compliance. Reference measurements from Multi-Instrument (Virtins Technology). Validated against DIN 45507 calibration tones.

---

## Final Results vs Multi-Instrument (Emerick FG file, 105.5 Hz carrier, 96 kHz, 19.9 s)

| Metric | fg_analyze | Multi-Instrument | Difference |
|---|---|---|---|
| Peak W&F (weighted) | 0.0336% | 0.0342% | -1.7% |
| RMS W&F (weighted) | 0.0173% | 0.0191% | -9.2% |
| Drift RMS (unweighted) | 0.0028% | 0.0036% | -21.7% |
| Wow RMS (weighted) | 0.0092% | 0.0126% | -26.8% |
| Flutter RMS (weighted) | 0.0124% | 0.0143% | -13.2% |

Our numbers are consistently below MI's. This is expected and defensible — MI's Hilbert demodulation has its own edge transients that inflate all metrics (visible in MI's time-domain plot). We source-trim corrupted crossings; MI does not trim its edge artifacts. See section 11 for details.

DIN 45507 calibration accuracy: 0.1% → 0.1000%, 0.3% → 0.3000%, 1.0% → 1.0000% (all < 0.01% error).


## 1. Sinc Interpolation, Not Linear

**Problem:** Linear interpolation between non-uniform zero-crossing frequency estimates creates a position-dependent smoothing artifact. The uniform output grid drifts in and out of phase with the non-uniform input grid over the file duration, producing a U-shaped noise envelope — low noise in the middle, high at the edges.

**Fix:** Windowed-sinc interpolation (Blackman window, 32 taps). The per-cycle frequency samples have negligible timing jitter (< 0.1% of sample spacing), so they can be treated as effectively uniform. Sinc reconstruction is the sampling theorem applied directly and eliminates the position-dependent smoothing entirely.

**Why it matters:** The C reference implementation gets away with linear interpolation because it expects a 3150 Hz or 31500 Hz carrier (hundreds of samples per cycle at typical sample rates). At 105 Hz / 96 kHz we only get ~909 samples per cycle, but the *frequency update rate* is only ~105 Hz — the interpolation artifact is about the resampling of the ~105 Hz frequency series to a uniform grid, not the raw audio.


## 2. Weight First, Then Band-Separate

**Problem:** Our initial implementation band-separated the *unweighted* deviation signal into wow and flutter bands, then measured each. Multi-Instrument's output labels say "Weighted" for both wow and flutter.

**Fix:** Apply the AES6 weighting filter (3rd-order HPF at 0.6 Hz + 1st-order LPF at 10 Hz, normalized to 0 dB at 4 Hz) to the deviation signal *first*, then band-separate the weighted signal into wow (< 6 Hz) and flutter (> 6 Hz).

**Impact:** Flutter dropped from 4.24× MI's value to 1.32×. The weighting filter's 10 Hz LPF was already attenuating flutter-band content, so measuring flutter from the unweighted signal included energy the standard says should be rolled off.


## 3. Complementary Band Separation (LP + Subtract)

**Problem:** Independent lowpass (wow) and highpass (flutter) filters at the 6 Hz crossover lose energy. `filtfilt` squares the magnitude response, so the -3 dB point becomes -6 dB. With independent filters, wow + flutter RSS was 285% of the total weighted signal — energy wasn't conserved.

**Fix:** Lowpass at 6 Hz → wow. Then flutter = weighted signal − wow. This is complementary separation: wow + flutter = weighted signal exactly, by construction. Energy is perfectly conserved regardless of filter order or topology.

**Why it matters:** Any error in the crossover shows up directly in the wow/flutter split. Complementary subtraction eliminates the crossover as a source of error entirely.


## 4. Bandpass Prefilter Before Zero-Crossing Detection

**Problem:** Raw FG signals contain harmonics and out-of-band noise that jitter zero-crossing times. Per-cycle frequency standard deviation was 0.0697%.

**Fix:** Auto-tuned bandpass prefilter centered on the detected carrier frequency (±30% bandwidth), order 2 Butterworth + filtfilt. For a 105 Hz carrier this gives a 73.5–136.5 Hz passband. The carrier frequency is auto-detected from a quick raw zero-crossing count before the prefilter is applied.

**Impact:** Per-cycle frequency std dropped from 0.0697% to 0.0384%. Weighted peak went from 0.0440% to 0.0337% (MI: 0.0342%). Keep the order low (2) to minimize ringing — the prefilter only needs to remove harmonics, not provide sharp selectivity.

**Note from the C reference:** That implementation also uses a bandpass prefilter (`process_2nd_order`), but its filters are designed for 6300 Hz sample rate (2× a 3150 Hz carrier). Same idea, different carrier regime.


## 5. Adaptive Source Trimming of Prefilter Edge Artifacts

**Problem:** The bandpass prefilter uses `filtfilt`, which pads the signal edges for its backward pass. This creates huge frequency errors at the first/last few zero crossings — up to 0.9% on the Emerick file (105 Hz carrier) and 1.3% on the TT101 (100 Hz carrier). These are below the 10% outlier threshold but 20× larger than the actual W&F signal, and they corrupt every downstream metric.

A fixed trim count (e.g. `PREFILTER_ORDER + 1`) doesn't generalize — the Emerick file needs 3 from the start and 4 from the end, while the TT101 needs 4 from each end. The number of corrupted crossings depends on carrier frequency, sample rate, and the specific edge padding behavior.

**Fix:** Adaptive trim using the interior MAD (median absolute deviation) as a noise floor estimate. Compute MAD from the middle 80% of crossings, then flag any crossing in the leading/trailing 20 that exceeds 5 × MAD. Trim up to and including the last flagged crossing on each side. This runs immediately after `crossings_to_frequency` and before interpolation, so no downstream metric ever sees the bad data.

**Behavior across files:**
- Emerick (105 Hz, low W&F): 3 start + 4 end, thresh 0.109%
- TT101 (100 Hz, very low W&F): 4 start + 4 end, thresh 0.042%
- DIN 0.1% (3150 Hz): 2 start + 3 end, thresh 0.354%
- DIN 0.3% (3150 Hz): 1 start + 1 end, thresh 1.060%
- DIN 1.0% (3150 Hz): 0 start + 1 end, thresh 3.535%

The threshold naturally scales with the signal's W&F level — trims aggressively on clean signals where edge artifacts stand out, and conservatively on high-W&F signals where the noise floor is already wide.


## 6. Drift: Edge Taper + High-Order SOS Filter

Even with source trimming, the drift computation has two additional challenges:

1. **filtfilt edge effects on the drift LPF itself.** The 0.5 Hz lowpass applied to the deviation signal creates its own edge transients via filtfilt padding.

2. **Wow leakage at 0.55 Hz.** Turntable rotation rate (~0.55 Hz) sits right at the 0.5 Hz drift/wow boundary. A 2nd-order Butterworth + filtfilt (effective 4th order) only attenuates 0.55 Hz by 7.8 dB (41% leakage).

**Failed approach:** Higher-order drift filter without edge handling made drift *worse* (0.0161 → 0.0211 → 0.0251 → 0.0265%) because sharper filters amplify edge transients from the filtfilt padding.

**Fix:** Two-part solution applied only to the drift computation path (wow/flutter unaffected):

1. **Half-cosine taper** on the first/last 1 second of the deviation signal before the drift LPF. Smoothly fades the filtfilt padding artifacts to zero. The tapered region is excluded from the RMS calculation.

2. **Order-10 Butterworth LPF in SOS (second-order sections) form.** SOS avoids the numerical instability of high-order ba-form filters at low normalized frequencies (order 10 in ba form produces infinity; SOS is stable at any order). The high order sharply rejects the 0.55 Hz wow component. This only works *because* the taper eliminated the edge transients that higher-order filters would otherwise amplify.

**Result:** Drift = 0.0028%. DIN calibration drift correctly reads near-zero (0.0011%).


## 7. Hilbert Transform — Tested, Not Needed

**Question:** Can Hilbert-based FM demodulation work at low carrier frequencies?

**Answer:** Yes. At 105 Hz / 96 kHz = 909 samples per cycle, the Hilbert transform works fine (unlike at 3150 Hz / 44100 Hz = 14 samples/cycle where it produces garbage). Tested it — Hilbert gives identical weighted RMS (0.0180%) as zero-crossing at this carrier/sample rate.

**Decision:** Zero-crossing is preferred because it's conceptually simpler, well-understood, and matches both reference implementations. Hilbert buys nothing over zero-crossing for weighted metrics when the sample rate provides adequate samples per cycle.


## 8. AES6 Weighting Filter Construction

The weighting filter is three cascaded 1st-order highpass sections at 0.6 Hz plus one 1st-order lowpass at 10 Hz, normalized to 0 dB at 4 Hz. This matches the reference Python implementation exactly (verified coefficient-by-coefficient at fs = 2000 Hz).

Key detail: use `bilinear` to convert each analog prototype section to digital, then convolve the cascaded sections together. Normalize by measuring gain at 4 Hz and dividing the numerator. The filter is applied with `lfilter` (causal, forward-only) — not `filtfilt` — matching MI's behavior and avoiding the doubled attenuation that filtfilt would cause.


## 9. Why ~2100 Zero Crossings in 20 Seconds Works

At 105 Hz carrier, we get ~2100 positive-going zero crossings in 19.9 seconds — one frequency estimate per cycle, updating at ~105 Hz. MI shows 40,000 samples because it uses Hilbert demodulation and decimates to a higher intermediate rate.

This still works because the W&F signal bandwidth is only 0.5–10 Hz (per AES6). By Nyquist, we need > 20 Hz update rate to capture it. At 105 Hz update rate we have 5× oversampling of the fastest W&F component. The limiting factor is the *modulation* bandwidth, not the carrier frequency.


## 10. Outlier Rejection

Current threshold: 10% deviation from median frequency. This catches genuinely broken crossings (signal dropouts, noise-induced false triggers). The prefilter edge artifacts (up to 0.9%) are handled upstream by source trimming (section 5), so the outlier threshold doesn't need to be tight enough to catch them. Keeping it at 10% avoids rejecting legitimate data points in high-W&F signals (the DIN 1.0% calibration file has individual crossings approaching 1% deviation).


## 11. filtfilt Doubles Everything

`filtfilt` applies the filter forward then backward, squaring the magnitude response. A 2nd-order Butterworth + filtfilt is effectively 4th-order with zero phase. This means:
- The -3 dB point becomes -6 dB
- Filter order N with filtfilt gives effective order 2N
- Crossover frequencies behave differently than you'd expect from the design order

This bit us at the wow/flutter crossover (fix #3) and at the drift filter (fix #6). Always think in terms of effective order when using filtfilt.


## 12. Why Our Numbers Are Below Multi-Instrument's — and Why That's Correct

After source trimming, every metric reads lower than MI's. Before trimming, the corrupted edge crossings added broadband noise energy that coincidentally inflated our numbers toward MI's values. Removing the bad data made the signal cleaner but widened the gap.

This is not a deficiency. MI uses Hilbert demodulation, which has its own edge transients from the analytic signal computation. MI's time-domain plot shows visible edge artifacts — they don't trim them. Their higher wow/flutter/drift numbers include this artificial edge energy.

Evidence: sweeping our trim count from 3 to 20 crossings per end produces identical results. The metrics plateau immediately after the corrupted crossings are removed, confirming we're measuring the true signal. MI's numbers are the ones contaminated by edge noise.

The DIN calibration tones (which have no edge artifact issues at 3150 Hz / 44100 Hz) validate our signal chain to < 0.01% error, independent of the MI comparison.
