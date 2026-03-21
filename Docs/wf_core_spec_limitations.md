# wf_core — Pipeline Specifications & Limitations

## Quick Reference

### Maximum Reliable Modulation Depth by Carrier Frequency

| Carrier (Hz) | Max Depth | Limiting Factor |
|:---:|:---:|:---|
| 50 | 10% | Outlier rejection threshold |
| 100 | 10% | Outlier rejection threshold |
| 200 | 10% | Outlier rejection threshold |
| 500 | 10% | Outlier rejection threshold |
| 1000 | 10% | Outlier rejection threshold |
| 1500 | 10% | Both limits converge |
| 2000 | 7.5% | Prefilter bandwidth cap |
| 3000 | 5% | Prefilter bandwidth cap |
| 5000 | 3% | Prefilter bandwidth cap |

For carriers above 1500 Hz, max depth = 150 / f_carrier.

> **Practical note:** Real-world W&F on any transport in usable condition is well under 1%. These limits are only relevant for extreme calibration signals or severely damaged mechanisms.

### Weighting Filter Accuracy (Topology B, AES6-2008)

| Mod Freq (Hz) | AES6 Spec (dB) | Filter Actual (dB) | Gain Error | Weighted Bias |
|:---:|:---:|:---:|:---:|:---:|
| 0.2 | −30.6 | −30.2 | +4.5% | +4.5% on weighted metrics |
| 0.8 | −6.0 | −5.4 | +7.1% | +7.1% on weighted metrics |
| 4.0 | 0.0 | 0.0 | 0.0% | Reference — no bias |
| 20.0 | −5.9 | — | — | Varies by carrier (see below) |

All points within AES6-2008 Table 1 tolerances. Overall PTP error: 1.013 dB at fs = 1000 Hz. Max absolute error: 0.681 dB. 17/17 spec points pass.

### Unweighted Bandpass Edge Attenuation

| Mod Freq (Hz) | Position | Attenuation | Effect |
|:---:|:---|:---:|:---|
| 0.2 | At bp_lo cutoff | −6 dB (≈ −55%) | sosfiltfilt doubles 4th-order Butterworth |
| 0.5 | Just above bp_lo | Moderate rolloff | Transition band |
| 1–200 | Passband interior | < 1 dB | Flat |
| Near bp_hi | Approaching upper cutoff | Rolloff | Carrier-dependent (bp_hi = min(0.4×carrier, 200)) |

### Signal 07 (20 Hz Modulation) — Carrier-Dependent Behavior

| Carrier (Hz) | bp_hi (Hz) | 20 Hz vs bp_hi | Weighted Error | Cause |
|:---:|:---:|:---|:---:|:---|
| 50 | 20 | At cutoff | −83% | 20 Hz completely attenuated by bandpass |
| 100 | 40 | 50% of bp_hi | −16% | Filter rolloff + SRC interpolation artifact |
| 200 | 80 | 25% of bp_hi | +3% | Passband — normal accuracy |
| 1000 | 200 | 10% of bp_hi | +7% | Passband — weighting filter gain offset |
| 3000 | 200 | 10% of bp_hi | +8% | Passband — weighting filter gain offset |

---

## Detailed Analysis

### 1. Prefilter Bandwidth Cap

**What:** A 2nd-order Butterworth bandpass filter is applied to the raw audio before zero-crossing detection. It is centered on the detected carrier frequency with bandwidth = 45% of carrier, capped at 150 Hz for carriers above 500 Hz.

**Why it matters:** FM modulation sweeps the instantaneous frequency across a range of `f_carrier ± f_carrier × mod_depth`. If the sweep exceeds the prefilter passband, the negative (or positive) excursions of the modulation are attenuated. The zero-crossing detector then misses crossings during those attenuated portions, producing a distorted, shorter deviation signal.

**How it fails:** At 3 kHz carrier with 10% modulation, the FM sweep spans 2700–3300 Hz. The prefilter passband is 3138–3438 Hz (centered on 3288 Hz detected carrier, ±150 Hz). The bottom 437 Hz of the sweep falls outside the passband. Roughly half the zero crossings are lost, the output sample rate drops to 54% of nominal, and the resulting deviation waveform is severely distorted (+35% raw peak error, significant harmonic content at 8 Hz and 12 Hz).

**The limit:** For carriers ≤ 500 Hz, the bandwidth scales at 45% of carrier — no cap applies, and the prefilter accommodates up to 45% modulation depth (well above the 10% outlier rejection ceiling). For carriers above 500 Hz, the 150 Hz cap limits maximum depth to `150 / f_carrier`. The crossover where the cap becomes the binding constraint (tighter than the 10% outlier threshold) is at 1500 Hz.

**Observed in calibration:**

| Carrier | Signal 05 (9.97%) | Output Rate | Rate/Nominal | Prefilter Clips? |
|:---:|:---:|:---:|:---:|:---|
| 50 Hz | −6.2% wtd peak | 42 Hz | 84% | No — outlier rejection only |
| 100 Hz | −1.6% | 96 Hz | 96% | No |
| 200 Hz | −2.1% | 176 Hz | 88% | No |
| 1000 Hz | −1.8% | 880 Hz | 88% | Yes — 42 Hz clipped (mild) |
| 3000 Hz | −12.2% | 1624 Hz | 54% | Yes — 437 Hz clipped (severe) |


### 2. Outlier Rejection Threshold

**What:** After zero-crossing frequency extraction, samples deviating more than a threshold from the median are rejected. The threshold is `min(8 × MAD, 10% × f_median)`. For any modulation depth above ~2%, the 10% cap is the binding constraint.

