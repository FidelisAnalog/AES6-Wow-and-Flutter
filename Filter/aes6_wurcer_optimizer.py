#!/usr/bin/env python3
"""
AES6-2008 Weighting Filter — Wurcer-Style Optimizer
=====================================================

Following Scott Wurcer's methodology from Linear Audio Vol 10:
- Define filter as poles and zeros in the s-domain (Hz)
- Map to z-domain via bilinear transform
- Optimize ALL pole/zero locations to minimize ptp error vs Table 1
- "The zeros at infinity do us no good and are free parameters.
   By bringing them into the unit circle we can tailor the response
   at the high end for a better match and it adds more handles."

For AES6, the physical topology tells us:
- Below passband: ~18 dB/oct rise → 3 zeros at DC
- Above passband: ~6 dB/oct roll-off → net (zeros - poles) = -1
- So minimum: 3 DC zeros + 4 poles
- Following Wurcer: bring "infinity" zeros to finite freqs as free params

Topologies tested:
  A) 3 DC zeros + 4 real poles (baseline, 4 free params)
  B) 3 DC zeros + 1 finite zero + 4 real poles (5 free params)
  C) 3 DC zeros + 2 finite zeros + 5 real poles (7 free params)
  D) 2 DC zeros + 3 real poles (minimum order, 3 free params)
  E) 2 DC zeros + 1 finite zero + 4 real poles (5 free params)
"""

import numpy as np
from numpy import pi, inf
from scipy.optimize import brute, minimize
from scipy.optimize import fmin as scipy_fmin
from scipy.signal import freqz, bilinear, tf2zpk, zpk2sos
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# =============================================================================
# AES6-2008 Table 1
# =============================================================================
AES6_TABLE = [
    (0.1, -48.0, +10, -4), (0.2, -30.6, +10, -4),
    (0.315, -19.7, +4, -4), (0.4, -15.0, +4, -4),
    (0.63, -8.4, +2, -2), (0.8, -6.0, +2, -2),
    (1.0, -4.2, +2, -2), (1.6, -1.8, +2, -2),
    (2.0, -0.9, +2, -2), (4.0, 0.0, 0, 0),
    (6.3, -0.9, +2, -2), (10.0, -2.1, +2, -2),
    (20.0, -5.9, +2, -2), (40.0, -10.4, +2, -2),
    (63.0, -14.2, +4, -4), (100.0, -17.3, +4, -4),
    (200.0, -23.0, +4, -4),
]
T1_FREQS = np.array([p[0] for p in AES6_TABLE])
T1_LEVELS = np.array([p[1] for p in AES6_TABLE])
T1_TOL_P = np.array([p[2] for p in AES6_TABLE])
T1_TOL_M = np.array([p[3] for p in AES6_TABLE])

FS = 1000.0


# =============================================================================
# Core Functions (per Wurcer)
# =============================================================================

def z_from_f(f_hz, fs):
    """Bilinear transform: s-domain frequency (Hz) → z-plane location.
    Wurcer's convention: z = (fs/π - f) / (fs/π + f)
    Maps DC(f=0) → z=1, infinity → z=-1, poles inside unit circle."""
    if f_hz == 0:
        return 1.0
    if f_hz == inf or f_hz > 1e10:
        return -1.0
    return (fs / pi - f_hz) / (fs / pi + f_hz)


def Fz_at_f(poles_hz, zeros_hz, f_eval, fs):
    """Z-domain frequency response from s-domain pole/zero frequencies.
    Wurcer eq. (9) with (10): evaluate on unit circle."""
    f_eval = np.atleast_1d(f_eval).astype(float)
    omega = 2 * pi * f_eval / fs
    ejw = np.exp(1j * omega)

    ans = np.ones_like(ejw, dtype=complex)
    for z_hz in zeros_hz:
        zz = z_from_f(z_hz, fs)
        ans *= (ejw - zz)
    for p_hz in poles_hz:
        zp = z_from_f(p_hz, fs)
        ans /= (ejw - zp)
    return ans


def Fs_at_f(poles_hz, zeros_hz, f_eval):
    """S-domain (analog) frequency response."""
    f_eval = np.atleast_1d(f_eval).astype(float)
    ans = np.ones_like(f_eval, dtype=complex)
    for z_hz in zeros_hz:
        if z_hz == 0:
            ans *= (1j * f_eval)
        elif z_hz == inf or z_hz > 1e10:
            pass
        else:
            ans *= (z_hz + 1j * f_eval)
    for p_hz in poles_hz:
        if p_hz == 0:
            ans /= (1j * f_eval + 1e-30)
        elif p_hz == inf or p_hz > 1e10:
            pass
        else:
            ans /= (p_hz + 1j * f_eval)
    return ans


