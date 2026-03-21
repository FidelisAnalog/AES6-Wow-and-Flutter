"""
wf_analyze — Standalone CLI front-end for wf_core W&F analysis engine.

Drop-in replacement for fg_analyze.py — identical CLI parameters and
plot outputs, but delegates all DSP to wf_core.analyzeFull / getPlotData.

Usage:
    python wf_analyze.py [wav_file] [--motor-slots N] [--motor-poles N] [--rpm R]
"""

import numpy as np
from scipy.io.wavfile import read as wavread
import matplotlib.pyplot as plt
import os
import sys
import argparse

import wf_core


# ========================= WAV LOADER =========================

def load_wav(filepath, channel=0):
    """Load WAV file, return (sample_rate, signal_as_float64)."""
    fs, data = wavread(filepath)
    if data.ndim > 1:
        sig = data[:, channel].astype(np.float64)
    else:
        sig = data.astype(np.float64)
    return fs, sig


# ========================= MAIN ANALYSIS =========================

def analyze(wav_file, channel=0, rpm=None, motor_slots=None,
            motor_poles=None, drive_ratio=1.0):
    """
    Run full analysis via wf_core engine.

    Returns a result dict structured for plot_results(), with the same
    keys as fg_analyze for backward compatibility.
    """
    basename = os.path.basename(wav_file)

    # Detect input type by extension
    ext = os.path.splitext(wav_file)[1].lower()
    if ext == '.wav':
        fs, sig = load_wav(wav_file, channel)
        duration = len(sig) / fs
        print(f"Loaded: {basename}")
        print(f"  Sample rate: {fs} Hz")
        print(f"  Duration: {duration:.2f} s")
        print(f"  Samples: {len(sig)}")
        result = wf_core.analyzeFull(
            sig, sampleRate=fs, inputType='audio',
            rpm=rpm, motor_slots=motor_slots, motor_poles=motor_poles,
            drive_ratio=drive_ratio,
        )
    else:
        with open(wav_file, 'r') as f:
            text_data = f.read()
        print(f"Loaded: {basename}")
        result = wf_core.analyzeFull(
            text_data, inputType='device',
            rpm=rpm, motor_slots=motor_slots, motor_poles=motor_poles,
            drive_ratio=drive_ratio,
        )

    # Extract for convenience
    m = result['metrics']
    std = m['standard']
    nstd = m['non_standard']
    f_mean = m['f_mean']

    t_uniform = np.array(result['plots']['dev_time']['t'])
    deviation_pct = np.array(result['plots']['dev_time']['deviation_pct'])
    output_rate = len(t_uniform) / (t_uniform[-1] - t_uniform[0])

    # Raw deviation stats (pre-SRC, for backward compat with fg_analyze)
    dev_pct_abs = np.abs(deviation_pct)
    wf_peak_2sigma = float(np.percentile(dev_pct_abs, 95))
    wf_peak_to_peak = float(
        np.percentile(deviation_pct, 99.85) -
        np.percentile(deviation_pct, 0.15)
    )

    # Console output
    print(f"  Mean frequency: {f_mean:.4f} Hz")
    print(f"  Standard (AES6/DIN/IEC):")
    print(f"    Unwtd peak (2σ):  ±{std['unweighted_peak']['value']:.4f}%")
    print(f"    Unwtd RMS:         {std['unweighted_rms']['value']:.4f}%")
    print(f"    Wtd peak (2σ):    ±{std['weighted_peak']['value']:.4f}%")
    print(f"    Wtd RMS (JIS):     {std['weighted_rms']['value']:.4f}%")
    print(f"    Wtd wow RMS:       {std['weighted_wow_rms']['value']:.4f}%")
    print(f"    Wtd flutter RMS:   {std['weighted_flutter_rms']['value']:.4f}%")
    print(f"  Non-standard:")
    print(f"    Drift RMS (0.05-0.5 Hz):   {nstd['drift_rms']['value']:.4f}%")
    print(f"    Unwtd wow RMS (0.5-6 Hz):  {nstd['unweighted_wow_rms']['value']:.4f}%")
    print(f"    Unwtd flutter RMS (>6 Hz): {nstd['unweighted_flutter_rms']['value']:.4f}%")
    print(f"    Peak-to-peak:              {wf_peak_to_peak:.4f}%")

    # Build result dict matching fg_analyze's structure for plot_results()
    return {
        'basename': basename,
        't_uniform': t_uniform,
        'deviation_pct': deviation_pct,
        'output_rate': output_rate,
        'f_mean': f_mean,
        'wf_peak_2sigma': wf_peak_2sigma,
        'wf_peak_to_peak': wf_peak_to_peak,
        'standard': {
            'peak_unweighted': std['unweighted_peak']['value'],
            'rms_unweighted': std['unweighted_rms']['value'],
            'peak_weighted': std['weighted_peak']['value'],
            'rms_weighted': std['weighted_rms']['value'],
            'wow_rms': std['weighted_wow_rms']['value'],
            'flutter_rms': std['weighted_flutter_rms']['value'],
        },
        'non_standard': {
            'drift_rms': nstd['drift_rms']['value'],
            'wow_rms': nstd['unweighted_wow_rms']['value'],
            'flutter_rms': nstd['unweighted_flutter_rms']['value'],
            'peak_to_peak': wf_peak_to_peak,
        },
        'spectrum': result['plots']['spectrum'],
        'rpm': rpm,
        'f_rot': m.get('f_rot'),
        'input_type': m['input_type'],
        'available': result.get('available', {}),
    }


