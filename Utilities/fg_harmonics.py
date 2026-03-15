#!/usr/bin/env python3
"""
Harmonic decomposition overlay — extracts identified motor harmonic
components from the speed deviation signal and plots them all on a
single time-domain plot, showing the composition of the total W&F.

Usage:
    python fg_harmonics.py <wav_file> --motor-slots N --motor-poles N [--rpm R] [--revs N]
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from fg_analyze import analyze
import argparse
import os


def extract_harmonic(deviation, fs, center_freq, bandwidth=None, f_rot=None):
    """
    Extract a single frequency component from the deviation signal
    using a narrow bandpass filter (Butterworth, filtfilt for zero phase).

    Bandwidth is set narrow enough to exclude sidebands at ±f_rot.
    """
    from scipy.signal import butter, sosfiltfilt

    if bandwidth is None:
        # Must be narrower than the spacing to the nearest neighbor
        # (which is f_rot away for motor harmonics). Use 80% of f_rot
        # as max bandwidth, with 0.3 Hz floor for very low frequencies.
        if f_rot is not None:
            bandwidth = min(f_rot * 0.8, max(0.3, center_freq * 0.05))
        else:
            bandwidth = max(0.3, center_freq * 0.05)

    lo = center_freq - bandwidth / 2
    hi = center_freq + bandwidth / 2
    nyquist = fs / 2.0

    # Clamp to valid range
    lo = max(lo, 0.05)
    hi = min(hi, nyquist * 0.95)

    sos = butter(4, [lo / nyquist, hi / nyquist], btype='bandpass', output='sos')
    return sosfiltfilt(sos, deviation)


def harmonic_overlay(wav_file, motor_slots, motor_poles, rpm=33.333,
                     n_revs=3, extra_harmonics=True):
    """
    Generate a single plot with the total deviation and each identified
    motor harmonic component overlaid.
    """
    # Run analysis
    r = analyze(wav_file)
    a = r['aes6']
    fs_dev = r['output_rate']
    dev = r['deviation_pct']
    t = r['t_uniform']

    # Motor harmonics
    f_rot = rpm / 60.0
    pole_pairs = motor_poles // 2
    f_elec = pole_pairs * f_rot
    f_slot = motor_slots * f_rot
    f_ripple = 3 * f_elec

    # Build list of harmonics to extract: (label, frequency, color)
    harmonics = [
        ('Rotation', f_rot, '#e41a1c'),
        ('Electrical', f_elec, '#4daf4a'),
        ('Slot passing', f_slot, '#984ea3'),
        ('Torque ripple', f_ripple, '#ff7f00'),
    ]

    if extra_harmonics:
        f_2elec = 2 * f_elec
        if abs(f_2elec - f_slot) > 0.3 and abs(f_2elec - f_ripple) > 0.3:
            harmonics.append(('2x Electrical', f_2elec, '#377eb8'))
        f_2ripple = 2 * f_ripple
        if f_2ripple < fs_dev / 2:
            harmonics.append(('2x Torque ripple', f_2ripple, '#a65628'))

    # Full-length FFT for accurate per-harmonic RMS (single-bin, no noise floor)
    N = len(dev)
    win = np.hanning(N)
    X = np.fft.rfft(dev * win)
    freqs_fft = np.fft.rfftfreq(N, d=1.0 / fs_dev)
    fft_amp = np.abs(X) * 2.0 / np.sum(win)

    # Extract each component
    components = []
    for label, freq, color in harmonics:
        if freq < fs_dev / 2:
            comp = extract_harmonic(dev, fs_dev, freq, f_rot=f_rot)
            # Use FFT bin amplitude for the legend RMS (isolates harmonic from noise)
            idx = np.argmin(np.abs(freqs_fft - freq))
            rms = fft_amp[idx] / np.sqrt(2)
            components.append((label, freq, color, comp, rms))

    # Sort by RMS descending so biggest draw first (background), smallest last (foreground)
    components.sort(key=lambda x: x[4], reverse=True)

    # Time window — start a few revolutions in to avoid filtfilt edge transients
    sec_per_rev = 60.0 / rpm
    settle_revs = 3  # skip first 3 revolutions (~5.4s at 33 RPM)
    t_start = t[0] + settle_revs * sec_per_rev
    t_end = t_start + sec_per_rev * n_revs
    mask = (t >= t_start) & (t <= t_end)

    # Plot
    fig, ax = plt.subplots(1, 1, figsize=(14, 6))

    fig.suptitle(
        f"{r['basename']}  —  Harmonic Decomposition\n"
        f"Motor: {motor_slots} slots, {motor_poles} poles, {rpm:.1f} RPM    "
        f"f_rot={f_rot:.3f} Hz  f_elec={f_elec:.2f} Hz  "
        f"f_slot={f_slot:.2f} Hz  f_ripple={f_ripple:.2f} Hz",
        fontsize=10)

    # Total signal — light, in background
    ax.plot(t[mask], dev[mask], linewidth=0.8, color='#2266aa', alpha=0.45,
            label='Total')

    # Overlay each harmonic
    for label, freq, color, comp, rms in components:
        ax.plot(t[mask], comp[mask], linewidth=1.2, color=color,
                label='%s  %.2f Hz  (%.4f%% RMS)' % (label, freq, rms))

    ax.axhline(0, color='gray', linewidth=0.5)

    # Revolution boundaries
    for rev in range(n_revs + 1):
        ax.axvline(t[mask][0] + rev * sec_per_rev, color='green',
                   linewidth=0.5, alpha=0.4)

    ax.set_ylabel('Speed Deviation (%)')
    ax.set_xlabel('Time (s)')
    ax.set_title('Speed Deviation — %d revolutions' % n_revs, fontsize=9)
    ax.grid(True, alpha=0.3)

    # Scale to total signal
    total_peak = np.max(np.abs(dev[mask])) * 1.1
    ax.set_ylim(-total_peak, total_peak)

    ax.legend(loc='upper right', fontsize=7, framealpha=0.9,
              prop={'family': 'monospace', 'size': 7})

    plt.tight_layout()

    # Save
    out_name = os.path.splitext(r['basename'])[0] + '_harmonics.png'
    plt.savefig(out_name, dpi=150, bbox_inches='tight')
    print(f"\nSaved: {out_name}")
    plt.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Motor harmonic overlay')
    parser.add_argument('wav', help='WAV file to analyze')
    parser.add_argument('--motor-slots', type=int, required=True)
    parser.add_argument('--motor-poles', type=int, required=True)
    parser.add_argument('--rpm', type=float, default=33.333)
    parser.add_argument('--revs', type=int, default=3, help='Number of revolutions to show')
    args = parser.parse_args()

    harmonic_overlay(args.wav, args.motor_slots, args.motor_poles,
                     rpm=args.rpm, n_revs=args.revs)