def response_dB_normalized(poles_hz, zeros_hz, f_eval, fs, norm_freq=4.0):
    """Get z-domain response in dB, normalized at norm_freq."""
    Hz = Fz_at_f(poles_hz, zeros_hz, f_eval, fs)
    Hz_norm = Fz_at_f(poles_hz, zeros_hz, [norm_freq], fs)
    dB = 20 * np.log10(np.abs(Hz) + 1e-30)
    dB -= 20 * np.log10(np.abs(Hz_norm[0]) + 1e-30)
    return dB


def ptp_error(poles_hz, zeros_hz, fs):
    """Peak-to-peak error vs Table 1 (Wurcer's metric)."""
    resp = response_dB_normalized(poles_hz, zeros_hz, T1_FREQS, fs)
    return np.ptp(T1_LEVELS - resp)


def minimax_error(poles_hz, zeros_hz, fs):
    """Minimax error with optimal gain offset."""
    from scipy.optimize import minimize_scalar
    Hz = Fz_at_f(poles_hz, zeros_hz, T1_FREQS, fs)
    resp_dB = 20 * np.log10(np.abs(Hz) + 1e-30)
    def err_fn(offset):
        return np.max(np.abs(T1_LEVELS - (resp_dB - offset)))
    result = minimize_scalar(err_fn)
    return result.fun


# =============================================================================
# Topology A: 3 DC zeros + 4 real poles
# =============================================================================

def optimize_topo_A(fs=FS, verbose=True):
    """3 zeros at DC + 4 real poles. 4 free parameters."""
    if verbose:
        print(f"\n{'='*65}")
        print(f"TOPOLOGY A: 3 DC zeros + 4 real poles (fs={fs:.0f})")
        print(f"{'='*65}")

    zeros_hz = [0, 0, 0]

    def cost(params):
        poles = sorted(params)
        if any(p <= 0 for p in poles) or any(p >= fs/2 for p in poles):
            return 1e10
        try:
            return ptp_error(poles, zeros_hz, fs)
        except:
            return 1e10

    # Grid: based on physical reasoning
    # 2 poles near 0.3-1 Hz (HPF transition), 1 near 3-6 Hz (peak), 1 near 5-20 Hz (LPF)
    ranges = (
        slice(0.2, 1.2, 0.1),
        slice(0.2, 1.2, 0.1),
        slice(1.5, 6.0, 0.5),
        slice(4.0, 25.0, 1.0),
    )
    if verbose: print("Grid search...")
    x0 = brute(cost, ranges, finish=None)
    if verbose: print(f"  Grid: {sorted(x0)} ptp={cost(x0):.4f} dB")

    if verbose: print("Nelder-Mead refinement...")
    result = scipy_fmin(cost, x0, disp=0, maxiter=50000, ftol=1e-12)
    poles = sorted(result)
    err = cost(result)

    if verbose:
        print(f"\nResult: poles = {[f'{p:.6f}' for p in poles]} Hz")
        print(f"  ptp = {err:.6f} dB ({err*1000:.2f} mdB)")
        mm = minimax_error(poles, zeros_hz, fs)
        print(f"  minimax = {mm:.6f} dB ({mm*1000:.2f} mdB)")

    return {'label': 'A: 3DC+4pole', 'poles': poles, 'zeros': zeros_hz,
            'ptp': err, 'fs': fs}


# =============================================================================
# Topology B: 3 DC zeros + 1 finite zero + 4 real poles (Wurcer: bring inf in)
# =============================================================================

