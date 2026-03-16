"""
W&F Analyzer Module — AES6-2008 Wow & Flutter Analysis

Refactored from fg_analyze.py for in-browser use via PyScript/Pyodide.
Returns structured data only — no plotting, no file I/O, no CLI.

Signal processing pipeline:
  1. Carrier frequency estimation via FFT peak detection
  2. Auto-tuned bandpass prefilter centered on carrier
  3. Vectorized zero-crossing detection with hysteresis (searchsorted)
  4. Per-cycle frequency from crossing periods
  5. Adaptive edge trimming + outlier rejection + median despike
  6. CubicSpline interpolation to uniform time grid
  7. AES6-2008 weighting filter + band separation (wow/flutter/drift)
  8. Spectrum computation + peak detection
"""

import numpy as np
from scipy.signal import (butter, filtfilt, sosfiltfilt, bilinear,
                          lfilter, freqz, medfilt)
from scipy.interpolate import CubicSpline
from scipy.signal import find_peaks as _find_peaks


# ========================= INTERNAL CONSTANTS =========================
# Not exposed to the front-end.

PREFILTER_BW_FACTOR = 0.30
PREFILTER_ORDER = 2
SMOOTH_CYCLES = 1
OUTLIER_THRESH_PCT = 10.0


# ========================= STATUS CALLBACK =========================

_status_callback = None


def set_status_callback(cb):
    """Set a callback function for progress updates. cb(message: str)."""
    global _status_callback
    _status_callback = cb


def _status(msg):
    """Push a status message if callback is registered."""
    if _status_callback is not None:
        _status_callback(msg)


# ========================= SIGNAL PROCESSING =========================

def estimate_carrier_freq(sig, fs):
    """
    Carrier frequency estimate using FFT peak detection.
    Uses windowed FFT on first 2 seconds.
    """
    n_samp = min(len(sig), int(2.0 * fs))
    s = sig[:n_samp].astype(np.float64)
    s = s - np.mean(s)

    win = np.hanning(len(s))
    X = np.abs(np.fft.rfft(s * win))
    freqs = np.fft.rfftfreq(len(s), d=1.0 / fs)

    min_idx = max(1, int(20.0 / (fs / len(s))))
    peak_idx = min_idx + np.argmax(X[min_idx:])

    return freqs[peak_idx]


def bandpass_prefilter(sig, fs, low, high, order=2):
    """Bandpass to clean up signal before zero-crossing detection."""
    nyq = fs / 2.0
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, sig)



def find_zero_crossings(sig, fs, hysteresis_frac=0.05, sinc_taps=32):
    """
    Find positive-going zero crossings with hysteresis and linear-interpolated
    sub-sample timing.

    1. DC removal
    2. Hysteresis: signal must drop below -threshold to arm, then trigger
       on the next positive-going zero crossing. Vectorized via searchsorted.
    3. Vectorized linear interpolation between bracketing samples for
       sub-sample timing. At 48 kHz with carriers up to a few kHz, timing
       error vs sinc is sub-nanosecond.

    Returns array of crossing times in seconds.
    """
    sig = sig - np.mean(sig)
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

    arm_search = np.searchsorted(arm_indices, prev_zc, side='left')

    valid = ((arm_search < len(arm_indices)) &
             (arm_indices[np.minimum(arm_search, len(arm_indices) - 1)] < zc_indices))

    crossing_indices = zc_indices[valid]

    # Discard crossings too close to signal boundaries
    margin = max(sinc_taps, 1)
    crossing_indices = crossing_indices[
        (crossing_indices >= margin) &
        (crossing_indices < len(sig) - margin - 1)
    ]

    # Vectorized linear interpolation for sub-sample zero-crossing timing.
    s0 = sig[crossing_indices]
    s1 = sig[crossing_indices + 1]
    frac = -s0 / (s1 - s0)
    times = (crossing_indices.astype(np.float64) + frac) / fs

    return times


