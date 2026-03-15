"""
Generate AES6 calibration WAV files matching the Virtins verification set
(signals 1-8) at multiple carrier frequencies.

Per Virtins PDF Section 9:
  Peak W&F (2σ) = (Δf / f_carrier) × sin(0.95 × 90°)
  sin(0.95 × 90°) = sin(85.5°) = 0.99692

Signals:
  01: Unmodulated carrier (0% W&F)
  02: 4 Hz mod, 0.00997% peak W&F
  03: 4 Hz mod, 0.0997% peak W&F
  04: 4 Hz mod, 0.997% peak W&F
  05: 4 Hz mod, 9.97% peak W&F
  06: 0.8 Hz mod, weighted peak 0.0499% (unwtd 0.0997%, wt factor 0.500)
  07: 20 Hz mod, weighted peak 0.0506% (unwtd 0.0997%, wt factor 0.508)
  08: 0.2 Hz mod, weighted peak 0.003% (unwtd 0.0997%, wt factor 0.0296)
"""
import numpy as np
import os
from scipy.io import wavfile

SIN_85_5 = np.sin(np.radians(0.95 * 90))  # 0.99692
FS = 48000
DURATION = 30.0  # seconds
CARRIERS = [50, 100, 200, 1000, 3000]

# Signal definitions: (number, f_mod Hz, peak_wf_unweighted %)
# For signals 6-8, unweighted peak is 0.0997% (same as signal 3)
SIGNALS = [
    ("01", None,  0.0,      "Unmodulated"),
    ("02", 4.0,   0.00997,  "4Hz_0.00997pct"),
    ("03", 4.0,   0.0997,   "4Hz_0.0997pct"),
    ("04", 4.0,   0.997,    "4Hz_0.997pct"),
    ("05", 4.0,   9.97,     "4Hz_9.97pct"),
    ("06", 0.8,   0.0997,   "0.8Hz_0.0499pctWtd"),
    ("07", 20.0,  0.0997,   "20Hz_0.0506pctWtd"),
    ("08", 0.2,   0.0997,   "0.2Hz_0.003pctWtd"),
]

t = np.arange(0, DURATION, 1.0 / FS)

for fc in CARRIERS:
    outdir = f"Cal/{fc}Hz"
    os.makedirs(outdir, exist_ok=True)
    print(f"\n=== Carrier: {fc} Hz ===")

    for sig_num, f_mod, peak_wf_pct, desc in SIGNALS:
        # Max frequency deviation: peak_wf = (delta_f / fc) * sin(85.5°)
        # So delta_f = peak_wf_pct / 100 * fc / sin(85.5°)... wait
        # peak_wf_pct = (delta_f / fc) * sin(85.5°) * 100
        # delta_f = peak_wf_pct * fc / (sin(85.5°) * 100)
        if f_mod is None or peak_wf_pct == 0:
            # Unmodulated
            phase = 2 * np.pi * fc * t
            delta_f = 0
        else:
            delta_f = peak_wf_pct * fc / (SIN_85_5 * 100)
            # FM signal: instantaneous freq = fc + delta_f * cos(2π*fm*t)
            # Phase = 2π*fc*t + (delta_f/fm) * sin(2π*fm*t)
            phase = 2 * np.pi * fc * t + (delta_f / f_mod) * np.sin(2 * np.pi * f_mod * t)

        signal = np.sin(phase)

        # Normalize to 24-bit range (use float32 for WAV)
        signal_f32 = signal.astype(np.float32)

        fname = f"{sig_num}_{fc}Hz_{desc}.wav"
        fpath = os.path.join(outdir, fname)
        wavfile.write(fpath, FS, signal_f32)

        if f_mod and peak_wf_pct > 0:
            wtd_info = ""
            if f_mod == 0.8:
                wtd_info = f"  wtd peak={peak_wf_pct * 0.500:.4f}%"
            elif f_mod == 20.0:
                wtd_info = f"  wtd peak={peak_wf_pct * 0.508:.4f}%"
            elif f_mod == 0.2:
                wtd_info = f"  wtd peak={peak_wf_pct * 0.0296:.4f}%"
            print(f"  {fname}  Δf={delta_f:.4f}Hz  peak={peak_wf_pct}%{wtd_info}")
        else:
            print(f"  {fname}  (unmodulated)")

print(f"\nDone. Generated {len(CARRIERS) * len(SIGNALS)} files.")