def optimize_topo_B(fs=FS, verbose=True):
    """3 DC zeros + 1 finite zero + 4 real poles. 5 free params."""
    if verbose:
        print(f"\n{'='*65}")
        print(f"TOPOLOGY B: 3 DC zeros + 1 finite zero + 4 real poles (fs={fs:.0f})")
        print(f"  (Wurcer: 'bring infinity zeros into unit circle')")
        print(f"{'='*65}")

    def cost(params):
        # params: [p1, p2, p3, p4, z_finite]
        poles = sorted(params[:4])
        z_fin = params[4]
        if any(p <= 0 for p in poles) or any(p >= fs/2 for p in poles):
            return 1e10
        if z_fin <= 0 or z_fin >= fs/2:
            return 1e10
        zeros = [0, 0, 0, z_fin]
        try:
            return ptp_error(poles, zeros, fs)
        except:
            return 1e10

    ranges = (
        slice(0.2, 1.2, 0.1),
        slice(0.2, 1.2, 0.1),
        slice(1.5, 6.0, 0.5),
        slice(4.0, 25.0, 2.0),
        slice(10.0, 200.0, 10.0),  # finite zero
    )
    if verbose: print("Grid search...")
    x0 = brute(cost, ranges, finish=None)
    if verbose: print(f"  Grid: ptp={cost(x0):.4f} dB")

    if verbose: print("Nelder-Mead refinement...")
    result = scipy_fmin(cost, x0, disp=0, maxiter=50000, ftol=1e-12)
    poles = sorted(result[:4])
    z_fin = result[4]
    zeros = [0, 0, 0, z_fin]
    err = cost(result)

    if verbose:
        print(f"\nResult:")
        print(f"  poles = {[f'{p:.6f}' for p in poles]} Hz")
        print(f"  finite zero = {z_fin:.6f} Hz")
        print(f"  ptp = {err:.6f} dB ({err*1000:.2f} mdB)")
        mm = minimax_error(poles, zeros, fs)
        print(f"  minimax = {mm:.6f} dB ({mm*1000:.2f} mdB)")

    return {'label': 'B: 3DC+1Z+4pole', 'poles': poles, 'zeros': zeros,
            'ptp': err, 'fs': fs}


# =============================================================================
# Topology C: 3 DC zeros + 2 finite zeros + 5 real poles
# =============================================================================

def optimize_topo_C(fs=FS, verbose=True):
    """3 DC zeros + 2 finite zeros + 5 real poles. 7 free params.
    More handles = potentially better fit."""
    if verbose:
        print(f"\n{'='*65}")
        print(f"TOPOLOGY C: 3 DC zeros + 2 finite zeros + 5 real poles (fs={fs:.0f})")
        print(f"{'='*65}")

    def cost(params):
        poles = sorted(params[:5])
        z1, z2 = params[5], params[6]
        if any(p <= 0 for p in poles) or any(p >= fs/2 for p in poles):
            return 1e10
        if z1 <= 0 or z2 <= 0 or z1 >= fs/2 or z2 >= fs/2:
            return 1e10
        zeros = [0, 0, 0, z1, z2]
        try:
            return ptp_error(poles, zeros, fs)
        except:
            return 1e10

    # Coarser grid for 7D
    ranges = (
        slice(0.3, 1.0, 0.2),
        slice(0.3, 1.0, 0.2),
        slice(1.5, 5.0, 1.0),
        slice(4.0, 20.0, 4.0),
        slice(10.0, 50.0, 10.0),
        slice(15.0, 150.0, 30.0),  # finite zero 1
        slice(30.0, 300.0, 50.0),  # finite zero 2
    )
    if verbose: print("Grid search (7D, coarse)...")
    x0 = brute(cost, ranges, finish=None)
    if verbose: print(f"  Grid: ptp={cost(x0):.4f} dB")

    if verbose: print("Nelder-Mead refinement...")
    result = scipy_fmin(cost, x0, disp=0, maxiter=100000, ftol=1e-12)
    poles = sorted(result[:5])
    z1, z2 = result[5], result[6]
    zeros = [0, 0, 0, z1, z2]
    err = cost(result)

    if verbose:
        print(f"\nResult:")
        print(f"  poles = {[f'{p:.6f}' for p in poles]} Hz")
        print(f"  finite zeros = {z1:.6f}, {z2:.6f} Hz")
        print(f"  ptp = {err:.6f} dB ({err*1000:.2f} mdB)")
        mm = minimax_error(poles, zeros, fs)
        print(f"  minimax = {mm:.6f} dB ({mm*1000:.2f} mdB)")

    return {'label': 'C: 3DC+2Z+5pole', 'poles': poles, 'zeros': zeros,
            'ptp': err, 'fs': fs}


# =============================================================================
# Topology D: 2 DC zeros + 3 real poles (minimum order)
# =============================================================================

