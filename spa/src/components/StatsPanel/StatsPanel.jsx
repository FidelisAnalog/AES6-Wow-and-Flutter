import { Paper, Typography, Box, Skeleton, Alert, Tooltip } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';
import { MIN_DRIFT_SECONDS } from '../../config/constants.js';

const UNWTD_TIP = 'DIN/IEC unweighted: full bandwidth (0.5–200 Hz), no perceptual weighting applied.';
const WTD_TIP = 'DIN/IEC weighted: perceptual weighting filter per IEC 60386, emphasizing frequencies where human ear is most sensitive to pitch variation.';

function fmt(val, decimals = 4) {
  return val != null ? val.toFixed(decimals) : '—';
}

function Metric({ label, value, tip }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5, mr: 2.5 }}>
      <Typography variant="body2" color="text.secondary" component="span">
        {label}
        {tip && (
          <Tooltip title={tip} arrow placement="top">
            <InfoOutlined sx={{ fontSize: 11, ml: 0.3, verticalAlign: 'middle', cursor: 'help' }} />
          </Tooltip>
        )}
      </Typography>
      <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Combined file info + metrics card — horizontal layout matching wf_analyze plot header.
 */
export default function StatsPanel({ result, processing, duration, audioInfo }) {
  if (!audioInfo && !result && !processing) return null;

  // No result yet (first load) — show skeleton
  if (!result && processing) {
    return (
      <Paper sx={{ p: 1.5, px: 2 }}>
        {audioInfo && <FileHeader audioInfo={audioInfo} resultDuration={duration} metrics={result?.metrics} />}
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="60%" />
      </Paper>
    );
  }

  // File loaded but no result yet (shouldn't happen, but guard)
  if (!result) {
    return audioInfo ? (
      <Paper sx={{ p: 1.5, px: 2 }}>
        <FileHeader audioInfo={audioInfo} />
      </Paper>
    ) : null;
  }

  const { metrics } = result;
  const { standard, non_standard } = metrics;
  const showDrift = duration != null && duration >= MIN_DRIFT_SECONDS;

  return (
    <Paper sx={{ p: 1.5, px: { xs: 1, sm: 2 }, opacity: processing ? 0.5 : 1, transition: 'opacity 0.2s' }}>
      {/* Line 1: File info */}
      {audioInfo && <FileHeader audioInfo={audioInfo} resultDuration={duration} metrics={result?.metrics} />}

      {/* Line 2: Mean + Drift */}
      <Box sx={{ mt: 0.5 }}>
        {metrics.input_type !== 'device' && <Metric label="Mean:" value={`${fmt(metrics.f_mean, 3)} Hz`} />}
        {showDrift && <Metric label="Drift:" value={`${fmt(non_standard.drift_rms.value)}%`} />}
        {metrics.fm_bw && <Metric label="BW:" value={metrics.fm_bw.value >= 1000 ? `${(Math.round(metrics.fm_bw.value / 10) * 10 / 1000).toFixed(1)} kHz` : `${Math.round(metrics.fm_bw.value / 10) * 10} Hz`} />}
      </Box>

      {/* Line 3: Unweighted */}
      <Box sx={{ mt: 0.25 }}>
        <Metric label="Unwtd Wow:" value={`${fmt(non_standard.unweighted_wow_rms.value)}%`} />
        <Metric label="Unwtd Flutter:" value={`${fmt(non_standard.unweighted_flutter_rms.value)}%`} />
        <Metric label="DIN/IEC Unwtd:" value={`Peak(2σ) ±${fmt(standard.unweighted_peak.value)}%`} tip={UNWTD_TIP} />
        <Metric label="RMS" value={`${fmt(standard.unweighted_rms.value)}%`} />
      </Box>

      {/* Line 4: Weighted */}
      <Box sx={{ mt: 0.25 }}>
        <Metric label="DIN/IEC Wtd:" value={`Peak(2σ) ±${fmt(standard.weighted_peak.value)}%`} tip={WTD_TIP} />
        <Metric label="RMS" value={`${fmt(standard.weighted_rms.value)}% (JIS)`} />
        <Metric label="Wow" value={`${fmt(standard.weighted_wow_rms.value)}%`} />
        <Metric label="Flutter" value={`${fmt(standard.weighted_flutter_rms.value)}%`} />
      </Box>
    </Paper>
  );
}

function fmtSR(sr) {
  return sr >= 1000 ? `${sr / 1000}k` : `${sr}`;
}

function FileHeader({ audioInfo, resultDuration, metrics }) {
  const {
    fileName, sampleRate, channels, duration,
    wasTruncated, wasDownsampled, originalDuration, originalSampleRate,
  } = audioInfo;

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
          {fileName}
        </Typography>
        {sampleRate != null && (
          <Typography variant="body2" color="text.secondary" component="span" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
            {fmtSR(sampleRate)} | {channels}ch | {duration?.toFixed(2)}s
            {wasDownsampled && ` (from ${fmtSR(originalSampleRate)})`}
          </Typography>
        )}
        {sampleRate == null && audioInfo.inputType === 'device' && (
          <Typography variant="body2" color="text.secondary" component="span" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
            {metrics?.device_format || 'Device'}{metrics?.device_label ? ` (${metrics.device_label})` : ''}{resultDuration ? ` | ${resultDuration.toFixed(2)}s` : ''}
          </Typography>
        )}
      </Box>
      {wasTruncated && (
        <Alert severity="info" sx={{ mt: 0.5, py: 0 }}>
          Truncated to {duration.toFixed(0)}s (original: {originalDuration.toFixed(1)}s)
        </Alert>
      )}
    </>
  );
}
