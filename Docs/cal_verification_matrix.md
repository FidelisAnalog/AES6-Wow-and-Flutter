# FG Analyzer Calibration Verification Matrix

Generated calibration signals per AES6-2008 / Virtins verification methodology.
All signals are 30 seconds, 48 kHz, 32-bit float WAV.

Peak W&F (2σ) = (Δf / f_carrier) × sin(0.95 × 90°), per AES6-2008 Section 6.2.2.

## Unweighted Peak W&F (2σ)

| Signal | Theoretical | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|-------------|--------|--------|--------|--------|--------|
| Unmodulated (0%) | 0.0000% | 0.0017% | 0.0017% | 0.0017% | 0.0017% | 0.0017% |
| 4 Hz mod, 0.00997% | 0.0100% | 0.0107% | 0.0109% | 0.0109% | 0.0109% | 0.0109% |
| 4 Hz mod, 0.0997% | 0.0997% | 0.0976% | 0.0989% | 0.0997% | 0.0997% | 0.0997% |
| 4 Hz mod, 0.997% | 0.9970% | 0.9743% | 0.9912% | 0.9944% | 0.9954% | 0.9954% |
| 4 Hz mod, 9.97% | 9.97% | 9.5108% | 10.2509% | 10.1227% | 10.1346% | 5.4735% |
| 0.8 Hz mod, wtd 0.0499% | 0.0997% | 0.0997% | 0.0997% | 0.0997% | 0.0997% | 0.0998% |
| 20 Hz mod, wtd 0.0506% | 0.0997% | 0.0176% | 0.0791% | 0.0960% | 0.0997% | 0.0997% |
| 0.2 Hz mod, wtd 0.003% | 0.0997% | 0.0997% | 0.0997% | 0.0997% | 0.0997% | 0.0997% |

## Weighted Peak W&F (2σ, AES6)

| Signal | Theoretical | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|-------------|--------|--------|--------|--------|--------|
| Unmodulated (0%) | 0.0000% | 0.0000% | 0.0000% | 0.0000% | 0.0000% | 0.0000% |
| 4 Hz mod, 0.00997% | 0.0100% | 0.0098% | 0.0099% | 0.0100% | 0.0100% | 0.0100% |
| 4 Hz mod, 0.0997% | 0.0997% | 0.0975% | 0.0992% | 0.0996% | 0.0997% | 0.0997% |
| 4 Hz mod, 0.997% | 0.997% | 0.9735% | 0.9905% | 0.9947% | 0.9959% | 0.9958% |
| 4 Hz mod, 9.97% | 9.97% | 8.8654% | 9.9722% | 9.6085% | 9.6218% | 5.0496% |
| 0.8 Hz mod, wtd 0.0499% | 0.0499% | 0.0500% | 0.0500% | 0.0500% | 0.0500% | 0.0500% |
| 20 Hz mod, wtd 0.0506% | 0.0506% | 0.0043% | 0.0388% | 0.0518% | 0.0550% | 0.0551% |
| 0.2 Hz mod, wtd 0.003% | 0.0030% | 0.0031% | 0.0031% | 0.0031% | 0.0031% | 0.0031% |

## Band-Separated RMS (Weighted)

For signals 03, 06, 07, 08 — the primary verification signals.

### Signal 03: 4 Hz mod, 0.0997%

| Metric | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|--------|--------|--------|--------|--------|
| Drift RMS | 0.0030% | 0.0001% | 0.0002% | 0.0000% | 0.0000% |
| Wow RMS | 0.0688% | 0.0699% | 0.0701% | 0.0702% | 0.0702% |
| Flutter RMS | 0.0006% | 0.0005% | 0.0006% | 0.0005% | 0.0005% |

### Signal 06: 0.8 Hz mod, wtd 0.0499%

| Metric | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|--------|--------|--------|--------|--------|
| Drift RMS | 0.0015% | 0.0011% | 0.0007% | 0.0007% | 0.0007% |
| Wow RMS | 0.0354% | 0.0355% | 0.0354% | 0.0354% | 0.0353% |
| Flutter RMS | 0.0000% | 0.0000% | 0.0000% | 0.0000% | 0.0000% |

### Signal 07: 20 Hz mod, wtd 0.0506%

| Metric | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|--------|--------|--------|--------|--------|
| Drift RMS | 0.0004% | 0.0003% | 0.0002% | 0.0000% | 0.0000% |
| Wow RMS | 0.0000% | 0.0001% | 0.0003% | 0.0000% | 0.0000% |
| Flutter RMS | 0.0030% | 0.0275% | 0.0367% | 0.0390% | 0.0391% |

### Signal 08: 0.2 Hz mod, wtd 0.003%

| Metric | 50 Hz | 100 Hz | 200 Hz | 1000 Hz | 3000 Hz |
|--------|--------|--------|--------|--------|--------|
| Drift RMS | 0.0719% | 0.0713% | 0.0704% | 0.0697% | 0.0695% |
| Wow RMS | 0.0024% | 0.0025% | 0.0025% | 0.0025% | 0.0025% |
| Flutter RMS | 0.0000% | 0.0000% | 0.0000% | 0.0000% | 0.0000% |

## Notes

- At 50 Hz carrier, signals 02-05 (4 Hz mod) show reduced accuracy due to zero-crossing
  resolution limits. With only 50 crossings/sec measuring a 4 Hz modulation, each wow cycle
  gets ~12 sample points. Accuracy improves with carrier frequency.
- Signal 05 (9.97% W&F) at 3000 Hz reads low because the ±300 Hz frequency deviation
  exceeds the prefilter bandwidth cap of ±150 Hz — the signal is being clipped by the
  bandpass prefilter. This is expected and does not indicate a pipeline error.
- Signal 07 (20 Hz mod) at 50 Hz reads low because the 20 Hz modulation frequency
  approaches the Nyquist limit of the 50 Hz zero-crossing rate (25 Hz).
- AES6 weighting filter: 4-pole/3-zero analog prototype, bilinear transform.
  All 17 Table 1 points within tolerance. Error at 0.8 Hz: +0.002 dB.
- Wow/flutter split: independent 6th-order Butterworth SOS LP/HP at 6 Hz,
  zero-phase (sosfiltfilt, effective 12th order).
