import { Box, Typography, Tooltip } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';

/**
 * Single metric display row.
 * @param {{ label: string, value: string, tooltip?: string }} props
 */
export default function MetricRow({ label, value, tooltip }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
        {tooltip && (
          <Tooltip title={tooltip} arrow placement="top">
            <InfoOutlined sx={{ fontSize: 12, ml: 0.5, verticalAlign: 'middle', cursor: 'help' }} />
          </Tooltip>
        )}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
        {value}
      </Typography>
    </Box>
  );
}