def crossings_to_frequency(crossing_times):
    """Convert zero-crossing times to instantaneous frequency estimates."""
    periods = np.diff(crossing_times)
    midpoints = crossing_times[:-1] + periods / 2.0
    freqs = 1.0 / periods
    return midpoints, freqs


def smooth_frequency(freqs, n_cycles):
    """Simple moving average over n_cycles."""
    if n_cycles <= 1:
        return freqs
    kernel = np.ones(n_cycles) / n_cycles
    smoothed = np.convolve(freqs, kernel, mode='same')
    for i in range(n_cycles // 2):
        smoothed[i] = np.mean(freqs[:i + n_cycles // 2 + 1])
        smoothed[-(i+1)] = np.mean(freqs[-(i + n_cycles // 2 + 1):])
    return smoothed


def interpolate_to_uniform(times, freqs, output_rate=None, sinc_taps=16):
    """
    Resample non-uniform frequency samples to a uniform time grid.

    Uses scipy's C-backed CubicSpline, which is fully vectorized.
    The per-cycle frequency samples are nearly uniform (jitter < 0.1%
    of spacing), so cubic interpolation introduces negligible error
    while being orders of magnitude faster than per-sample sinc
    interpolation — critical for Pyodide performance.

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
    cs = CubicSpline(times, freqs)
    f_uniform = cs(t_uniform)

    return t_uniform, f_uniform


# ========================= AES6 METRICS =========================

def make_aes6_weighting_filter(fs):
    """
    Build the AES6-2008 frequency weighting filter.
    Returns (b, a) digital filter coefficients via bilinear transform.
    """
    num_s = [1.0, 0.0, 0.0, 0.0]

    RP1 = 0.498881
    RP2 = 0.499245
    den_s = np.array([1.0])
    for f in [RP1, RP2]:
        w = 2 * np.pi * f
        den_s = np.convolve(den_s, [1, w])

    CPF = 3.373861
    CPQ = 0.268790
    w0 = 2 * np.pi * CPF
    den_s = np.convolve(den_s, [1, w0 / CPQ, w0 * w0])

    b, a = bilinear(num_s, den_s, fs=fs)

    _, h_ref = freqz(b, a, worN=[4], fs=fs)
    b /= np.abs(h_ref[0])

    return b, a


def bandpass_deviation(deviation, fs, low, high, order=2):
    """Bandpass filter the deviation signal."""
    nyq = fs / 2.0
    low = max(low, 0.01)
    high = min(high, nyq * 0.95)
    if high <= low:
        return np.zeros_like(deviation)
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, deviation)


def compute_aes6_metrics(deviation_frac, fs, skip_seconds=0.5):
    """
    Compute AES6-2008 wow & flutter metrics from fractional deviation
    signal on a uniform time grid.
    """
    skip = int(skip_seconds * fs)
    nyquist = fs / 2.0

    dev_u = deviation_frac[skip:]
    dev_u_abs = np.abs(dev_u)
    peak_u = np.percentile(dev_u_abs, 95) * 100.0
    rms_u = np.sqrt(np.mean(dev_u**2)) * 100.0

    b_w, a_w = make_aes6_weighting_filter(fs)
    dev_weighted = lfilter(b_w, a_w, deviation_frac)
    dev_w = dev_weighted[skip:]
    dev_w_abs = np.abs(dev_w)
    peak_w = np.percentile(dev_w_abs, 95) * 100.0
    rms_w = np.sqrt(np.mean(dev_w**2)) * 100.0

    n_total = len(deviation_frac)
    drift_rms = 0.0
    capture_dur = n_total / fs

    drift_lo = max(0.05, 1.0 / capture_dur)
    drift_hi = 0.5
    if drift_hi > drift_lo and drift_hi < nyquist * 0.95:
        drift_taper_s = 2.0
        taper_n = min(int(drift_taper_s * fs), n_total // 4)
        taper_window = np.ones(n_total)
        ramp = 0.5 * (1 - np.cos(np.pi * np.arange(taper_n) / taper_n))
        taper_window[:taper_n] = ramp
        taper_window[-taper_n:] = ramp[::-1]

        drift_order = 10
        sos_drift = butter(drift_order,
                           [drift_lo / nyquist, drift_hi / nyquist],
                           btype='band', output='sos')
        drift_sig = sosfiltfilt(sos_drift, deviation_frac * taper_window)

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
        'peak_unweighted': float(peak_u),
        'rms_unweighted': float(rms_u),
        'peak_weighted': float(peak_w),
        'rms_weighted': float(rms_w),
        'drift_rms': float(drift_rms),
        'wow_rms': float(wow_rms),
        'flutter_rms': float(flutter_rms),
    }


# ========================= SPECTRUM =========================

def compute_spectrum(deviation_pct, output_rate, max_peaks=12,
                     peak_threshold=0.08):
    """
    Compute deviation spectrum and detect harmonic peaks.

    Returns dict with:
      freqs: frequency array (Hz)
      amplitude: amplitude spectral density (% RMS/sqrt(Hz))
      peaks: list of peak dicts with immutable detection data
    """
    N = len(deviation_pct)
    win = np.hanning(N)
    X = np.fft.rfft(deviation_pct * win)
    freqs = np.fft.rfftfreq(N, d=1.0 / output_rate)

    # Amplitude spectral density (RMS/sqrt(Hz))
    amp = np.abs(X) * np.sqrt(2.0) / (np.sum(win) * np.sqrt(freqs[1]))

    # Per-bin amplitude (for RMS values)
    fft_amp_bin = np.abs(X) * 2.0 / np.sum(win)

    # Find significant peaks
    if len(amp) > 1:
        pk_idx, _ = _find_peaks(amp, height=np.max(amp[1:]) * peak_threshold)
        pk_idx = [p for p in pk_idx
                  if freqs[p] > 0.3
                  and freqs[p] < min(50, output_rate / 2)]
        pk_idx = sorted(pk_idx, key=lambda p: amp[p], reverse=True)[:max_peaks]
    else:
        pk_idx = []

    # Build peaks list — immutable detection data only, no identity labels
    peaks = []
    for p in sorted(pk_idx, key=lambda p: freqs[p]):
        bin_rms = float(fft_amp_bin[p] / np.sqrt(2))
        peaks.append({
            'freq': float(freqs[p]),
            'amplitude': float(amp[p]),
            'rms': bin_rms,
            'fft_bin_index': int(p),
        })

    return {
        'freqs': freqs.tolist(),
        'amplitude': amp.tolist(),
        'peaks': peaks,
    }


# ========================= HARMONIC EXTRACTION =========================
# Adapted from Utilities/fg_harmonics.py — do not rewrite.

def extract_harmonic(deviation, fs, center_freq, bandwidth=None, f_rot=None):
    """
    Extract a single frequency component from the deviation signal
    using a narrow bandpass filter (4th-order Butterworth SOS, zero-phase).

    Bandwidth is set narrow enough to exclude sidebands at +/-f_rot.
    """
    if bandwidth is None:
        if f_rot is not None:
            bandwidth = min(f_rot * 0.8, max(0.3, center_freq * 0.05))
        else:
            bandwidth = max(0.3, center_freq * 0.05)

    lo = center_freq - bandwidth / 2
    hi = center_freq + bandwidth / 2
    nyquist = fs / 2.0

    lo = max(lo, 0.05)
    hi = min(hi, nyquist * 0.95)

    sos = butter(4, [lo / nyquist, hi / nyquist],
                 btype='bandpass', output='sos')
    return sosfiltfilt(sos, deviation)


def extract_harmonics_batch(deviation_pct, output_rate, center_freqs,
                            f_rot=None):
    """
    Extract multiple harmonic components in one call.
    Returns list of arrays, one per center_freq.
    """
    results = []
    for freq in center_freqs:
        if freq < output_rate / 2:
            comp = extract_harmonic(deviation_pct, output_rate, freq,
                                    f_rot=f_rot)
            results.append(comp.tolist())
        else:
            results.append([])
    return results


# ========================= MOTOR HARMONIC IDENTIFICATION =========================

def identify_motor_harmonics(peaks, motor_slots, motor_poles, rpm,
                             freq_resolution):
    """
    Tag peaks with motor harmonic identities. Returns list of identity
    dicts, one per peak (indexed by position). Identity fields are
    nullable — unidentified peaks get None values.

    Identity dict structure (flexible — will evolve):
      {
        'peak_index': int,       # index into peaks list
        'source': str or None,   # 'Rotation', 'Electrical', etc.
        'harmonic_order': int or None,  # nth harmonic
        'matched_fundamental': float or None,  # Hz
        'detail': str,           # display string e.g. '2x'
      }
    """
    pole_pairs = motor_poles // 2
    f_rot = rpm / 60.0
    f_elec = pole_pairs * f_rot
    f_slot = motor_slots * f_rot
    f_ripple = 3 * f_elec

    tol = max(freq_resolution * 1.5, f_rot * 0.3)

    identities = []
    for idx, peak in enumerate(peaks):
        f = peak['freq']
        source = None
        harmonic_order = None
        matched_fundamental = None
        detail = ''

        # Most specific first
        for n in range(1, 5):
            if abs(f - n * f_ripple) < tol:
                source = 'Torque ripple'
                harmonic_order = n
                matched_fundamental = f_ripple
                detail = f'{n}x ' if n > 1 else ''
                break

        if source is None:
            for n in range(1, 5):
                if abs(f - n * f_slot) < tol:
                    source = 'Slot passing'
                    harmonic_order = n
                    matched_fundamental = f_slot
                    detail = f'{n}x ' if n > 1 else ''
                    break

        if source is None:
            for n in range(1, 10):
                if abs(f - n * f_elec) < tol:
                    source = 'Electrical'
                    harmonic_order = n
                    matched_fundamental = f_elec
                    detail = f'{n}x ' if n > 1 else ''
                    break

        if source is None:
            if abs(f - f_rot) < tol:
                source = 'Rotation'
                harmonic_order = 1
                matched_fundamental = f_rot

        identities.append({
            'peak_index': idx,
            'source': source,
            'harmonic_order': harmonic_order,
            'matched_fundamental': float(matched_fundamental) if matched_fundamental else None,
            'detail': detail,
        })

    return identities


# ========================= MAIN ANALYSIS =========================

def _assess_confidence(duration, n_crossings, n_rejected, f_est, f_mean,
                       output_rate, aes6_keys):
    """
    Assess confidence level for each AES6 metric.

    Returns dict mirroring aes6 keys with values "high", "medium", or "low".
    Placeholder implementation — all metrics return "high" for now.
    Future heuristics will consider:
      - Signal duration vs minimum for each band
      - Crossing density (crossings per second)
      - Outlier rejection fraction
      - Carrier SNR
      - Carrier frequency vs expected range
      - Deviation signal stationarity
    """
    confidence = {}
    for key in aes6_keys:
        confidence[key] = "high"
    return confidence


def analyze(pcm_data, sample_rate, channel=0):
    """
    Run the full analysis pipeline on PCM data.

    Parameters:
        pcm_data: numpy array (float64) — mono audio signal
        sample_rate: int — sample rate in Hz
        channel: int — ignored (channel extraction done in JS)

    Returns dict with all results for the front-end.
    """
    import time as _time
    try:
        from js import console as _console
        def _log(msg):
            _console.log(msg)
    except ImportError:
        def _log(msg):
            pass

    _t0 = _time.time()
    def _lap(label):
        nonlocal _t0
        now = _time.time()
        _log(f"[WF] {label}: {(now - _t0)*1000:.0f} ms")
        _t0 = now

    fs = sample_rate
    sig = np.asarray(pcm_data, dtype=np.float64)
    duration = len(sig) / fs

    _lap(f"Array conversion ({len(sig)} samples)")
    _status(f"Loaded: {duration:.1f}s at {fs} Hz")

    # Carrier frequency estimate
    _status("Detecting carrier frequency...")
    f_est = estimate_carrier_freq(sig, fs)
    _lap("Carrier estimate")

    # Bandpass prefilter
    _status("Applying prefilter...")
    if PREFILTER_BW_FACTOR is not None and f_est > 0:
        bw_hz = f_est * PREFILTER_BW_FACTOR
        MAX_BW_HZ = 150.0
        if f_est > 500 and bw_hz > MAX_BW_HZ:
            bw_hz = MAX_BW_HZ
        bp_low = max(f_est - bw_hz, 1.0)
        bp_high = min(f_est + bw_hz, fs / 2.0 * 0.95)
        sig_filtered = bandpass_prefilter(sig, fs, bp_low, bp_high,
                                          order=PREFILTER_ORDER)
    else:
        sig_filtered = sig
    _lap("Prefilter")

    # Zero crossings
    _status("Finding zero crossings...")
    crossing_times = find_zero_crossings(sig_filtered, fs)

    _lap(f"Zero crossings ({len(crossing_times)} found)")

    if len(crossing_times) < 3:
        raise ValueError(
            f"Only {len(crossing_times)} zero crossings found. "
            "No valid carrier signal detected in the audio."
        )

    # Convert to frequency
    t_freq, freq = crossings_to_frequency(crossing_times)

    # Edge trimming
    _status("Trimming edge artifacts...")
    if PREFILTER_BW_FACTOR is not None and len(t_freq) > 40:
        n_xing = len(freq)
        interior = freq[n_xing // 10: -n_xing // 10]
        f_med = np.median(interior)
        mad = np.median(np.abs(interior - f_med))
        thresh = 5.0 * mad / f_med * 100.0
        dev_from_med = np.abs(freq - f_med) / f_med * 100.0

        trim_start = 0
        for i in range(min(20, n_xing)):
            if dev_from_med[i] >= thresh:
                trim_start = i + 1

        trim_end = 0
        for i in range(n_xing - 1, max(n_xing - 21, -1), -1):
            if dev_from_med[i] >= thresh:
                trim_end = n_xing - i

        if trim_start > 0 or trim_end > 0:
            end_idx = n_xing - trim_end if trim_end > 0 else n_xing
            t_freq = t_freq[trim_start:end_idx]
            freq = freq[trim_start:end_idx]

    # Outlier rejection
    n_rejected = 0
    _status("Rejecting outliers...")
    f_median = np.median(freq)
    mad = np.median(np.abs(freq - f_median))
    mad_thresh_hz = max(8.0 * mad, f_median * 0.001)
    mad_thresh_hz = min(mad_thresh_hz, f_median * OUTLIER_THRESH_PCT / 100.0)
    outlier_mask = np.abs(freq - f_median) > mad_thresh_hz
    n_rejected = np.sum(outlier_mask)
    if n_rejected > 0:
        t_freq = t_freq[~outlier_mask]
        freq = freq[~outlier_mask]

    # Median despike (high carrier only)
    MEDFILT_KERNEL = 5
    f_carrier_est = (len(freq) / (t_freq[-1] - t_freq[0])
                     if len(t_freq) > 1 else 0)
    if f_carrier_est > 500 and len(freq) > MEDFILT_KERNEL:
        mad_clean = np.median(np.abs(freq - np.median(freq)))
        freq_med = medfilt(freq, kernel_size=MEDFILT_KERNEL)
        spike_thresh = 3.0 * mad_clean
        is_spike = np.abs(freq - freq_med) > spike_thresh
        n_despiked = np.sum(is_spike)
        if n_despiked > 0:
            freq[is_spike] = freq_med[is_spike]

    # Stats
    f_mean = float(np.mean(freq))
    f_std = float(np.std(freq))
    f_min = float(np.min(freq))
    f_max = float(np.max(freq))

    _lap("Edge trim + outlier rejection + despike")

    # Smooth
    freq_smooth = smooth_frequency(freq, SMOOTH_CYCLES)

    # Interpolate to uniform grid
    _status("Interpolating to uniform grid...")
    t_uniform, f_uniform = interpolate_to_uniform(t_freq, freq_smooth)

    _lap(f"Uniform interpolation ({len(t_uniform)} points)")

    # Deviation
    output_rate = len(t_uniform) / (t_uniform[-1] - t_uniform[0])
    deviation_hz = f_uniform - f_mean
    deviation_frac = deviation_hz / f_mean
    deviation_pct = deviation_frac * 100.0

    # W&F metrics
    dev_pct_abs = np.abs(deviation_pct)
    wf_peak_2sigma = float(np.percentile(dev_pct_abs, 95))
    wf_rms = float(np.sqrt(np.mean(deviation_pct**2)))
    wf_peak_to_peak = float(
        np.percentile(deviation_pct, 99.85) -
        np.percentile(deviation_pct, 0.15)
    )

    # AES6 metrics
    _status("Computing AES6 metrics...")
    aes6 = compute_aes6_metrics(deviation_frac, output_rate)

    _lap("AES6 metrics")

    # Spectrum
    _status("Computing spectrum...")
    spectrum = compute_spectrum(deviation_pct, output_rate)

    _lap("Spectrum")
    _status("Complete")

    # Confidence assessment for each metric.
    # Levels: "high", "medium", "low".
    # Future: actual heuristics (signal duration, crossing density,
    # outlier fraction, carrier SNR, etc.) will set these per-metric.
    confidence = _assess_confidence(
        duration=duration,
        n_crossings=len(crossing_times),
        n_rejected=int(n_rejected),
        f_est=f_est,
        f_mean=f_mean,
        output_rate=output_rate,
        aes6_keys=list(aes6.keys()),
    )

    return {
        # Deviation trace (for waveform display)
        't_uniform': t_uniform.tolist(),
        'deviation_pct': deviation_pct.tolist(),

        # Spectrum
        'spectrum': spectrum,

        # Polar + histogram source data
        'inst_freq': (f_mean * (1.0 + deviation_pct / 100.0)).tolist(),
        'f_mean': f_mean,
        'output_rate': float(output_rate),

        # AES6 metrics
        'aes6': aes6,

        # Per-metric confidence: mirrors aes6 keys with "high"/"medium"/"low"
        'confidence': confidence,

        # Signal info
        'duration': float(duration),
        'carrier_freq': float(f_est),
        'wf_peak_2sigma': wf_peak_2sigma,
        'wf_rms': wf_rms,
        'wf_peak_to_peak': wf_peak_to_peak,

        # Stats
        'f_std': f_std,
        'f_min': f_min,
        'f_max': f_max,
    }


def analyze_region(pcm_data, sample_rate, start_sec, end_sec):
    """
    Re-run the full pipeline on a sub-region of the audio.
    Same code path as analyze(), just on a shorter segment.

    Parameters:
        pcm_data: numpy array (float64) — full mono audio signal
        sample_rate: int
        start_sec: float — region start in seconds
        end_sec: float — region end in seconds

    Returns same structure as analyze().
    """
    start_idx = int(start_sec * sample_rate)
    end_idx = int(end_sec * sample_rate)
    segment = np.asarray(pcm_data, dtype=np.float64)[start_idx:end_idx]
    return analyze(segment, sample_rate)
