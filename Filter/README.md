# AES6 Weighting Filter Design Cookbook

## Lessons learned from redesigning the AES6-2008 weighting filter using Wurcer's optimization methodology

---

## 1. The Problem

AES6-2008 Table 1 defines 17 frequency/weighting spec points (0.1–200 Hz) for the wow & flutter weighting filter. The filter must be normalized to 0 dB at 4 Hz. Tolerances range from ±2 dB in the passband to +10/−4 dB at the low-frequency extremes.

The AES6 abstract describes the weighting as "approximately 6 dB/oct drop above and below 4 Hz, with an additional drop below 0.5 Hz." The actual Table 1 slopes confirm this:

| Region | Slope (dB/oct) | Character |
|--------|---------------|-----------|
| 100–200 Hz | ~5.7 | Approaching 6 dB/oct (1st-order LP) |
| 20–63 Hz | ~4.5–5.8 | Transitioning toward 6 dB/oct |
| 4–10 Hz | ~1.4–1.8 | Near peak, very shallow |
| 0.6–1 Hz | ~5.6–7.0 | ~6 dB/oct (1st-order HP) |
| 0.3–0.5 Hz | ~10–14 | Steepening — "additional drop" |
| 0.1–0.2 Hz | ~17 | Approaching 18 dB/oct (3rd-order HP) |

The challenge: the slopes are **asymmetric** — approximately 6 dB/oct above (1st-order LP, the entire upper side), and 6 dB/oct from ~0.5–4 Hz steepening to ~18 dB/oct below 0.5 Hz (the "additional drop" from 3 zeros at DC). No standard equal-order bandpass filter (Bessel, Butterworth, or otherwise) can match this shape because equal-order bandpasses have symmetric rolloff rates.

## 2. What We Tried (and Why It Failed)

### Standard Bessel bandpass (filters.c reference)

The `filters.c` reference implementation uses a 2nd-order Bessel bandpass (BpBe2) at 1.2–15 Hz. We reconstructed this filter from its biquad coefficients and tested it against AES6 Table 1.

**Result: 23.4 dB PTP error.** This implementation rolls off far too steeply above 10 Hz. Note: the DIN 45507, IEC 386, and AES6-2008 weighting curves are all the same specification — `filters.c` is simply a poor implementation of that shared spec, not evidence of a different standard. The topology (cascaded biquads) is a clue, but the specific pole/zero placement in that implementation is wrong.

### Optimized Bessel HP+LP cascades

We tested every combination of Bessel HP(n) + Bessel LP(m) with n=1–3, m=1–2, optimizing corner frequencies against Table 1. Also tested Butterworth and mixed Bessel/Butterworth combinations.

**Best result: Bessel HP3 + LP1 at 2.52 dB PTP.** Failed 5 of 17 spec points. The fundamental problem: a symmetric-slope bandpass topology cannot match an asymmetric-slope spec.

### Key lesson: don't force a standard filter topology

The `filters.c` implementation is informative as a clue to the general approach (cascaded HP + LP sections implemented as biquads), but the weighting curve requires a different topology than any standard textbook filter.

## 3. What Worked: Wurcer's Methodology

Scott Wurcer's article in Linear Audio Vol. 10 ("Record replay RIAA correction in the digital domain") provides the key insight that solved this problem.

### The core insight (Wurcer, p.51–52):

> "We need to abandon the single frequency of interest approach and optimize the pole and zero locations over the entire frequency range of interest. **The zeros at infinity do us no good and are free parameters. By bringing them into the unit circle we can tailor the response at the high end for a better match and it adds more handles on the optimization.**"

In a standard bandpass, the lowpass section's zeros sit at infinity (Nyquist in the z-domain). These zeros don't contribute anything useful — they're artifacts of the standard filter form. Wurcer says: treat them as free optimization parameters. Move them to finite frequencies where they can actually shape the response.

### Applied to AES6:

The physical structure of the AES6 curve tells us:

- **Below passband:** ~6 dB/oct from 0.5–4 Hz steepening to ~18 dB/oct below 0.5 Hz → 3 zeros at DC (3rd-order HP asymptote)
- **Above passband (~6 dB/oct fall):** Net order = zeros − poles = −1, meaning we need at least 4 poles for 3 DC zeros
- **The missing piece:** Instead of a 4th zero at infinity (standard 4th-order bandpass), bring it to a finite frequency and let the optimizer place it

This gives the topology: **3 DC zeros + 1 finite-frequency zero + 4 real poles** — 5 free parameters total (4 pole frequencies + 1 zero frequency).

## 4. The Optimizer

### Error metric: peak-to-peak (PTP)

Wurcer uses PTP error rather than RMS or minimax. PTP captures the overall shape deviation and naturally ignores a constant gain offset (which can always be corrected by normalization). This is important because the filter is normalized at 4 Hz — we care about *shape* accuracy, not absolute gain.

### Two-phase optimization: brute grid + Nelder-Mead

The optimization landscape has numerous local minima (Wurcer notes this explicitly). The approach:

1. **Brute-force grid search** over physically reasonable parameter ranges
2. **Nelder-Mead refinement** from the grid minimum

The grid search is critical — it prevents getting stuck in a poor local minimum. The ranges should be informed by physical reasoning about where poles and zeros should be.

### Evaluation in the z-domain

Rather than building scipy filter objects, evaluate the response directly in the z-domain using Wurcer's functions:

- `z_from_f(f_hz, fs)` — bilinear maps s-domain frequency to z-plane location: `z = (fs/π − f) / (fs/π + f)`
- `Fz_at_f(poles, zeros, f_eval, fs)` — evaluates the z-domain transfer function on the unit circle

This is fast, avoids intermediate filter construction, and works directly with the optimization parameters.

### The z_from_f convention (careful!)

Wurcer's bilinear mapping is:

```
z = (fs/π − f) / (fs/π + f)
```

NOT `(fs/π + f) / (fs/π − f)` (which is the reciprocal and puts poles OUTSIDE the unit circle). The correct formula maps:
- f = 0 → z = 1 (DC)
- f = ∞ → z = −1 (Nyquist)
- Low frequencies → z near +1, inside the unit circle (stable poles)

Getting this backwards produces correct-looking magnitude responses during optimization (the optimizer compensates), but the resulting pole/zero frequencies won't translate correctly when building the actual filter with `scipy.signal.bilinear()`.

## 5. The Winning Filter

### Analog prototype

```
H(s) = G · s³ · (s + 2π·227.9) / [(s + 2π·0.6265)³ · (s + 2π·11.32)]
```

Physical interpretation:
- **3 zeros at DC (s³):** 18 dB/oct highpass below ~0.6 Hz
- **Triple pole at 0.6265 Hz:** Shapes the HP→BP transition (confirmed by differential evolution — all three converge to the same value)
- **LPF pole at 11.32 Hz:** Creates the ~6 dB/oct rolloff above the passband
- **Finite zero at 227.9 Hz:** Shapes the high-frequency rolloff — this is the "brought in from infinity" zero per Wurcer

### Performance

| Metric | Value |
|--------|-------|
| PTP error | 1.013 dB |
| Max error at any spec point | ±0.681 dB |
| Passes all 17 Table 1 points | YES |
| Filter order | 4th (2 biquad sections) |
| Operating sample rate | 1000 Hz (post-SRC) |

### Compliance: Filter Response vs AES6-2008 Table 1

Topology B (refined): 3 DC zeros + 1 finite zero (227.9 Hz) + triple pole at 0.6265 Hz + LPF pole at 11.32 Hz, fs=1000 Hz, normalized 0 dB at 4 Hz.