# ========================= PLOTTING =========================

def plot_results(r, sec_per_rev=1.8, n_revs=4,
                 motor_slots=None, motor_poles=None, rpm=33.333,
                 polar_revs=2):
    """
    Generate diagnostic plots — identical layout to fg_analyze.

    4-panel figure:
      Row 1: Speed deviation zoomed (n_revs revolutions)
      Row 2: Speed deviation full capture
      Row 3: Spectrum with peak labels and motor harmonic ID
      Row 4: Histogram (left) + Polar (right)
    """
    fig = plt.figure(figsize=(14, 18))
    gs = fig.add_gridspec(3, 1, height_ratios=[1, 1, 1],
                          top=0.935, bottom=0.38, hspace=0.3)
    axes = [
        fig.add_subplot(gs[0]),
        fig.add_subplot(gs[1]),
        fig.add_subplot(gs[2]),
    ]

    # Title with key metrics
    s = r['standard']
    ns = r['non_standard']
    fig.suptitle(
        f"{r['basename']}\n"
        f"Mean: {r['f_mean']:.3f} Hz    "
        f"Drift: {ns['drift_rms']:.4f}%\n"
        f"Unwtd Wow: {ns['wow_rms']:.4f}%    "
        f"Unwtd Flutter: {ns['flutter_rms']:.4f}%    "
        f"DIN/IEC Unwtd:  Peak(2σ) ±{s['peak_unweighted']:.4f}%    "
        f"RMS {s['rms_unweighted']:.4f}%\n"
        f"DIN/IEC Wtd:  Peak(2σ) ±{s['peak_weighted']:.4f}%    "
        f"RMS {s['rms_weighted']:.4f}% (JIS)    "
        f"Wow {s['wow_rms']:.4f}%    "
        f"Flutter {s['flutter_rms']:.4f}%",
        fontsize=10, y=0.985)

    t_plot_end = sec_per_rev * n_revs
    mask_uni = r['t_uniform'] <= t_plot_end

    # --- Plot 1: Speed deviation zoomed ---
    ax = axes[0]
    ax.plot(r['t_uniform'][mask_uni], r['deviation_pct'][mask_uni], '-',
            linewidth=0.8, color='#2266aa')
    ax.axhline(0, color='gray', linestyle='-', linewidth=0.5)
    ax.axhline(r['wf_peak_2sigma'], color='red', linestyle='--',
               linewidth=0.6, alpha=0.7)
    ax.axhline(-r['wf_peak_2sigma'], color='red', linestyle='--',
               linewidth=0.6, alpha=0.7)
    for rev in range(n_revs + 1):
        ax.axvline(rev * sec_per_rev, color='green', linestyle='-',
                   linewidth=0.6, alpha=0.4)
    ax.set_ylabel('Speed Deviation (%)')
    ax.set_xlabel('Time (s)')
    ax.set_title(f'Speed Deviation ({n_revs} revolutions, {sec_per_rev}s/rev)')
    ax.set_xlim(0, t_plot_end)
    peak = max(np.max(np.abs(r['deviation_pct'][mask_uni])),
               r['wf_peak_2sigma']) * 1.3
    ax.set_ylim(-peak, peak)
    ax.grid(True, alpha=0.3)

    # --- Plot 2: Speed deviation full ---
    ax = axes[1]
    ax.plot(r['t_uniform'], r['deviation_pct'], '-',
            linewidth=0.4, color='#2266aa')
    ax.axhline(0, color='gray', linestyle='-', linewidth=0.5)
    ax.axhline(r['wf_peak_2sigma'], color='red', linestyle='--',
               linewidth=0.6, alpha=0.7)
    ax.axhline(-r['wf_peak_2sigma'], color='red', linestyle='--',
               linewidth=0.6, alpha=0.7)
    ax.set_ylabel('Speed Deviation (%)')
    ax.set_xlabel('Time (s)')
    ax.set_title('Speed Deviation (full capture)')
    ax.set_ylim(-peak, peak)
    ax.grid(True, alpha=0.3)

    # --- Plot 3: Spectrum ---
    ax = axes[2]
    spectrum = r['spectrum']
    freqs = np.array(spectrum['freqs'])
    amp = np.array(spectrum['amplitude'])
    fs_dev = r['output_rate']

    ax.plot(freqs[1:], amp[1:], linewidth=0.8, color='#2266aa')
    ax.set_ylabel('Speed Deviation (% RMS/√Hz)')
    ax.set_xlabel('Modulation Frequency (Hz)')
    ax.set_title('Speed Deviation Spectrum')
    ax.grid(True, alpha=0.3)

    from matplotlib.ticker import ScalarFormatter, NullFormatter, FixedLocator
    ax.set_xscale('log')
    f_max = freqs[-1] if len(freqs) > 0 else 50.0
    ax.set_xlim(0.4, f_max)
    # Build tick locations up to f_max
    all_ticks = [t for t in [0.5, 1, 2, 5, 10, 20, 50, 100, 150, 200] if t <= f_max]
    ax.xaxis.set_major_locator(FixedLocator(all_ticks))
    ax.xaxis.set_major_formatter(ScalarFormatter())
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.ticklabel_format(axis='x', style='plain')

    # Peak markers — filter to match fg_analyze (top 12 by amplitude, >8% of max)
    all_peaks = spectrum['peaks']
    if all_peaks:
        max_amp = max(p['amplitude'] for p in all_peaks)
        peaks = [p for p in all_peaks if p['amplitude'] >= max_amp * 0.08]
        peaks = sorted(peaks, key=lambda p: p['amplitude'], reverse=True)[:12]
        peaks = sorted(peaks, key=lambda p: p['freq'])
    else:
        peaks = []

    _cmap = plt.cm.tab10
    have_motor = motor_slots is not None and motor_poles is not None
    legend_entries = []
    for i, pk in enumerate(peaks):
        f = pk['freq']
        a_val = pk['amplitude']
        bin_rms = pk['rms']
        label = pk.get('label') if have_motor else None
        color = _cmap(i % 10)

        if label:
            legend_entries.append(
                (color, f'{f:6.2f} Hz  {bin_rms:.4f}%  {label}'))
        else:
            legend_entries.append(
                (color, f'{f:6.2f} Hz  {bin_rms:.4f}%'))

        ax.plot(f, a_val, 'v', color=color, markersize=8,
                markeredgecolor='black', markeredgewidth=0.4)

    if legend_entries:
        from matplotlib.lines import Line2D
        handles = []
        labels = []
        for color, text in legend_entries:
            handles.append(Line2D([0], [0], marker='s', color='none',
                           markerfacecolor=color, markeredgecolor='black',
                           markeredgewidth=0.4, markersize=5))
            labels.append(text)
        ax.legend(handles, labels, loc='upper right', fontsize=6,
                  framealpha=0.9, edgecolor='#cccccc',
                  handletextpad=0.4, borderpad=0.4,
                  prop={'family': 'monospace', 'size': 6})

    # --- Bottom row: histogram (left) + polar (right) ---
    row4_top = 0.33
    row4_bot = 0.03
    row4_h = row4_top - row4_bot

    page_left = axes[2].get_position().x0
    page_right = axes[2].get_position().x1

    polar_w = (page_right - page_left) * 0.58
    polar_left = page_right - polar_w
    ax_polar = fig.add_axes([polar_left, row4_bot, polar_w, row4_h],
                            projection='polar')

    hist_left = page_left
    hist_right = polar_left - 0.02
    ax_hist = fig.add_axes([hist_left, row4_bot,
                            hist_right - hist_left, row4_h])

    # --- Plot 4a: Histogram ---
    ax_hist.hist(r['deviation_pct'], bins=256, density=True,
                 color='#2266aa', alpha=0.7, edgecolor='none')
    ax_hist.axvline(0, color='gray', linewidth=0.5)
    ax_hist.set_xlabel('Speed Deviation (%)')
    ax_hist.set_ylabel('Density')
    ax_hist.set_title('Deviation Distribution', fontsize=9)
    ax_hist.grid(True, alpha=0.3)
    hist_max = max(
        np.percentile(np.abs(r['deviation_pct']), 99.7) * 1.3, 0.1)
    ax_hist.set_xlim(-hist_max, hist_max)

    # --- Plot 4b: Polar ---
    hz_per_tick = r['f_mean'] * 0.001  # 0.1% per tick

    samples_per_rev = int(round(sec_per_rev * fs_dev))
    inst_freq = r['f_mean'] * (1.0 + r['deviation_pct'] / 100.0)

    skip_revs = 1
    start_idx = skip_revs * samples_per_rev

    end_idx = min(start_idx + polar_revs * samples_per_rev, len(inst_freq))
    maxf = np.max(inst_freq[start_idx:end_idx]) + hz_per_tick * 0.5

    theta = np.linspace(0, 2 * np.pi, samples_per_rev, endpoint=False)
    theta = -theta  # clockwise
    theta = np.roll(theta, samples_per_rev // 4)  # 0° at top

    colors = plt.cm.tab10
    for rev in range(polar_revs):
        idx_start = start_idx + rev * samples_per_rev
        idx_end = idx_start + samples_per_rev
        if idx_end > len(inst_freq):
            break
        freq_rev = inst_freq[idx_start:idx_end]
        r_polar = 20.0 - (maxf - freq_rev) / hz_per_tick
        ax_polar.plot(theta[:len(r_polar)], r_polar, linewidth=0.8,
                      color=colors(rev % 10))

    ax_polar.set_rmax(20)
    tick_loc = np.arange(1, 21, 1)
    ax_polar.set_rgrids(tick_loc, labels=[''] * 20)

    from matplotlib.ticker import FixedLocator as _FixedLocator
    ax_polar.xaxis.set_major_locator(
        _FixedLocator(np.linspace(0, 2 * np.pi, 8, endpoint=False)))
    ax_polar.set_xticklabels(
        ['90°', '45°', '0°', '315°', '270°', '225°', '180°', '135°'])

    ax_polar.text(0.98, 0.02, '0.1%/div',
                  transform=ax_polar.transAxes, fontsize=7,
                  verticalalignment='bottom',
                  horizontalalignment='right',
                  bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                            edgecolor='#cccccc', alpha=0.9))

    from matplotlib.lines import Line2D as _Line2D
    rev_handles = []
    for rev in range(polar_revs):
        rev_handles.append(_Line2D([0], [0], color=colors(rev % 10),
                                   linewidth=1.5, label=f'Rev {rev + 1}'))
    ax_polar.legend(handles=rev_handles, loc='lower left', fontsize=6,
                    framealpha=0.9, edgecolor='#cccccc', borderpad=0.3,
                    handlelength=1.2,
                    bbox_to_anchor=(0.02, 0.02),
                    bbox_transform=ax_polar.transAxes)

    ax_polar.grid(True, alpha=0.4)

    # Save
    out_name = os.path.splitext(r['basename'])[0] + '_analysis.png'
    plt.savefig(out_name, dpi=150, bbox_inches='tight')
    print(f"\nSaved: {out_name}")
    plt.close(fig)


