import { Paper, Typography, Alert } from '@mui/material';

/**
 * Displays file metadata after loading.
 * @param {{ audioInfo: object }} props
 */
export default function FileInfo({ audioInfo }) {
  if (!audioInfo) return null;

  const {
    fileName, sampleRate, channels, duration,
    wasTruncated, wasDownsampled, originalDuration, originalSampleRate,
  } = audioInfo;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2">File: {fileName}</Typography>
      <Typography variant="body2" color="text.secondary">
        {sampleRate} Hz | {channels}ch | {duration.toFixed(2)}s
        {wasDownsampled && ` (downsampled from ${originalSampleRate} Hz)`}
      </Typography>
      {wasTruncated && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          File truncated to {duration.toFixed(0)}s for analysis
          (original: {originalDuration.toFixed(1)}s).
        </Alert>
      )}
    </Paper>
  );
}