**Why it matters:** At exactly 10% modulation depth, the peaks of the FM sine just touch the rejection boundary. Due to discrete sampling and slight asymmetries in the zero-crossing estimates, some peak samples are rejected. This clips the deviation waveform peaks and reduces the measured amplitude.

**How it fails:** The effect is proportional to how close the modulation depth is to 10%. At 9.97% depth (signal 05), the outlier rejection clips 4–16% of crossings depending on carrier. At 1% depth (signal 04), zero crossings are rejected.

**Observed in calibration — outlier rejection counts for signal 05:**

| Carrier | Crossings Rejected | % Rejected |
|:---:|:---:|:---:|
| 50 Hz | 240 | 16.0% |
| 100 Hz | 120 | 4.0% |
| 200 Hz | 720 | 12.0% |
| 1000 Hz | 3600 | 12.0% |
| 3000 Hz | 120 | 0.2% |

Note: 3 kHz shows minimal outlier rejection because the prefilter has already removed the extreme crossings before the outlier stage sees them.


### 3. Weighting Filter Gain Accuracy

**What:** The AES6-2008 weighting filter (Topology B optimized) has gain errors at specific frequencies that are inherent to the filter design. The filter was optimized for minimum overall PTP error across all 17 AES6 Table 1 spec points, which means individual frequencies trade accuracy for better global fit.

**Why it matters:** The gain error at a given modulation frequency produces a proportional bias in all weighted metrics. This is systematic and consistent — it does not vary by carrier or signal level.

**Error decomposition for signal 06 (0.8 Hz, expected 0.0499% wtd peak):**

| Carrier | Raw Dev Error | Filter Gain Error | Predicted Total | Actual Total | Residual |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 50 Hz | −0.2% | +7.3% | +7.1% | +7.0% | −0.04% |
| 100 Hz | −0.1% | +7.1% | +7.0% | +7.0% | +0.00% |
| 200 Hz | −0.1% | +7.1% | +7.0% | +7.0% | −0.01% |
| 1000 Hz | −0.1% | +7.1% | +6.9% | +7.0% | +0.00% |
| 3000 Hz | −0.2% | +7.1% | +6.9% | +6.6% | −0.28% |

The error is almost entirely explained by the filter gain at 0.8 Hz. Residuals under 0.3%.

**Error decomposition for signal 08 (0.2 Hz, expected 0.003% wtd peak):**

| Carrier | Raw Dev Error | Filter Gain Error | Predicted Total | Actual Total | Residual |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 50 Hz | −1.7% | +4.6% | +2.9% | +3.0% | +0.2% |
| 100 Hz | −1.7% | +4.5% | +2.8% | +2.8% | +0.0% |
| 200 Hz | −1.7% | +4.5% | +2.8% | +2.7% | −0.1% |
| 1000 Hz | −1.7% | +4.5% | +2.8% | +2.7% | −0.1% |
| 3000 Hz | −1.7% | +4.5% | +2.7% | +10.3% | +7.6% |

The 3 kHz residual of +7.6% on signal 08 is from isolated high-amplitude samples in the raw deviation at 3 kHz (raw peak 0.111% vs 0.100% at other carriers), amplified through the weighting filter. This is a deviation extraction artifact at 3 kHz, not a filter or SRC issue.


### 4. Unweighted Bandpass at Low Modulation Frequencies

**What:** The unweighted signal path uses a 4th-order Butterworth bandpass from 0.2 Hz to min(0.4 × carrier, 200) Hz, applied via `sosfiltfilt` (zero-phase, forward-backward filtering). The effective filter order at the cutoffs is doubled to 8th-order equivalent.

**Why it matters:** Any modulation at or near the 0.2 Hz lower cutoff is attenuated by approximately 6 dB (50%) because `sosfiltfilt` squares the frequency response. This is not a bug — it is the expected behavior of a zero-phase filter at its cutoff frequency.

**Observed:** Signal 08 (0.2 Hz modulation) shows −55% unweighted RMS at ALL carriers, regardless of SRC. The error is identical from 50 Hz to 3 kHz, confirming the bandpass filter as the sole cause.

**Upper cutoff effects:** At low carriers, the upper cutoff bp_hi = 0.4 × carrier can fall close to the modulation frequency. Signal 07 (20 Hz) at 50 Hz carrier has bp_hi = 20 Hz — the modulation is exactly at the cutoff, producing −83% attenuation.


### 5. SRC (Sample Rate Conversion)

**What:** All signals are resampled to 1 kHz before metric computation using `scipy.signal.resample_poly` with odd-extension boundary padding (filtfilt-style).

**Verified transparent:** Comprehensive A/B testing (native rate vs. post-SRC metrics) shows SRC-induced weighted metric errors under 0.1% for all signals except signal 07 at low carriers (see below). SRC is not a significant error source.

| Carrier | SRC Direction | Ratio | Avg |dWtdPeak| | Max |dWtdPeak| |
|:---:|:---:|:---:|:---:|:---:|
| 50 Hz | UP | 20:1 | 14.75%* | 117%* |
| 100 Hz | UP | 10:1 | 1.56%* | 11.6%* |
| 200 Hz | UP | 5:1 | 0.37% | 2.6%* |
| 1000 Hz | — | 1:1 | 0.00% | 0.03% |
| 3000 Hz | DOWN | 1:3 | 0.02% | 0.05% |

*Signal 07 (20 Hz) only. All other signals show < 0.5% SRC error at all carriers.

**Signal 07 SRC artifact:** At 50 Hz carrier, the 20 Hz modulation is at 40% of native Nyquist (25 Hz). Upsampling 20:1 introduces interpolation artifacts at frequencies close to the native Nyquist. This is an inherent limitation of polyphase interpolation — it cannot create information above the original Nyquist. The artifact scales inversely with the ratio of Nyquist to modulation frequency.