# ========================= LISSAJOUS PLOT =========================

def plot_lissajous(r, freqs):
    """Plot AM/FM Lissajous for one or more frequencies. Audio only.

    Single freq: 5×5 plot (backward compatible).
    Multiple freqs: 1-row × N-col panel.
    """
    if not isinstance(freqs, (list, tuple)):
        freqs = [freqs]

    n = len(freqs)

    if n == 1:
        # Single frequency — original layout
        freq = freqs[0]
        liss = wf_core.getPlotData('lissajous', {'freq': freq})
        am = np.array(liss['am_norm'])
        fm = np.array(liss['fm_norm'])

        fig, ax = plt.subplots(1, 1, figsize=(5, 5))
        ax.plot(am, fm, linewidth=0.5, color='#2266aa', alpha=0.6)
        ax.set_xlim(-1.5, 1.5)
        ax.set_ylim(-1.5, 1.5)
        ax.set_aspect('equal')
        ax.axhline(0, color='gray', linewidth=0.3)
        ax.axvline(0, color='gray', linewidth=0.3)
        ax.set_xlabel('AM (norm)')
        ax.set_ylabel('FM (norm)')

        sig_text = ' ★ significant' if liss['significant'] else ''
        ax.set_title(f'AM/FM Lissajous — {r["basename"]}\n'
                     f'{freq:.2f} Hz   R={liss["R"]:.3f}  '
                     f'φ={liss["phase"]:.0f}°  '
                     f'str={liss["strength"]:.5f}{sig_text}',
                     fontsize=9)
        ax.grid(True, alpha=0.3)
        plt.tight_layout()
    else:
        # Multi-frequency panel: 1 row × n cols
        fig, axes = plt.subplots(1, n, figsize=(4 * n, 4), squeeze=False)
        fig.suptitle(f'AM/FM Lissajous — {r["basename"]}',
                     fontsize=11, y=1.02)

        for i, freq in enumerate(freqs):
            ax = axes[0][i]
            try:
                liss = wf_core.getPlotData('lissajous', {'freq': freq})
                am = np.array(liss['am_norm'])
                fm = np.array(liss['fm_norm'])

                ax.plot(am, fm, linewidth=0.5, color='#2266aa', alpha=0.6)
                ax.set_xlim(-1.5, 1.5)
                ax.set_ylim(-1.5, 1.5)
                ax.set_aspect('equal')
                ax.axhline(0, color='gray', linewidth=0.3)
                ax.axvline(0, color='gray', linewidth=0.3)
                ax.set_xlabel('AM', fontsize=7)
                ax.set_ylabel('FM', fontsize=7)
                ax.tick_params(labelsize=6)

                sig_text = ' *' if liss['significant'] else ''
                ax.set_title(f'{freq:.2f} Hz  R={liss["R"]:.3f}  '
                             f'φ={liss["phase"]:.0f}°{sig_text}\n'
                             f'str={liss["strength"]:.5f}',
                             fontsize=7)
                ax.grid(True, alpha=0.3)
            except Exception as e:
                ax.text(0.5, 0.5, f'{freq:.2f} Hz\nError',
                        ha='center', va='center', transform=ax.transAxes,
                        fontsize=8)
                ax.set_title(f'{freq:.2f} Hz', fontsize=7)

        plt.tight_layout()

    out_name = os.path.splitext(r['basename'])[0] + '_lissajous.png'
    plt.savefig(out_name, dpi=150, bbox_inches='tight')
    print(f"Saved: {out_name}")
    plt.close(fig)