def optimize_topo_D(fs=FS, verbose=True):
    """2 DC zeros + 3 real poles. Minimum viable: 12 dB/oct rise, ~6 dB/oct fall."""
    if verbose:
        print(f"\n{'='*65}")
        print(f"TOPOLOGY D: 2 DC zeros + 3 real poles (fs={fs:.0f})")
        print(f"{'='*65}")

    zeros_hz = [0, 0]

    def cost(params):
        poles = sorted(params)
        if any(p <= 0 for p in poles) or any(p >= fs/2 for p in poles):
            return 1e10
        try:
            return ptp_error(poles, zeros_hz, fs)
        except:
            return 1e10

    ranges = (
        slice(0.2, 2.0, 0.1),
        slice(1.0, 8.0, 0.5),
        slice(4.0, 30.0, 1.0),
    )
    if verbose: print("Grid search...")
    x0 = brute(cost, ranges, finish=None)
    if verbose: print(f"  Grid: ptp={cost(x0):.4f} dB")

    if verbose: print("Nelder-Mead refinement...")
    result = scipy_fmin(cost, x0, disp=0, maxiter=50000, ftol=1e-12)
    poles = sorted(result)
    err = cost(result)

    if verbose:
        print(f"\nResult: poles = {[f'{p:.6f}' for p in poles]} Hz")
        print(f"  ptp = {err:.6f} dB ({err*1000:.2f} mdB)")

    return {'label': 'D: 2DC+3pole', 'poles': poles, 'zeros': zeros_hz,
            'ptp': err, 'fs': fs}


# =============================================================================
# Topology E: 2 DC zeros + 1 finite zero + 4 real poles
# =============================================================================

def optimize_topo_E(fs=FS, verbose=True):
    """2 DC zeros + 1 finite zero + 4 poles. 5 free params."""
    if verbose:
        print(f"\n{'='*65}")
        print(f"TOPOLOGY E: 2 DC zeros + 1 finite zero + 4 real poles (fs={fs:.0f})")
        print(f"{'='*65}")

    def cost(params):
        poles = sorted(params[:4])
        z_fin = params[4]
        if any(p <= 0 for p in poles) or any(p >= fs/2 for p in poles):
            return 1e10
        if z_fin <= 0 or z_fin >= fs/2:
            return 1e10
        zeros = [0, 0, z_fin]
        try:
            return ptp_error(poles, zeros, fs)
        except:
            return 1e10

    ranges = (
        slice(0.2, 1.5, 0.1),
        slice(0.5, 3.0, 0.3),
        slice(2.0, 10.0, 1.0),
        slice(5.0, 30.0, 2.0),
        slice(10.0, 200.0, 10.0),
    )
    if verbose: print("Grid search...")
    x0 = brute(cost, ranges, finish=None)
    if verbose: print(f"  Grid: ptp={cost(x0):.4f} dB")

    if verbose: print("Nelder-Mead refinement...")
    result = scipy_fmin(cost, x0, disp=0, maxiter=50000, ftol=1e-12)
    poles = sorted(result[:4])
    z_fin = result[4]
    zeros = [0, 0, z_fin]
    err = cost(result)

    if verbose:
        print(f"\nResult:")
        print(f"  poles = {[f'{p:.6f}' for p in poles]} Hz")
        print(f"  finite zero = {z_fin:.6f} Hz")
        print(f"  ptp = {err:.6f} dB ({err*1000:.2f} mdB)")

    return {'label': 'E: 2DC+1Z+4pole', 'poles': poles, 'zeros': zeros,
            'ptp': err, 'fs': fs}


# =============================================================================
# Compliance and plotting
# =============================================================================

def print_compliance(result):
    """Print compliance table for a result."""
    resp = response_dB_normalized(result['poles'], result['zeros'],
                                   T1_FREQS, result['fs'])
    label = result['label']
    print(f"\n{label} compliance vs AES6 Table 1:")
    print(f"{'Freq (Hz)':<10} {'AES6 (dB)':<11} {'Filter (dB)':<12} "
          f"{'Error (dB)':<11} {'Tol':<10} {'Pass':<5}")
    print('-' * 60)

    all_pass = True
    for i, (f, target, tol_p, tol_m) in enumerate(AES6_TABLE):
        err = resp[i] - target
        if f == 4.0:
            in_spec = abs(err) < 0.01
        else:
            in_spec = (err >= tol_m) and (err <= tol_p)
        if not in_spec:
            all_pass = False
        tol_str = f'+{tol_p}/{tol_m}' if tol_p != 0 else '0 (ref)'
        mark = 'YES' if in_spec else '** NO'
        print(f'{f:<10.3f} {target:<11.1f} {resp[i]:<12.3f} '
              f'{err:<+11.3f} {tol_str:<10} {mark}')

    ptp = np.ptp(T1_LEVELS - resp)
    print(f'\nPTP error: {ptp:.4f} dB ({ptp*1000:.1f} mdB)')
    print(f'All within tolerance: {"YES" if all_pass else "NO"}')
    return all_pass


