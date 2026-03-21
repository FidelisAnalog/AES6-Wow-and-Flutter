"""
am_spectrum_test.py — Test AM/FM spectrum overlay with peak-matched scaling.

Runs wf_core analysis on a WAV file, gets AM and FM spectra, then plots
FM at absolute scale with AM scaled so that its peak matches the FM peak.

Usage:
    python am_spectrum_test.py <wav_file> [--motor-poles N] [--motor-slots N]
                                          [--drive-ratio R] [--rpm R]
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import ScalarFormatter, NullFormatter, FixedLocator
from scipy.io.wavfile import read as wavread
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wf_core


def load_wav(filepath, channel=0):
    fs, data = wavread(filepath)
    if data.ndim > 1:
        sig = data[:, channel].astype(np.float64)
    else:
        sig = data.astype(np.float64)
    return fs, sig


def run(wav_file, rpm=33.333, motor_slots=None, motor_poles=None,
        drive_ratio=1.0):
    basename = os.path.basename(wav_file)
    fs, sig = load_wav(wav_file)

    print(f"Loaded: {basename} ({fs} Hz, {len(sig)/fs:.1f}s)")

    result = wf_core.analyzeFull(
        sig, sampleRate=fs, inputType='audio',
        rpm=rpm, motor_slots=motor_slots, motor_poles=motor_poles,
        drive_ratio=drive_ratio,
    )

    # FM spectrum (from analysis)
    spectrum = result['plots']['spectrum']
    fm_freqs = np.array(spectrum['freqs'])
    fm_amp = np.array(spectrum['amplitude'])

    # AM spectrum (on-demand, same FFT params)
    am_spec = wf_core.getPlotData('am_spectrum')
    am_freqs = np.array(am_spec['freqs'])
    am_amp = np.array(am_spec['amplitude'])

    # Scale AM so its peak matches FM peak
    fm_peak = np.max(fm_amp[1:])
    am_peak = np.max(am_amp[1:])
    if am_peak > 0:
        am_scale = fm_peak / am_peak
    else:
        am_scale = 1.0
    am_amp_scaled = am_amp * am_scale

    # --- Plot ---
    fig, ax = plt.subplots(1, 1, figsize=(14, 5))

    ax.plot(fm_freqs[1:], fm_amp[1:], linewidth=0.8, color='#2266aa',
            label='FM (speed deviation)')
    ax.plot(am_freqs[1:], am_amp_scaled[1:], linewidth=0.8, color='#cc4444',
            alpha=0.7, label=f'AM (envelope, ×{am_scale:.3f})')

    ax.set_xscale('log')
    f_max = fm_freqs[-1] if len(fm_freqs) > 0 else 50.0
    ax.set_xlim(0.4, f_max)
    all_ticks = [t for t in [0.5, 1, 2, 5, 10, 20, 50, 100, 150, 200]
                 if t <= f_max]
    ax.xaxis.set_major_locator(FixedLocator(all_ticks))
    ax.xaxis.set_major_formatter(ScalarFormatter())
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.ticklabel_format(axis='x', style='plain')

    ax.set_ylabel('Deviation (% RMS/√Hz)')
    ax.set_xlabel('Modulation Frequency (Hz)')
    ax.set_title(f'AM/FM Spectral Comparison — {basename}\n'
                 f'AM scaled peak-to-peak (AM×{am_scale:.3f})',
                 fontsize=10)
    ax.legend(fontsize=8, loc='upper right', framealpha=0.9)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    out_name = os.path.splitext(basename)[0] + '_am_fm_spectrum.png'
    plt.savefig(out_name, dpi=150, bbox_inches='tight')
    print(f"Saved: {out_name}")
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='AM/FM spectrum overlay test')
    parser.add_argument('input', help='WAV file')
    parser.add_argument('--motor-slots', type=int, default=None)
    parser.add_argument('--motor-poles', type=int, default=None)
    parser.add_argument('--drive-ratio', type=float, default=1.0)
    parser.add_argument('--rpm', type=float, default=33.333)
    args = parser.parse_args()

    run(args.input, rpm=args.rpm, motor_slots=args.motor_slots,
        motor_poles=args.motor_poles, drive_ratio=args.drive_ratio)