def plot_lissajous_peaks(r):
    """Plot AM/FM Lissajous panel for all detected spectrum peaks. Audio only."""
    all_peaks = r['spectrum']['peaks']
    if not all_peaks:
        print("  No peaks found — skipping Lissajous panel")
        return

    # Same filtering as spectrum plot: top 12 by amplitude, >8% of max
    max_amp = max(p['amplitude'] for p in all_peaks)
    peaks = [p for p in all_peaks if p['amplitude'] >= max_amp * 0.08]
    peaks = sorted(peaks, key=lambda p: p['amplitude'], reverse=True)[:12]
    peaks = sorted(peaks, key=lambda p: p['freq'])

    n = len(peaks)
    if n == 0:
        print("  No significant peaks — skipping Lissajous panel")
        return

    ncols = (n + 1) // 2
    nrows = 2 if n > 1 else 1
    fig, axes = plt.subplots(nrows, ncols, figsize=(4 * ncols, 8),
                              squeeze=False)

    fig.suptitle(f'AM/FM Lissajous — {r["basename"]}',
                 fontsize=11, y=0.98)

    for i, pk in enumerate(peaks):
        freq = pk['freq']
        row = i // ncols
        col = i % ncols
        ax = axes[row][col]

        try:
            liss = wf_core.getPlotData('lissajous', {'freq': freq})
            am = np.array(liss['am_norm'])
            fm = np.array(liss['fm_norm'])

            ax.plot(am, fm, linewidth=0.5, color='#2266aa', alpha=0.6)
            ax.set_xlim(-1.5, 1.5)
            ax.set_ylim(-1.5, 1.5)
            ax.set_aspect('equal')
            ax.axhline(0, color='gray', linewidth=0.3)
            ax.axvline(0, color='gray', linewidth=0.3)
            ax.set_xlabel('AM', fontsize=7)
            ax.set_ylabel('FM', fontsize=7)
            ax.tick_params(labelsize=6)

            sig_text = ' *' if liss['significant'] else ''
            label = pk.get('label') or ''
            ax.set_title(f'{freq:.2f} Hz  R={liss["R"]:.3f}  '
                         f'φ={liss["phase"]:.0f}°{sig_text}\n'
                         f'{label}',
                         fontsize=7)
            ax.grid(True, alpha=0.3)
        except Exception as e:
            ax.text(0.5, 0.5, f'{freq:.2f} Hz\nError',
                    ha='center', va='center', transform=ax.transAxes,
                    fontsize=8)
            ax.set_title(f'{freq:.2f} Hz', fontsize=7)

    # Hide unused subplots
    for i in range(n, nrows * ncols):
        row = i // ncols
        col = i % ncols
        axes[row][col].set_visible(False)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    out_name = os.path.splitext(r['basename'])[0] + '_lissajous_peaks.png'
    plt.savefig(out_name, dpi=150, bbox_inches='tight')
    print(f"Saved: {out_name}")
    plt.close(fig)


