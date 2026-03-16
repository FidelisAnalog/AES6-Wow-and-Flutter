import { Paper, Typography, Box, Skeleton } from '@mui/material';
import MetricRow from './MetricRow.jsx';
import { MIN_DRIFT_SECONDS } from '../../config/constants.js';

const UNWTD_TIP = 'DIN/IEC unweighted: full bandwidth (0.5–200 Hz), no perceptual weighting applied.';
const WTD_TIP = 'DIN/IEC weighted: perceptual weighting filter per IEC 60386, emphasizing frequencies where human ear is most sensitive to pitch variation.';

function fmt(val, decimals = 4) {
  return val != null ? val.toFixed(decimals) : '—';
}

/**
 * AES6-2008 metrics display panel.
 * @param {{ result: object|null, processing: boolean, duration: number|null }} props
 */
export default function StatsPanel({ result, processing, duration }) {
  if (!result && !processing) return null;

  if (processing) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>AES6-2008 Metrics</Typography>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="70%" />
      </Paper>
    );
  }

  const { aes6, carrier_freq, f_mean, t_uniform, spectrum } = result;
  const showDrift = duration != null && duration >= MIN_DRIFT_SECONDS;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        AES6-2008 Metrics
      </Typography>

      {/* Carrier */}
      <MetricRow
        label="Carrier"
        value={`${fmt(carrier_freq, 1)} Hz  |  Mean: ${fmt(f_mean)} Hz`}
      />

      {/* DIN/IEC Unwtd */}
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          DIN/IEC Unwtd
        </Typography>
        <MetricRow
          label="Peak (2\u03C3)"
          value={`\u00B1${fmt(aes6.peak_unweighted)}%`}
          tooltip={UNWTD_TIP}
        />
        <MetricRow label="RMS" value={`${fmt(aes6.rms_unweighted)}%`} />
      </Box>

      {/* DIN/IEC Wtd */}
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          DIN/IEC Wtd
        </Typography>
        <MetricRow
          label="Peak (2\u03C3)"
          value={`\u00B1${fmt(aes6.peak_weighted)}%`}
          tooltip={WTD_TIP}
        />
        <MetricRow label="RMS (JIS)" value={`${fmt(aes6.rms_weighted)}%`} />
        <MetricRow label="Wow" value={`${fmt(aes6.wow_rms)}%`} />
        <MetricRow label="Flutter" value={`${fmt(aes6.flutter_rms)}%`} />
      </Box>

      {/* Drift */}
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Drift (non-standard)
        </Typography>
        {showDrift ? (
          <MetricRow label="Drift" value={`${fmt(aes6.drift_rms)}%`} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.8rem' }}>
            Requires {MIN_DRIFT_SECONDS}s minimum signal for drift measurement
          </Typography>
        )}
      </Box>

      {/* Signal info */}
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Signal
        </Typography>
        <MetricRow label="Duration" value={`${fmt(result.duration, 2)}s`} />
        <MetricRow label="Deviation pts" value={`${t_uniform?.length ?? '—'}`} />
        <MetricRow label="Peaks detected" value={`${spectrum?.peaks?.length ?? '—'}`} />
      </Box>
    </Paper>
  );
}
