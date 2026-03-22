/**
 * Polar plot controls — revolution count dropdown + legend.
 * Revs state is owned by PlotTabs. Changing dropdown auto-plots.
 */

import { Box, Typography, Select, MenuItem } from '@mui/material';

const MAX_REVOLUTIONS = 10;

const PLOTLY_COLORS = [
  '#ef553b', '#636efa', '#00cc96', '#ab63fa', '#ffa15a',
  '#19d3f3', '#ff6692', '#b6e880', '#ff97ff', '#fecb52',
];

export default function PolarControls({ available, revolutions, onRevsChange, plotData }) {
  const polarAvailable = available?.polar;
  const maxRevs = Math.min(MAX_REVOLUTIONS, polarAvailable?.max_revolutions ?? MAX_REVOLUTIONS);
  const numRevs = plotData?.revolutions?.length ?? 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Revs dropdown */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 35, display: { xs: 'none', sm: 'block' } }}>
          Revs
        </Typography>
        <Select
          size="small"
          value={Math.min(revolutions, maxRevs)}
          onChange={(e) => onRevsChange(e.target.value)}
          sx={{
            width: { xs: 52, sm: 70 },
            height: { xs: 24, sm: 28 },
            fontFamily: 'monospace',
            fontSize: { xs: '0.7rem', sm: '0.8rem' },
            '& .MuiSelect-select': {
              padding: { xs: '2px 20px 2px 6px', sm: '4px 24px 4px 8px' },
            },
          }}
        >
          {Array.from({ length: maxRevs }, (_, i) => (
            <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>
          ))}
        </Select>
      </Box>

      {/* Legend — aligned with dropdown left edge */}
      {numRevs > 0 && (
        <Box sx={{ mt: { xs: 1.5, sm: 3 }, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 0.25, sm: 0.5 } }}>
          {Array.from({ length: numRevs }, (_, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{
                width: { xs: 12, sm: 20 },
                height: 2,
                backgroundColor: PLOTLY_COLORS[i % PLOTLY_COLORS.length],
                flexShrink: 0,
              }} />
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: { xs: '0.6rem', sm: '0.75rem' }, whiteSpace: 'nowrap' }}>
                {i + 1}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