| Freq (Hz) | AES6 Spec (dB) | Filter (dB) | Error (dB) | Tolerance | In Spec? |
|----------:|---------------:|------------:|-----------:|:---------:|:--------:|
|     0.100 |         −48.0  |     −47.319 |    +0.681  |  +10/−4  |    YES   |
|     0.200 |         −30.6  |     −30.194 |    +0.406  |  +10/−4  |    YES   |
|     0.315 |         −19.7  |     −20.031 |    −0.331  |   +4/−4  |    YES   |
|     0.400 |         −15.0  |     −15.327 |    −0.327  |   +4/−4  |    YES   |
|     0.630 |          −8.4  |      −8.147 |    +0.253  |   +2/−2  |    YES   |
|     0.800 |          −6.0  |      −5.428 |    +0.572  |   +2/−2  |    YES   |
|     1.000 |          −4.2  |      −3.522 |    +0.678  |   +2/−2  |    YES   |
|     1.600 |          −1.8  |      −1.119 |    +0.681  |   +2/−2  |    YES   |
|     2.000 |          −0.9  |      −0.527 |    +0.373  |   +2/−2  |    YES   |
|     4.000 |           0.0  |       0.000 |    +0.000  |  0 (ref) |    YES   |
|     6.300 |          −0.9  |      −0.472 |    +0.428  |   +2/−2  |    YES   |
|    10.000 |          −2.1  |      −1.724 |    +0.376  |   +2/−2  |    YES   |
|    20.000 |          −5.9  |      −5.315 |    +0.585  |   +2/−2  |    YES   |
|    40.000 |         −10.4  |     −10.388 |    +0.012  |   +2/−2  |    YES   |
|    63.000 |         −14.2  |     −14.009 |    +0.191  |   +4/−4  |    YES   |
|   100.000 |         −17.3  |     −17.631 |    −0.331  |   +4/−4  |    YES   |
|   200.000 |         −23.0  |     −22.319 |    +0.681  |   +4/−4  |    YES   |

**17/17 points within tolerance. PTP error: 1.013 dB. Max absolute error: 0.681 dB.**

Worst-case margins (closest to tolerance edge): 1.6 Hz (+0.681 of ±2.0 dB = 1.319 dB margin), 1.0 Hz (+0.678 of ±2.0 dB = 1.322 dB margin), 0.8 Hz (+0.572 of ±2.0 dB = 1.428 dB margin). Every point has at least 1.3 dB of headroom to the tolerance boundary.

### Digital implementation (b/a form, fs=1000 Hz)

```python
b = [ 0.08995215, -0.28474193,  0.31451291, -0.13460861,  0.01488549]
a = [ 1.0,        -3.91955067,  5.75950761, -3.76035997,  0.92040303]
```

### SOS form (2 biquad sections, nearest pairing)

```python
sos = np.array([
    [ 0.08995215, -0.10483789,  0.01488553,
      1.0,        -1.92737966,  0.92765139],
    [ 1.0,        -1.99999720,  0.99999720,
      1.0,        -1.99217101,  0.99218634],
])
```

### Usage with lfilter + lfilter_zi (causal, zero transient)

```python
from scipy.signal import lfilter, lfilter_zi

zi = lfilter_zi(b, a)
weighted_signal, _ = lfilter(b, a, deviation_signal, zi=zi * deviation_signal[0])
```

## 6. Why lfilter (Not filtfilt)

The objective is matching analog test instrumentation behavior. Analog W&F meters are causal systems — they process the signal in real time with a physical filter. `lfilter` replicates this: causal, minimum-phase, with the same magnitude AND phase response as the analog prototype.

`filtfilt` (zero-phase, forward-backward filtering) gives squared magnitude response and zero phase. This doesn't match what an analog meter does and would give wrong results.

`lfilter_zi` eliminates the startup transient without requiring a skip period. It computes the initial filter state that would exist if the input signal had been constant at its first sample value for all time before t=0. This avoids the 3+ second skip that would make short recordings unusable.

## 7. Why fs=1000 Hz

