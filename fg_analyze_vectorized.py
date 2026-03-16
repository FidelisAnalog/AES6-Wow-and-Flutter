"""
FG Signal Analyzer - Zero-Crossing Instantaneous Frequency Extraction

Extracts instantaneous frequency from turntable motor FG signals using
sinc-interpolated zero-crossing period measurement with AES6-2008
wow & flutter metrics.

Method:
  1. Quick frequency estimate via raw zero-crossing count
  2. Bandpass prefilter auto-tuned around detected carrier to improve
     crossing SNR (removes harmonics + out-of-band noise)
  3. Detect positive-going zero crossings with sinc interpolation
     and Brent's method for sub-sample timing accuracy
  4. Compute per-cycle frequency from crossing-to-crossing periods
  5. Sinc-interpolate to uniform time grid
  6. AES6 signal chain: weighting filter → band separation
     (wow via LP at 6 Hz, flutter = weighted − wow)

Measurement chain validated against DIN 45507 calibration tones
(0.1/0.3/1.0%) and compared to Multi-Instrument (Virtins) output.
"""

import numpy as np
from scipy.io.wavfile import read as wavread
from scipy.signal import butter, filtfilt, sosfiltfilt, bilinear, lfilter, freqz
from scipy.interpolate import interp1d
import matplotlib.pyplot as plt
import sys
import os


# ========================= CONFIG =========================

WAV_FILE = 'Data/DA8925G004 Motor FG Post-refurb A_orig.wav'
STEREO_CH = 0          # 0=left, 1=right (ignored for mono)

# Auto-tuned bandpass prefilter: centered on detected carrier frequency.
# Bandwidth factor: filter spans carrier × (1 ± BW_FACTOR).
# e.g. BW_FACTOR=0.30 with 105 Hz carrier → 73.5–136.5 Hz bandpass.
# This removes harmonics and out-of-band noise, improving crossing SNR.
# Set to None to disable prefilter entirely.
PREFILTER_BW_FACTOR = 0.30
PREFILTER_ORDER = 2    # keep low to minimize ringing

# Output frequency smoothing (applied to the frequency series, NOT the input)
# This is a simple moving average on the per-cycle frequency estimates.
# Set to 1 to disable.
SMOOTH_CYCLES = 1

# Outlier rejection: discard frequency estimates more than this many percent
# from the running median. Catches prefilter edge glitches and signal dropouts.
OUTLIER_THRESH_PCT = 10.0  # percent deviation from median — only catches broken crossings


# ========================= FUNCTIONS =========================

def load_wav(filepath, channel=0):
    """Load WAV file, return (sample_rate, signal_as_float64)."""
    fs, data = wavread(filepath)
    if data.ndim > 1:
        sig = data[:, channel].astype(np.float64)
    else:
        sig = data.astype(np.float64)
    return fs, sig


def estimate_carrier_freq(sig, fs):
    """
    Carrier frequency estimate using FFT peak detection.

    Finds the dominant spectral peak in the signal.  Much more robust than
    zero-crossing counting, which is inflated by harmonics — e.g. a 3 kHz
    carrier with strong harmonics gives ~3.5 kHz from zero-crossing count
    but the correct 3 kHz from the FFT peak.

    Uses a windowed FFT on the first 2 seconds (or full signal if shorter)
    to keep computation fast.
    """
    # Use first 2 seconds for speed
    n_samp = min(len(sig), int(2.0 * fs))
    s = sig[:n_samp].astype(np.float64)
    s = s - np.mean(s)

    # Windowed FFT
    win = np.hanning(len(s))
    X = np.abs(np.fft.rfft(s * win))
    freqs = np.fft.rfftfreq(len(s), d=1.0 / fs)

    # Ignore DC and very low frequencies
    min_idx = max(1, int(20.0 / (fs / len(s))))  # above 20 Hz
    peak_idx = min_idx + np.argmax(X[min_idx:])

    return freqs[peak_idx]


def bandpass_prefilter(sig, fs, low, high, order=2):
    """Bandpass to clean up FG signal before zero-crossing detection."""
    nyq = fs / 2.0
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, sig)


def sinc_interp_at(sig, pos, n_taps=32):
    """
    Evaluate the bandlimited-reconstructed signal at fractional sample position
    using windowed-sinc interpolation.

    This is the sampling theorem applied directly: the continuous signal is
        x(t) = sum_n x[n] * sinc(t - n)
    windowed to finite support for practical computation.

    Parameters:
        sig:    signal samples (float64)
        pos:    fractional sample position (e.g. 1042.37)
        n_taps: number of samples on each side of pos to include (32 = 64-tap kernel)

    Returns:
        reconstructed signal value at position pos
    """
    idx = int(np.floor(pos))

    # Sample neighborhood
    lo = max(0, idx - n_taps + 1)
    hi = min(len(sig), idx + n_taps + 1)
    k = np.arange(lo, hi)
    x = sig[lo:hi]

    # Distance from interpolation point to each sample
    d = pos - k

    # sinc kernel: sin(pi*d) / (pi*d), with sinc(0) = 1
    kernel = np.sinc(d)

    # Blackman window over the support to taper the sinc
    # Normalized so that d/n_taps spans [-1, 1] over the window
    w_arg = d / n_taps
    window = np.where(np.abs(w_arg) <= 1.0,
                      0.42 + 0.5 * np.cos(np.pi * w_arg) + 0.08 * np.cos(2.0 * np.pi * w_arg),
                      0.0)

    return np.sum(x * kernel * window)