def build_sos(result, verbose=True):
    """Convert a result to SOS form for implementation."""
    poles = result['poles']
    zeros = result['zeros']
    fs = result['fs']

    # Build analog transfer function
    # Numerator from zeros
    num_s = np.array([1.0])
    for z_hz in zeros:
        if z_hz == 0:
            num_s = np.convolve(num_s, [1, 0])  # s factor
        else:
            w = 2 * pi * z_hz
            num_s = np.convolve(num_s, [1, w])

    # Denominator from poles
    den_s = np.array([1.0])
    for p_hz in poles:
        w = 2 * pi * p_hz
        den_s = np.convolve(den_s, [1, w])

    # Bilinear transform to digital
    b, a = bilinear(num_s, den_s, fs=fs)

    # Normalize at 4 Hz
    w4 = 2 * pi * 4.0 / fs
    _, h4 = freqz(b, a, worN=[w4])
    b = b / np.abs(h4[0])

    # Convert to SOS
    z_roots, p_roots, k = tf2zpk(b, a)
    sos = zpk2sos(z_roots, p_roots, k)

    if verbose:
        print(f"\nSOS coefficients ({result['label']}):")
        print(f"sos = np.array([")
        for section in sos:
            print(f"    [{section[0]:.15e}, {section[1]:.15e}, {section[2]:.15e},")
            print(f"     {section[3]:.15e}, {section[4]:.15e}, {section[5]:.15e}],")
        print(f"])")

    result['sos'] = sos
    result['b'] = b
    result['a'] = a
    return result


def plot_all(results, filename='aes6_wurcer_optimization.png'):
    """Plot all topologies."""
    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    fig.suptitle('AES6-2008 Weighting Filter — Wurcer-Style Optimization', fontsize=13)

    f_plot = np.logspace(np.log10(0.05), np.log10(300), 2000)
    colors = ['blue', 'green', 'red', 'purple', 'orange']

    # Magnitude
    ax = axes[0, 0]
    for i, r in enumerate(results):
        resp = response_dB_normalized(r['poles'], r['zeros'], f_plot, r['fs'])
        ax.semilogx(f_plot, resp, color=colors[i % len(colors)],
                     linewidth=1.5, label=f"{r['label']} ({r['ptp']:.2f} dB)")
    ax.scatter(T1_FREQS, T1_LEVELS, color='red', s=50, zorder=5, label='Table 1')
    for f, lev, tp, tm in AES6_TABLE:
        if tp == 0: continue
        ax.plot([f, f], [lev + tm, lev + tp], 'r-', linewidth=1, alpha=0.3)
    ax.set_xlim(0.05, 300); ax.set_ylim(-55, 10)
    ax.set_xlabel('Frequency (Hz)'); ax.set_ylabel('Level (dB)')
    ax.set_title('Magnitude Response'); ax.legend(fontsize=7, loc='lower left')
    ax.grid(True, which='both', alpha=0.3)

    # Error
    ax = axes[0, 1]
    for i, r in enumerate(results):
        resp = response_dB_normalized(r['poles'], r['zeros'], T1_FREQS, r['fs'])
        ax.semilogx(T1_FREQS, resp - T1_LEVELS, 'o-', color=colors[i % len(colors)],
                     markersize=4, linewidth=1.5, label=r['label'])
    # Tolerance envelope
    ax.fill_between(T1_FREQS, T1_TOL_M, T1_TOL_P, alpha=0.1, color='red',
                     label='Tolerance')
    ax.axhline(0, color='k', linewidth=0.5)
    ax.set_xlim(0.05, 300)
    ax.set_xlabel('Frequency (Hz)'); ax.set_ylabel('Error (dB)')
    ax.set_title('Error vs Table 1 (with tolerance bands)'); ax.legend(fontsize=7)
    ax.grid(True, which='both', alpha=0.3)

    # Phase comparison (z-domain vs analog)
    ax = axes[1, 0]
    for i, r in enumerate(results):
        Hz = Fz_at_f(r['poles'], r['zeros'], f_plot, r['fs'])
        phase = np.angle(Hz, deg=True)
        ax.semilogx(f_plot, phase, color=colors[i % len(colors)],
                     linewidth=1.5, label=f"{r['label']} (z)")
    # Also plot analog for best result
    best = min(results, key=lambda r: r['ptp'])
    Hs = Fs_at_f(best['poles'], best['zeros'], f_plot)
    ax.semilogx(f_plot, np.angle(Hs, deg=True), 'k--', linewidth=1,
                 label=f"{best['label']} (analog)", alpha=0.5)
    ax.set_xlim(0.05, 300)
    ax.set_xlabel('Frequency (Hz)'); ax.set_ylabel('Phase (degrees)')
    ax.set_title('Phase Response'); ax.legend(fontsize=7)
    ax.grid(True, which='both', alpha=0.3)

    # Phase difference (z vs analog) for best
    ax = axes[1, 1]
    for i, r in enumerate(results):
        Hz = Fz_at_f(r['poles'], r['zeros'], f_plot, r['fs'])
        Hs = Fs_at_f(r['poles'], r['zeros'], f_plot)
        phase_diff = np.angle(Hz, deg=True) - np.angle(Hs, deg=True)
        # Unwrap
        phase_diff = np.where(phase_diff > 180, phase_diff - 360, phase_diff)
        phase_diff = np.where(phase_diff < -180, phase_diff + 360, phase_diff)
        ax.semilogx(f_plot, phase_diff, color=colors[i % len(colors)],
                     linewidth=1.5, label=r['label'])
    ax.set_xlim(0.1, 200)
    ax.set_xlabel('Frequency (Hz)'); ax.set_ylabel('Phase diff (degrees)')
    ax.set_title('Phase: z-domain minus analog'); ax.legend(fontsize=7)
    ax.grid(True, which='both', alpha=0.3)

    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight')
    print(f"\nPlot saved: {filename}")


