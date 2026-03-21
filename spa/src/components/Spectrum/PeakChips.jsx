/**
 * Horizontal scrollable chip list for spectrum peaks.
 * Each chip shows freq + rms% + optional label. Color by peak index.
 * Synced with SpectrumPlot peak selection.
 */

import { Box, Chip, Tooltip } from '@mui/material';
import { getPeakColor } from './peakColors.js';

export default function PeakChips({ peaks = [], selectedPeakIndices = [], onTogglePeak }) {
  if (!selectedPeakIndices.length) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        py: 0.5,
        px: 1,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        '&::-webkit-scrollbar': { height: 4 },
        '&::-webkit-scrollbar-thumb': { borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.3)' },
      }}
    >
      {selectedPeakIndices.map((idx) => {
        const peak = peaks[idx];
        if (!peak) return null;
        const color = getPeakColor(idx);
        const label = buildChipLabel(peak);
        const tooltip = `${peak.rms.toFixed(4)}% RMS`;
        return (
          <Tooltip key={idx} title={tooltip} arrow enterDelay={300} enterTouchDelay={500}>
            <Chip
              label={label}
              size="small"
              variant="filled"
              clickable
              onClick={() => onTogglePeak?.(idx)}
              sx={{
                flexShrink: 0,
                backgroundColor: color,
                color: 'common.white',
                '&:hover': { backgroundColor: color, opacity: 0.9 },
                fontFamily: 'monospace',
                fontSize: '0.75rem',
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

function buildChipLabel(peak) {
  const parts = [`${peak.freq.toFixed(2)} Hz`];
  if (peak.label) parts.push(peak.label);
  return parts.join(' ');
}