# ========================= CLI =========================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='W&F analyzer (wf_core engine)')
    parser.add_argument('input', help='Input file (WAV audio or device text export)')
    parser.add_argument('--motor-slots', type=int, default=None,
                        help='Number of motor slots')
    parser.add_argument('--motor-poles', type=int, default=None,
                        help='Number of motor poles')
    parser.add_argument('--rpm', type=float, default=33.333,
                        help='Turntable RPM (default: 33.333)')
    parser.add_argument('--drive-ratio', type=float, default=1.0,
                        help='Motor-to-platter speed ratio (default: 1.0 = direct drive)')
    parser.add_argument('--polar-revs', type=int, default=2,
                        help='Number of revolutions in polar plot (default: 2)')
    parser.add_argument('--lissajous-freq', type=float, nargs='+', default=None,
                        help='Frequency/ies (Hz) for AM/FM Lissajous plot (audio only)')
    parser.add_argument('--lissajous-peaks', action='store_true',
                        help='AM/FM Lissajous panel for all detected peaks (audio only)')
    args = parser.parse_args()

    results = analyze(args.input, rpm=args.rpm,
                      motor_slots=args.motor_slots,
                      motor_poles=args.motor_poles,
                      drive_ratio=args.drive_ratio)
    plot_results(results, motor_slots=args.motor_slots,
                 motor_poles=args.motor_poles, rpm=args.rpm,
                 polar_revs=args.polar_revs)

    if args.lissajous_freq is not None:
        if results['input_type'] != 'audio':
            print("  Lissajous requires audio input — skipping")
        else:
            plot_lissajous(results, args.lissajous_freq)

    if args.lissajous_peaks:
        if results['input_type'] != 'audio':
            print("  Lissajous requires audio input — skipping")
        else:
            plot_lissajous_peaks(results)