# =============================================================================
# Main
# =============================================================================

if __name__ == '__main__':
    print("AES6-2008 Weighting Filter — Wurcer-Style Optimizer")
    print("=" * 65)
    print(f"Target fs: {FS:.0f} Hz")
    print(f"Metric: peak-to-peak error vs Table 1 (17 points)")
    print(f"Method: brute grid + Nelder-Mead (per Wurcer)")
    print()

    results = []

    # Run all topologies
    results.append(optimize_topo_D(FS))   # simplest
    results.append(optimize_topo_A(FS))   # 3DC + 4 poles
    results.append(optimize_topo_E(FS))   # 2DC + 1Z + 4 poles
    results.append(optimize_topo_B(FS))   # 3DC + 1Z + 4 poles (Wurcer approach)
    results.append(optimize_topo_C(FS))   # most complex

    # Summary
    print(f"\n{'='*65}")
    print("SUMMARY — ALL TOPOLOGIES")
    print(f"{'='*65}")
    results.sort(key=lambda r: r['ptp'])
    print(f"\n{'Rank':<5} {'Topology':<25} {'PTP (dB)':<12} {'PTP (mdB)':<12}")
    print('-' * 55)
    for i, r in enumerate(results):
        print(f"{i+1:<5} {r['label']:<25} {r['ptp']:<12.6f} {r['ptp']*1000:<12.2f}")

    # Detailed compliance for top 3
    for r in results[:3]:
        print_compliance(r)

    # Build SOS for the best
    best = results[0]
    best = build_sos(best)

    # Phase check
    print(f"\nPhase comparison for best ({best['label']}):")
    f_phase = np.array([0.5, 1.0, 2.0, 4.0, 6.3, 10.0, 20.0, 50.0, 100.0])
    Hz = Fz_at_f(best['poles'], best['zeros'], f_phase, best['fs'])
    Hs = Fs_at_f(best['poles'], best['zeros'], f_phase)
    print(f"{'Freq (Hz)':<10} {'z-phase (°)':<14} {'s-phase (°)':<14} {'Δ (°)':<10}")
    for j, f in enumerate(f_phase):
        pz = np.angle(Hz[j], deg=True)
        ps = np.angle(Hs[j], deg=True)
        print(f"{f:<10.1f} {pz:<+14.2f} {ps:<+14.2f} {pz-ps:<+10.2f}")

    # Plot
    plot_all(results)