The deviation signal (output of the zero-crossing demodulator) has useful content only up to ~200 Hz. After SRC (sample rate conversion) to 1000 Hz using `scipy.signal.resample_poly`:

- Bilinear warping is negligible: <0.03% at 20 Hz, <0.5% at 200 Hz
- All filter designs work correctly without pre-warping compensation
- Computational cost is minimal
- No evidence of SRC degrading any metric (validated across 40 calibration files)

SRC is applied to the **deviation signal** (post zero-crossing demodulation), not to the raw audio.

## 8. Topologies Tested (Summary)

| Topology | Free params | PTP (dB) | Passes Table 1? |
|----------|-------------|----------|-----------------|
| 2 DC zeros + 3 poles | 3 | 9.21 | NO |
| 3 DC zeros + 4 poles | 4 | 1.11 | YES |
| 2 DC zeros + 1 finite zero + 4 poles | 5 | 9.25 | NO |
| **3 DC zeros + 1 finite zero + 4 poles** | **5** | **1.07** | **YES** |
| 3 DC zeros + 2 finite zeros + 5 poles | 7 | 1.44 | YES (local min) |

Key observations:
- **3 DC zeros are essential.** 2 DC zeros (12 dB/oct asymptote) cannot match the ~18 dB/oct asymptotic slope below 0.5 Hz regardless of optimization.
- **The finite zero helps.** Topology B (with Wurcer's "bring infinity in" zero) beats Topology A (without it) by ~50 mdB.
- **More parameters ≠ better.** Topology C (7 params) got stuck in a local minimum worse than Topology B (5 params). Wurcer warns about this: "The optimization problem has no closed form solution and is further complicated by being ill-conditioned, which means there are numerous local minima."

## 9. The filters.c Reference — What It Taught Us

Reconstructing the `process_DIN` filter from `filters.c` (fs=6300 Hz) revealed its actual structure:

- 4 biquad sections: 2 HPF sections (zeros at DC) + 2 LPF sections (zeros at Nyquist)
- Pole analysis: conjugate pairs at 0.08 Hz, 0.58 Hz, 9.35 Hz, and 129 Hz
- This is NOT a simple 2nd-order Bessel bandpass — it's a 4th-order system

**Important:** DIN 45507, IEC 386, and AES6-2008 all define the same weighting curve. The `filters.c` implementation fits AES6 Table 1 poorly (22+ dB error above 40 Hz) not because the standards differ, but because it is a botched implementation of the shared spec. Its general topology (cascaded HP + LP biquad sections with free zero/pole placement) is the right approach — the implementation just has wrong parameters.

## 10. Reproducibility

To reproduce these results:

1. Run `aes6_wurcer_optimizer.py` — produces all 5 topology results
2. Run `din_vs_aes6.py` — reconstructs the `filters.c` filter and runs HP+LP cascade sweep
3. The winning filter coefficients are deterministic given the grid search ranges

The optimizer scripts are self-contained (only need numpy, scipy, matplotlib) and include compliance checking, phase verification, and comparison plots.

## 11. References

- **AES6-2008**: AES standard method for measurement of weighted peak flutter of sound recording and reproducing equipment
- **Wurcer, Scott**: "Record replay RIAA correction in the digital domain," Linear Audio, Volume 10. Core methodology: brute grid + fmin optimization of z-domain pole/zero locations using PTP error metric.
- **DIN 45507 / IEC 386**: German and international standards for flutter measurement. The weighting curve is identical to AES6-2008 Table 1.
- **filters.c** (wow-and-flutter-analyzer): Reference C implementation claiming DIN compliance, implemented as 4 biquad sections at fs=6300 Hz. This implementation is non-compliant — it fails the shared DIN/IEC/AES6 weighting spec by 22+ dB above 40 Hz.
- **aes6-wow-and-flutter-meter**: Reference Python implementation with HPF3 + LPF1 Butterworth — functional but not optimized (5.4 dB PTP).