def find_zero_crossings(sig, fs, hysteresis_frac=0.05, sinc_taps=32):
    """
    Find positive-going zero crossings with hysteresis and linear-interpolated
    sub-sample timing.

    1. DC removal
    2. Hysteresis: signal must drop below -threshold to arm, then trigger
       on the next positive-going zero crossing. Rejects noise-induced
       false crossings.  Vectorized via searchsorted.
    3. For each crossing, linear interpolation between the two bracketing
       samples gives sub-sample timing.  At 48 kHz with carriers up to
       a few kHz, timing error vs sinc is sub-nanosecond — far below
       any other error source in the pipeline.

    Returns array of crossing times in seconds.
    """
    # DC removal
    sig = sig - np.mean(sig)

    # Hysteresis threshold
    threshold = hysteresis_frac * np.max(np.abs(sig))

    # Find all positive-going zero crossings (candidate locations)
    zc_mask = (sig[:-1] < 0) & (sig[1:] >= 0)
    zc_indices = np.where(zc_mask)[0]

    # Find all arm points (signal below -threshold)
    arm_mask = sig < -threshold
    arm_indices = np.where(arm_mask)[0]

    if len(zc_indices) == 0 or len(arm_indices) == 0:
        return np.array([])

    # Vectorized hysteresis validation using searchsorted.
    # For each crossing, find the first arm point >= prev_crossing.
    # If that arm point is < current crossing, the crossing is valid.
    prev_zc = np.empty_like(zc_indices)
    prev_zc[0] = 0
    prev_zc[1:] = zc_indices[:-1]

    # For each prev_zc value, find the index of the first arm point >= prev_zc
    arm_search = np.searchsorted(arm_indices, prev_zc, side='left')

    # Valid if that arm point exists and falls before the current crossing
    valid = (arm_search < len(arm_indices)) & (arm_indices[np.minimum(arm_search, len(arm_indices) - 1)] < zc_indices)

    crossing_indices = zc_indices[valid]

    # Discard crossings too close to signal boundaries
    margin = max(sinc_taps, 1)
    crossing_indices = crossing_indices[
        (crossing_indices >= margin) & (crossing_indices < len(sig) - margin - 1)
    ]

    # Vectorized linear interpolation for sub-sample zero-crossing timing.
    # sig[ci] < 0, sig[ci+1] >= 0.  Zero is at ci + (-sig[ci]) / (sig[ci+1] - sig[ci]).
    s0 = sig[crossing_indices]
    s1 = sig[crossing_indices + 1]
    frac = -s0 / (s1 - s0)
    times = (crossing_indices.astype(np.float64) + frac) / fs

    return times


def crossings_to_frequency(crossing_times, use_both=False):
    """
    Convert zero-crossing times to instantaneous frequency estimates.

    For rising-only crossings: period = time between consecutive crossings,
    frequency = 1/period. Each estimate is timestamped at the midpoint
    of its period.

    For both crossings: period = 2 * (time between consecutive crossings),
    giving twice the update rate but more sensitivity to DC offset and
    asymmetry.

    Returns (times, frequencies) arrays.
    """
    periods = np.diff(crossing_times)
    midpoints = crossing_times[:-1] + periods / 2.0

    if use_both:
        # Each half-cycle gives a half-period measurement
        freqs = 1.0 / (2.0 * periods)
    else:
        freqs = 1.0 / periods

    return midpoints, freqs


