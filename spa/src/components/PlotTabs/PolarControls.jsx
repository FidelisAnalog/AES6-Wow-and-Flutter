/**
 * Polar plot controls — revolution count + plot button.
 * RPM is now in AdvancedPanel. This just selects revolutions and triggers fetch.
 */

import { useState, useCallback } from 'react';
import { Box, Typography, Select, MenuItem, Button } from '@mui/material';

const DEFAULT_REVOLUTIONS = 2;
const MAX_REVOLUTIONS = 10;

export default function PolarControls({ available, onPlot }) {
  const [revolutions, setRevolutions] = useState(DEFAULT_REVOLUTIONS);

  const polarAvailable = available?.polar;
  const maxRevs = Math.min(MAX_REVOLUTIONS, polarAvailable?.max_revolutions ?? MAX_REVOLUTIONS);
  const canPlot = polarAvailable != null;

  const handleRevsChange = useCallback((e) => {
    setRevolutions(e.target.value);
  }, []);

  const handlePlot = useCallback(() => {
    if (!canPlot) return;
    onPlot?.({ revolutions });
  }, [canPlot, revolutions, onPlot]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 35 }}>
        Revs
      </Typography>
      <Select
        size="small"
        value={revolutions}
        onChange={handleRevsChange}
        sx={{ width: 60, fontFamily: 'monospace', fontSize: '0.85rem' }}
      >
        {Array.from({ length: maxRevs }, (_, i) => (
          <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>
        ))}
      </Select>
      <Button
        variant="outlined"
        size="small"
        onClick={handlePlot}
        disabled={!canPlot}
        sx={{ textTransform: 'none', ml: 1 }}
      >
        Plot
      </Button>
      {!canPlot && (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Set RPM in Advanced tab first
        </Typography>
      )}
    </Box>
  );
}