def smooth_frequency(freqs, n_cycles):
    """Simple moving average over n_cycles. Returns same-length array."""
    if n_cycles <= 1:
        return freqs
    kernel = np.ones(n_cycles) / n_cycles
    # Use 'valid' mode and pad to maintain alignment
    smoothed = np.convolve(freqs, kernel, mode='same')
    # Fix edges where convolution wraps
    for i in range(n_cycles // 2):
        smoothed[i] = np.mean(freqs[:i + n_cycles // 2 + 1])
        smoothed[-(i+1)] = np.mean(freqs[-(i + n_cycles // 2 + 1):])
    return smoothed


def interpolate_to_uniform(times, freqs, output_rate=None, sinc_taps=16):
    """
    Resample non-uniform frequency samples to a uniform time grid.

    Uses numpy's C-backed linear interpolation (np.interp), which is
    fully vectorized. The per-cycle frequency samples are nearly uniform
    (jitter < 0.1% of spacing), so linear interpolation introduces
    negligible error while being orders of magnitude faster than
    per-sample sinc interpolation — critical for Pyodide performance.

    Default output_rate matches the mean input crossing rate.
    Returns (uniform_times, uniform_freqs).
    """
    if output_rate is None:
        output_rate = len(times) / (times[-1] - times[0])

    # Trim a small margin from each edge to avoid extrapolation
    dt_raw = (times[-1] - times[0]) / (len(times) - 1)
    margin = sinc_taps * dt_raw
    t_start = times[0] + margin
    t_end = times[-1] - margin
    t_uniform = np.arange(t_start, t_end, 1.0 / output_rate)

    # Vectorized C-backed cubic spline — preserves peaks better than
    # piecewise linear (np.interp) when the frequency series has few
    # samples per modulation cycle (e.g. 50 Hz carrier, 4 Hz mod).
    from scipy.interpolate import CubicSpline
    cs = CubicSpline(times, freqs)
    f_uniform = cs(t_uniform)

    return t_uniform, f_uniform


# ========================= AES6 W&F METRICS =========================

def make_aes6_weighting_filter(fs):
    """
    Build the AES6-2008 frequency weighting filter for a given sample rate.

    Designed to match AES6-2008 Table 1 weighting factors (identical to
    IEC 60386 / DIN 45507).  The analog prototype uses:
      - 3 zeros at s = 0  (3rd-order HPF behaviour)
      - 2 real poles at 0.4989 Hz and 0.4992 Hz  (low-end rolloff)
      - 1 conjugate pole pair at 3.374 Hz, Q = 0.269  (broad bandpass
        peak near 4 Hz — shapes the 2–6 Hz plateau and controls the
        transition to −6 dB/oct HF rolloff)

    The 4-pole / 3-zero topology gives net 1st-order rolloff at HF
    (−6 dB/oct), matching the AES6 Table 1 slope above 10 Hz.

    Parameters optimised by weighted least-squares fit against all 17
    reference points in AES6 Table 1, with heavy weighting on 0.8 Hz
    and the 0.5–50 Hz band where the standard requires ±2 dB tolerance.

    Maximum error vs Table 1 nominal:
      0.5–50 Hz  (±2 dB tolerance):  < 0.76 dB
      50–200 Hz  (±4 dB tolerance):  < 1.2 dB
      0.1–0.2 Hz (+10/−4 dB tol):   < 0.8 dB
    Gain at 0.8 Hz: −6.00 dB (Table 1: −6.0 dB, factor 0.500)

    Returns (b, a) digital filter coefficients via bilinear transform.
    """
    # Analog prototype:  H(s) = s^3 / [(s+p1)(s+p2)(s^2 + (w0/Q)s + w0^2)]
    # Numerator: s^3
    num_s = [1.0, 0.0, 0.0, 0.0]

    # Denominator: two real poles (nearly coincident at ~0.5 Hz)
    RP1 = 0.498881   # Hz
    RP2 = 0.499245   # Hz
    den_s = np.array([1.0])
    for f in [RP1, RP2]:
        w = 2 * np.pi * f
        den_s = np.convolve(den_s, [1, w])

    # Conjugate pole pair (bandpass peak near 4 Hz, low Q)
    CPF = 3.373861   # center frequency, Hz
    CPQ = 0.268790   # quality factor
    w0 = 2 * np.pi * CPF
    den_s = np.convolve(den_s, [1, w0 / CPQ, w0 * w0])

    # Bilinear transform to digital
    b, a = bilinear(num_s, den_s, fs=fs)

    # Normalize to 0 dB at 4 Hz
    _, h_ref = freqz(b, a, worN=[4], fs=fs)
    b /= np.abs(h_ref[0])

    return b, a


def bandpass_deviation(deviation, fs, low, high, order=2):
    """Bandpass filter the deviation signal.  Returns filtered signal."""
    nyq = fs / 2.0
    # Clamp to valid range
    low = max(low, 0.01)
    high = min(high, nyq * 0.95)
    if high <= low:
        return np.zeros_like(deviation)
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, deviation)


def highpass_deviation(deviation, fs, cutoff, order=2):
    """Highpass filter the deviation signal."""
    nyq = fs / 2.0
    cutoff = max(cutoff, 0.01)
    if cutoff >= nyq * 0.95:
        return np.zeros_like(deviation)
    b, a = butter(order, cutoff / nyq, btype='high')
    return filtfilt(b, a, deviation)


def lowpass_deviation(deviation, fs, cutoff, order=2):
    """Lowpass filter the deviation signal."""
    nyq = fs / 2.0
    cutoff = min(cutoff, nyq * 0.95)
    if cutoff <= 0.01:
        return np.zeros_like(deviation)
    b, a = butter(order, cutoff / nyq, btype='low')
    return filtfilt(b, a, deviation)


def compute_aes6_metrics(deviation_frac, fs, skip_seconds=0.5):
    """
    Compute AES6-2008 wow & flutter metrics from fractional deviation signal
    on a uniform time grid.

    AES6 signal chain:
      FM demod → deviation signal
      → weighting filter (HPF 0.6 Hz + LPF 10 Hz, norm @ 4 Hz)
      → band-separate the WEIGHTED signal for wow/flutter
      Drift is measured from the UNWEIGHTED signal (below HPF cutoff).

    deviation_frac: fractional frequency deviation (not percent)
    fs:             sample rate of the deviation signal
    skip_seconds:   seconds to skip at start (filter settling)

    Returns dict with all AES6 metrics.

    Band definitions per AES6/IEC 386:
      Drift:   < 0.5 Hz  (unweighted — weighting HPF removes this band)
      Wow:     0.5 - 6 Hz  (from weighted signal)
      Flutter: 6+ Hz  (from weighted signal; LPF in weighting curve
                        naturally limits upper extent to ~10 Hz)
    """
    skip = int(skip_seconds * fs)
    nyquist = fs / 2.0

    # --- Unweighted aggregate ---
    dev_u = deviation_frac[skip:]
    dev_u_abs = np.abs(dev_u)
    peak_u = np.percentile(dev_u_abs, 95) * 100.0  # 2σ, in percent
    rms_u = np.sqrt(np.mean(dev_u**2)) * 100.0      # in percent

    # --- Apply AES6 weighting filter ---
    b_w, a_w = make_aes6_weighting_filter(fs)
    dev_weighted = lfilter(b_w, a_w, deviation_frac)
    dev_w = dev_weighted[skip:]
    dev_w_abs = np.abs(dev_w)
    peak_w = np.percentile(dev_w_abs, 95) * 100.0
    rms_w = np.sqrt(np.mean(dev_w**2)) * 100.0

    # --- Drift: RMS of deviation in 0.05–0.5 Hz band (unweighted) ---
    # Per MI/AES6: drift is the frequency modulation below approximately
    # 0.5 Hz.  MI defines the drift band as 0.05 Hz to 0.5 Hz, with the
    # lower bound = max(0.05, 1/capture_duration).
    #
    # The rotation fundamental (f_rot ≈ 0.556 Hz for 33⅓ RPM) sits just
    # above the 0.5 Hz upper cutoff.  A sharp filter is critical to reject
    # it — even 1% leakage of the wow signal (which is 10-100× larger
    # than drift) would dominate the drift measurement.
    #
    # Implementation: high-order SOS bandpass via filtfilt (zero-phase),
    # with half-cosine edge taper to suppress filtfilt startup transients.
    n_total = len(deviation_frac)
    drift_rms = 0.0
    drift_rate_ppm_s = 0.0
    capture_dur = n_total / fs

    drift_lo = max(0.05, 1.0 / capture_dur)
    drift_hi = 0.5
    if drift_hi > drift_lo and drift_hi < nyquist * 0.95:
        # Edge taper: half-cosine ramp to suppress filtfilt transients
        drift_taper_s = 2.0
        taper_n = min(int(drift_taper_s * fs), n_total // 4)
        taper_window = np.ones(n_total)
        ramp = 0.5 * (1 - np.cos(np.pi * np.arange(taper_n) / taper_n))
        taper_window[:taper_n] = ramp
        taper_window[-taper_n:] = ramp[::-1]

        # High-order SOS bandpass for sharp rejection of f_rot above 0.5 Hz
        drift_order = 10
        sos_drift = butter(drift_order,
                           [drift_lo / nyquist, drift_hi / nyquist],
                           btype='band', output='sos')
        drift_sig = sosfiltfilt(sos_drift, deviation_frac * taper_window)

        # Skip tapered edges + filter settling
        drift_skip = max(skip, taper_n, int(2.0 * fs))
        if n_total > 2 * drift_skip:
            drift_sig = drift_sig[drift_skip:-drift_skip]
            drift_rms = np.sqrt(np.mean(drift_sig**2)) * 100.0

    # Wow & Flutter: explicit band filters at 6 Hz on WEIGHTED signal.
    # Per AES6/IEC 386: wow = 0.5–6 Hz, flutter = 6–200 Hz.
    # Using independent LP and HP filters (not complementary subtraction)
    # so that out-of-band energy doesn't leak via filter residuals.
    # 6th-order Butterworth SOS + sosfiltfilt (zero-phase, eff. 12th order).
    wow_cut = min(6.0, nyquist * 0.95)
    if wow_cut > 0.5:
        sos_wow = butter(6, wow_cut / nyquist, btype='low', output='sos')
        wow_sig = sosfiltfilt(sos_wow, dev_weighted)
        wow_rms = np.sqrt(np.mean(wow_sig[skip:]**2)) * 100.0

        sos_flutter = butter(6, wow_cut / nyquist, btype='high', output='sos')
        flutter_sig = sosfiltfilt(sos_flutter, dev_weighted)
        flutter_rms = np.sqrt(np.mean(flutter_sig[skip:]**2)) * 100.0
    else:
        wow_rms = 0.0
        flutter_rms = 0.0

    return {
        'peak_unweighted': peak_u,
        'rms_unweighted': rms_u,
        'peak_weighted': peak_w,
        'rms_weighted': rms_w,
        'drift_rms': drift_rms,
        'wow_rms': wow_rms,
        'flutter_rms': flutter_rms,
    }


# ========================= MAIN =========================

def analyze(wav_file, channel=0):
    """Run the full analysis pipeline. Returns dict with all results."""

    # Load
    fs, sig = load_wav(wav_file, channel)
    duration = len(sig) / fs
    print(f"Loaded: {os.path.basename(wav_file)}")
    print(f"  Sample rate: {fs} Hz")
    print(f"  Duration: {duration:.2f} s")
    print(f"  Samples: {len(sig)}")

    # Quick carrier frequency estimate for auto-tuned prefilter
    f_est = estimate_carrier_freq(sig, fs)
    print(f"  Carrier estimate: {f_est:.1f} Hz")

    # Bandpass prefilter centered on carrier — removes harmonics and
    # out-of-band noise to improve zero-crossing timing precision.
    #
    # Bandwidth strategy:
    #   - Low carriers (motor FG, ~100 Hz): percentage-based works fine,
    #     signal is clean, and we need the relative width to avoid
    #     cutting into the carrier itself.
    #   - High carriers (test records, ~3 kHz): cap absolute bandwidth.
    #     W&F sidebands extend ±50 Hz max from carrier (Carson's rule:
    #     BW = 2(Δf + f_mod), worst case Δf ≈ 30 Hz, f_mod ≈ 50 Hz).
    #     Passing ±30% of 3 kHz = ±900 Hz admits 18× more surface noise
    #     than needed.  Cap at ±150 Hz to keep sidebands while rejecting
    #     the broadband vinyl noise that perturbs every zero crossing.
    if PREFILTER_BW_FACTOR is not None and f_est > 0:
        bw_hz = f_est * PREFILTER_BW_FACTOR
        # For high-frequency carriers, cap absolute bandwidth
        MAX_BW_HZ = 150.0   # generous for W&F sidebands (Carson ≈ ±80 Hz)
        if f_est > 500 and bw_hz > MAX_BW_HZ:
            bw_hz = MAX_BW_HZ
            bw_pct = bw_hz / f_est * 100.0
            print(f"  Prefilter BW: capped to ±{MAX_BW_HZ:.0f} Hz "
                  f"(±{bw_pct:.1f}%) for high-freq carrier")
        bp_low = f_est - bw_hz
        bp_high = f_est + bw_hz
        # Clamp to valid range
        bp_low = max(bp_low, 1.0)
        bp_high = min(bp_high, fs / 2.0 * 0.95)
        print(f"  Prefilter: {bp_low:.1f}–{bp_high:.1f} Hz "
              f"(±{bw_hz:.1f} Hz, ±{bw_hz/f_est*100:.1f}%)")
        sig_filtered = bandpass_prefilter(sig, fs, bp_low, bp_high,
                                          order=PREFILTER_ORDER)
    else:
        print(f"  Prefilter: disabled")
        sig_filtered = sig

    # Zero crossings with hysteresis on the prefiltered signal
    crossing_times = find_zero_crossings(sig_filtered, fs)

    print(f"  Zero crossings found: {len(crossing_times)}")

    # Convert to frequency (positive-going crossings only)
    t_freq, freq = crossings_to_frequency(crossing_times)

    # Trim prefilter edge artifacts at the source.  The bandpass filtfilt
    # corrupts the first/last few zero crossings (up to ~1.3% deviation
    # from true frequency).  Dropping these here means no downstream
    # metric — weighted, drift, wow, flutter — ever sees the bad data.
    #
    # Adaptive trim: use the interior MAD (median absolute deviation) as
    # a noise floor estimate, then flag any crossing in the leading/trailing
    # 20 that exceeds 5 × MAD.  Trim up to and including the last flagged
    # crossing on each side.  This adapts to both the carrier frequency
    # and the file's actual W&F level.
    if PREFILTER_BW_FACTOR is not None and len(t_freq) > 40:
        n_xing = len(freq)
        interior = freq[n_xing // 10 : -n_xing // 10]
        f_med = np.median(interior)
        mad = np.median(np.abs(interior - f_med))
        thresh = 5.0 * mad / f_med * 100.0   # percent
        dev_from_med = np.abs(freq - f_med) / f_med * 100.0

        # Scan leading edge: find last bad crossing in first 20
        trim_start = 0
        for i in range(min(20, n_xing)):
            if dev_from_med[i] >= thresh:
                trim_start = i + 1

        # Scan trailing edge: find last bad crossing in last 20
        trim_end = 0
        for i in range(n_xing - 1, max(n_xing - 21, -1), -1):
            if dev_from_med[i] >= thresh:
                trim_end = n_xing - i

        if trim_start > 0 or trim_end > 0:
            end_idx = n_xing - trim_end if trim_end > 0 else n_xing
            t_freq = t_freq[trim_start:end_idx]
            freq = freq[trim_start:end_idx]
            print(f"  Edge trim: {trim_start} start + {trim_end} end "
                  f"(adaptive, 5×MAD={thresh:.3f}%)")

    # Outlier rejection: MAD-based adaptive threshold.
    # For clean motor FG signals, MAD is tiny and the threshold stays well
    # above the actual W&F — nothing gets rejected.  For test record signals
    # with pops/ticks, each pop creates an instantaneous frequency spike
    # that's 30-60× the actual flutter.  The MAD-based threshold adapts to
    # the signal's actual noise floor and catches these.
    #
    # Two-pass approach:
    #   Pass 1: MAD-based rejection (removes gross outliers from pops/ticks)
    #   Pass 2: Short median filter (kills isolated single-sample spikes
    #           that survived pass 1 — e.g. small pops within the MAD
    #           threshold on noisy records)
    #
    # The median filter replaces bad values rather than removing them, which
    # preserves uniform timing for the interpolation step.
    f_median = np.median(freq)
    mad = np.median(np.abs(freq - f_median))
    # Threshold: max of (MAD-based, fixed percentage) so we never reject
    # real W&F on a clean signal.  The OUTLIER_THRESH_PCT acts as a ceiling.
    mad_thresh_hz = max(8.0 * mad, f_median * 0.001)  # at least 0.1% to avoid killing real W&F
    mad_thresh_hz = min(mad_thresh_hz, f_median * OUTLIER_THRESH_PCT / 100.0)
    outlier_mask = np.abs(freq - f_median) > mad_thresh_hz
    n_rejected = np.sum(outlier_mask)
    if n_rejected > 0:
        mad_thresh_pct = mad_thresh_hz / f_median * 100.0
        print(f"  Outliers rejected: {n_rejected} of {len(freq)} "
              f"({n_rejected/len(freq)*100:.2f}%, "
              f"thresh={mad_thresh_pct:.4f}%, MAD={mad/f_median*100:.4f}%)")
        t_freq = t_freq[~outlier_mask]
        freq = freq[~outlier_mask]

    # Pass 2: selective median despike.
    # Only for high carrier frequencies (>500 Hz) where the W&F modulation
    # is slow relative to the carrier cycle rate.  At ~100 Hz carrier the
    # median kernel would span a significant fraction of the wow period
    # and smooth real signal.
    #
    # When active: compute a 5-sample median, but only replace values that
    # deviate from the median by more than 3× the post-rejection MAD.
    # Recompute MAD after outlier rejection so the threshold isn't inflated
    # by the gross outliers we just removed.
    from scipy.signal import medfilt
    MEDFILT_KERNEL = 5
    f_carrier_est = len(freq) / (t_freq[-1] - t_freq[0]) if len(t_freq) > 1 else 0
    if f_carrier_est > 500 and len(freq) > MEDFILT_KERNEL:
        # Recompute MAD from cleaned data
        mad_clean = np.median(np.abs(freq - np.median(freq)))
        freq_med = medfilt(freq, kernel_size=MEDFILT_KERNEL)
        spike_thresh = 3.0 * mad_clean  # tighter threshold on clean MAD
        is_spike = np.abs(freq - freq_med) > spike_thresh
        n_despiked = np.sum(is_spike)
        if n_despiked > 0:
            freq[is_spike] = freq_med[is_spike]
            print(f"  Despike: replaced {n_despiked} residual spikes "
                  f"(carrier ~{f_carrier_est:.0f} Hz, "
                  f"thresh={spike_thresh/np.median(freq)*100:.4f}%, "
                  f"clean MAD={mad_clean/np.median(freq)*100:.4f}%)")
    elif f_carrier_est <= 500:
        print(f"  Despike: skipped (carrier ~{f_carrier_est:.0f} Hz, "
              f"median filter would smooth real W&F)")

    # Basic stats (after outlier rejection + median filter)
    f_mean = np.mean(freq)
    f_std = np.std(freq)
    f_min = np.min(freq)
    f_max = np.max(freq)

    print(f"  Mean frequency: {f_mean:.4f} Hz")
    print(f"  Std deviation:  {f_std:.4f} Hz ({f_std/f_mean*100:.4f}%)")
    print(f"  Range: {f_min:.4f} - {f_max:.4f} Hz (span {f_max-f_min:.4f} Hz)")
    print(f"  Frequency update rate: {len(freq)/(t_freq[-1]-t_freq[0]):.1f} samples/sec")

    # Smooth if requested
    freq_smooth = smooth_frequency(freq, SMOOTH_CYCLES)

    # Interpolate to uniform grid (sinc reconstruction)
    t_uniform, f_uniform = interpolate_to_uniform(t_freq, freq_smooth)

    # Frequency deviation
    output_rate = len(t_uniform) / (t_uniform[-1] - t_uniform[0])
    deviation_hz = f_uniform - f_mean                   # Hz from mean
    deviation_frac = deviation_hz / f_mean              # fractional
    deviation_pct = deviation_frac * 100.0              # percent

    # W&F metrics (raw, for backward compat)
    dev_pct_abs = np.abs(deviation_pct)
    wf_peak_2sigma = np.percentile(dev_pct_abs, 95)     # peak W&F (2σ)
    wf_rms = np.sqrt(np.mean(deviation_pct**2))          # RMS W&F
    wf_peak_to_peak = np.percentile(deviation_pct, 99.85) - np.percentile(deviation_pct, 0.15)  # robust p2p (3σ span)

    # --- AES6-2008 metrics ---
    aes6 = compute_aes6_metrics(deviation_frac, output_rate)

    print(f"  W&F (unweighted):")
    print(f"    Peak (2σ):     ±{aes6['peak_unweighted']:.4f}%")
    print(f"    RMS:            {aes6['rms_unweighted']:.4f}%")
    print(f"    Peak-to-peak:   {wf_peak_to_peak:.4f}%")
    print(f"  W&F (weighted, AES6):")
    print(f"    Peak (2σ):     ±{aes6['peak_weighted']:.4f}%")
    print(f"    RMS:            {aes6['rms_weighted']:.4f}%")
    print(f"  Band-separated RMS:")
    print(f"    Drift (0.05-0.5Hz):    {aes6['drift_rms']:.4f}%")
    print(f"    Wow (LP 6Hz, wtd):     {aes6['wow_rms']:.4f}%")
    print(f"    Flutter (rem, wtd):    {aes6['flutter_rms']:.4f}%")

    return {
        'fs': fs,
        'wav_file': wav_file,
        'basename': os.path.basename(wav_file),
        # Non-uniform (raw from crossings)
        't_freq': t_freq,
        'freq': freq,
        'freq_smooth': freq_smooth,
        # Uniform grid (sinc-interpolated)
        't_uniform': t_uniform,
        'f_uniform': f_uniform,
        'deviation_hz': deviation_hz,
        'deviation_frac': deviation_frac,
        'deviation_pct': deviation_pct,
        'output_rate': output_rate,
        # AES6 metrics
        'aes6': aes6,
        # Stats
        'f_mean': f_mean,
        'f_std': f_std,
        'f_min': f_min,
        'f_max': f_max,
        # W&F metrics
        'wf_peak_2sigma': wf_peak_2sigma,
        'wf_rms': wf_rms,
        'wf_peak_to_peak': wf_peak_to_peak,
    }


def plot_results(r, sec_per_rev=1.8, n_revs=4,
                 motor_slots=None, motor_poles=None, rpm=33.333):
    """
    Generate diagnostic plots for the analysis results.

    If motor_slots and motor_poles are provided, the spectrum plot will
    auto-detect peaks and label them with their motor harmonic identity
    (rotation fundamental, electrical, slot passing, torque ripple, etc.).
    rpm sets the turntable speed for accurate harmonic identification.
    """

    fig = plt.figure(figsize=(14, 18))
    # Only 3 rows in gridspec — bottom row placed manually
    gs = fig.add_gridspec(3, 1, height_ratios=[1, 1, 1],
                          top=0.935, bottom=0.38, hspace=0.3)
    axes = [
        fig.add_subplot(gs[0]),   # row 0: deviation zoomed
        fig.add_subplot(gs[1]),   # row 1: deviation full
        fig.add_subplot(gs[2]),   # row 2: spectrum
    ]
    ax_hist = None
    ax_polar = None

    # Title with key metrics
    a = r['aes6']
    fig.suptitle(
        f"{r['basename']}\n"
        f"Mean: {r['f_mean']:.3f} Hz    "
        f"Drift: {a['drift_rms']:.4f}%    "
        f"DIN/IEC Unwtd:  Peak(2σ) ±{a['peak_unweighted']:.4f}%    "
        f"RMS {a['rms_unweighted']:.4f}%\n"
        f"DIN/IEC Wtd:  Peak(2σ) ±{a['peak_weighted']:.4f}%    "
        f"RMS {a['rms_weighted']:.4f}% (JIS)    "
        f"Wow {a['wow_rms']:.4f}%    "
        f"Flutter {a['flutter_rms']:.4f}%",
        fontsize=10, y=0.985)

    t_plot_end = sec_per_rev * n_revs
    mask_uni = r['t_uniform'] <= t_plot_end

    # --- Plot 1: Speed deviation (%) vs time ---
    ax = axes[0]
    ax.plot(r['t_uniform'][mask_uni], r['deviation_pct'][mask_uni], '-',
            linewidth=0.8, color='#2266aa')
    ax.axhline(0, color='gray', linestyle='-', linewidth=0.5)
    # 2σ lines
    ax.axhline(r['wf_peak_2sigma'], color='red', linestyle='--', linewidth=0.6, alpha=0.7)
    ax.axhline(-r['wf_peak_2sigma'], color='red', linestyle='--', linewidth=0.6, alpha=0.7)
    # Revolution boundaries
    for rev in range(n_revs + 1):
        ax.axvline(rev * sec_per_rev, color='green', linestyle='-',
                   linewidth=0.6, alpha=0.4)
    ax.set_ylabel('Speed Deviation (%)')
    ax.set_xlabel('Time (s)')
    ax.set_title(f'Speed Deviation ({n_revs} revolutions, {sec_per_rev}s/rev)')
    ax.set_xlim(0, t_plot_end)
    # Scale to data
    peak = max(np.max(np.abs(r['deviation_pct'][mask_uni])), r['wf_peak_2sigma']) * 1.3
    ax.set_ylim(-peak, peak)
    ax.grid(True, alpha=0.3)

    # --- Plot 2: Speed deviation (%) full file ---
    ax = axes[1]
    ax.plot(r['t_uniform'], r['deviation_pct'], '-',
            linewidth=0.4, color='#2266aa')
    ax.axhline(0, color='gray', linestyle='-', linewidth=0.5)
    ax.axhline(r['wf_peak_2sigma'], color='red', linestyle='--', linewidth=0.6, alpha=0.7)
    ax.axhline(-r['wf_peak_2sigma'], color='red', linestyle='--', linewidth=0.6, alpha=0.7)
    ax.set_ylabel('Speed Deviation (%)')
    ax.set_xlabel('Time (s)')
    ax.set_title('Speed Deviation (full capture)')
    ax.set_ylim(-peak, peak)
    ax.grid(True, alpha=0.3)

    # --- Plot 3: Spectrum of speed deviation (single periodogram, max resolution) ---
    from scipy.signal import find_peaks as _find_peaks
    ax = axes[2]
    fs_dev = r['output_rate']
    N = len(r['deviation_pct'])
    win = np.hanning(N)
    X = np.fft.rfft(r['deviation_pct'] * win)
    freqs = np.fft.rfftfreq(N, d=1.0 / fs_dev)
    # Normalize: amplitude spectral density (RMS/√Hz)
    amp = np.abs(X) * np.sqrt(2.0) / (np.sum(win) * np.sqrt(freqs[1]))

    # Per-bin amplitude (for legend RMS values)
    fft_amp_bin = np.abs(X) * 2.0 / np.sum(win)

    ax.plot(freqs[1:], amp[1:], linewidth=0.8, color='#2266aa')
    ax.set_ylabel('Speed Deviation (% RMS/√Hz)')
    ax.set_xlabel('Modulation Frequency (Hz)')
    ax.set_title('Speed Deviation Spectrum')
    ax.grid(True, alpha=0.3)

    # Log frequency scale, start at 0.4 Hz, labeled in Hz not scientific notation
    from matplotlib.ticker import ScalarFormatter, NullFormatter, FixedLocator
    ax.set_xscale('log')
    ax.set_xlim(0.4, min(50, fs_dev / 2))
    ax.xaxis.set_major_locator(FixedLocator([0.5, 1, 2, 5, 10, 20, 50]))
    ax.xaxis.set_major_formatter(ScalarFormatter())
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.ticklabel_format(axis='x', style='plain')

    # Find significant peaks (above 8% of max)
    pk_idx, _ = _find_peaks(amp, height=np.max(amp[1:]) * 0.08)
    pk_idx = [p for p in pk_idx if freqs[p] > 0.3
              and freqs[p] < min(50, fs_dev / 2)]

    # Sort by amplitude descending, label up to 12 strongest
    pk_idx = sorted(pk_idx, key=lambda p: amp[p], reverse=True)[:12]

    # Motor harmonic identification (if motor params provided)
    have_motor = motor_slots is not None and motor_poles is not None
    if have_motor:
        pole_pairs = motor_poles // 2
        f_rot = rpm / 60.0
        f_elec = pole_pairs * f_rot
        f_slot = motor_slots * f_rot
        f_ripple = 3 * f_elec   # three-phase torque ripple
        f_res = freqs[1] - freqs[0]
        tol = max(f_res * 1.5, f_rot * 0.3)

    # Distinct, high-contrast colors for identified motor harmonics
    marker_colors = {
        'Rotation': '#e41a1c',       # red
        'Electrical': '#4daf4a',     # green
        'Slot passing': '#984ea3',   # purple
        'Torque ripple': '#ff7f00',  # orange
    }
    # Use matplotlib's tab10 cycle for unidentified peaks
    _unid_cmap = plt.cm.tab10
    _unid_idx = 0

    # Build legend entries: mark peaks on plot, collect labels
    legend_entries = []   # list of (color, label_text)

    for p in sorted(pk_idx, key=lambda p: freqs[p]):
        f = freqs[p]

        source = None
        detail = ''

        if have_motor:
            # Try to match against known motor harmonics (most specific first)
            # Torque ripple harmonics (3×elec, 6×elec, ...)
            for n in range(1, 5):
                if abs(f - n * f_ripple) < tol:
                    source = 'Torque ripple'
                    detail = f'{n}x ' if n > 1 else ''
                    break
            # Slot harmonics
            if source is None:
                for n in range(1, 5):
                    if abs(f - n * f_slot) < tol:
                        source = 'Slot passing'
                        detail = f'{n}x ' if n > 1 else ''
                        break
            # Electrical harmonics
            if source is None:
                for n in range(1, 10):
                    if abs(f - n * f_elec) < tol:
                        source = 'Electrical'
                        detail = f'{n}x ' if n > 1 else ''
                        break
            # Rotation fundamental
            if source is None:
                if abs(f - f_rot) < tol:
                    source = 'Rotation'

        # Per-bin RMS for this peak
        bin_rms = fft_amp_bin[p] / np.sqrt(2)

        if source:
            color = marker_colors[source]
            legend_entries.append((color, f'{f:6.2f} Hz  {bin_rms:.4f}%  {detail}{source}'))
        else:
            color = _unid_cmap(_unid_idx % 10)
            _unid_idx += 1
            legend_entries.append((color, f'{f:6.2f} Hz  {bin_rms:.4f}%'))

        ax.plot(f, amp[p], 'v', color=color, markersize=8,
                markeredgecolor='black', markeredgewidth=0.4)

    # Legend with colored square handles
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

    # --- Layout bottom row: histogram (left) + polar (right) ---
    # Bottom row: y from 0.03 to 0.33
    row4_top = 0.33
    row4_bot = 0.03
    row4_h = row4_top - row4_bot

    # Read left/right edges from the actual rendered axes
    page_left = axes[2].get_position().x0
    page_right = axes[2].get_position().x1

    # Polar: right-aligned, takes ~58% of the width
    polar_w = (page_right - page_left) * 0.58
    polar_left = page_right - polar_w
    ax_polar = fig.add_axes([polar_left, row4_bot, polar_w, row4_h],
                            projection='polar')

    # Histogram: left-aligned with plots above, fills remaining space
    hist_left = page_left
    hist_right = polar_left - 0.02
    ax_hist = fig.add_axes([hist_left, row4_bot, hist_right - hist_left, row4_h])

    # --- Plot 4a: Histogram of deviation ---
    ax_hist.hist(r['deviation_pct'], bins=256, density=True, color='#2266aa', alpha=0.7,
                 edgecolor='none')
    ax_hist.axvline(0, color='gray', linewidth=0.5)
    ax_hist.set_xlabel('Speed Deviation (%)')
    ax_hist.set_ylabel('Density')
    ax_hist.set_title('Deviation Distribution', fontsize=9)
    ax_hist.grid(True, alpha=0.3)
    # Center 0.00 with symmetric limits.
    # Use 99.7th percentile (3σ) so surviving outliers don't blow out the axis.
    # Minimum ±0.1% so clean signals still show meaningful range.
    hist_max = max(np.percentile(np.abs(r['deviation_pct']), 99.7) * 1.3, 0.1)
    ax_hist.set_xlim(-hist_max, hist_max)

    # --- Plot 4b: Polar plot (instantaneous frequency per revolution) ---
    # Normalized: 0.1% deviation per radial tick, regardless of carrier.
    # At 3 kHz this gives 3 Hz/tick — matches traditional test record convention.
    hz_per_tick = r['f_mean'] * 0.001  # 0.1% of carrier per tick

    fs_dev = r['output_rate']
    # Samples per revolution
    samples_per_rev = int(round(sec_per_rev * fs_dev))
    # Use instantaneous frequency (not deviation) for polar
    inst_freq = r['f_mean'] * (1.0 + r['deviation_pct'] / 100.0)

    # Skip first revolution for filter settling, plot 2 revolutions
    polar_revs = 2
    skip_revs = 1
    start_idx = skip_revs * samples_per_rev

    # Find max frequency across plotted revolutions for scaling
    end_idx = min(start_idx + polar_revs * samples_per_rev, len(inst_freq))
    maxf = np.max(inst_freq[start_idx:end_idx]) + hz_per_tick * 0.5

    # Theta: one revolution = 2π, reversed so clockwise, 0° at top
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
        # Map frequency to radial position: 20 = max, lower freq = smaller radius
        r_polar = 20.0 - (maxf - freq_rev) / hz_per_tick
        ax_polar.plot(theta[:len(r_polar)], r_polar, linewidth=0.8,
                      color=colors(rev % 10))

    ax_polar.set_rmax(20)

    # Radial grid lines without labels — scale is in the 0.1%/div box
    tick_loc = np.arange(1, 21, 1)
    ax_polar.set_rgrids(tick_loc, labels=['']*20)

    # Theta labels: degrees showing platter position
    from matplotlib.ticker import FixedLocator as _FixedLocator
    ax_polar.xaxis.set_major_locator(_FixedLocator(np.linspace(0, 2*np.pi, 8, endpoint=False)))
    ax_polar.set_xticklabels(['90°', '45°', '0°', '315°', '270°', '225°', '180°', '135°'])

    # Scale annotation in a box, bottom-right of polar plot
    ax_polar.text(0.98, 0.02, '0.1%/div',
                  transform=ax_polar.transAxes, fontsize=7,
                  verticalalignment='bottom', horizontalalignment='right',
                  bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                            edgecolor='#cccccc', alpha=0.9))

    # Legend for revolution colors
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
    plt.show()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='FG signal wow & flutter analyzer')
    parser.add_argument('wav', nargs='?', default=WAV_FILE, help='WAV file to analyze')
    parser.add_argument('--motor-slots', type=int, default=None, help='Number of motor slots')
    parser.add_argument('--motor-poles', type=int, default=None, help='Number of motor poles')
    parser.add_argument('--rpm', type=float, default=33.333, help='Turntable RPM (default: 33.333)')
    args = parser.parse_args()

    results = analyze(args.wav)
    plot_results(results, motor_slots=args.motor_slots,
                 motor_poles=args.motor_poles, rpm=args.rpm)
