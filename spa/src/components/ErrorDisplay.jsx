import { useState } from 'react';
import { Paper, Typography } from '@mui/material';

/**
 * Error display with expandable stack trace.
 * @param {{ message: string, traceback?: string }} props
 */
export default function ErrorDisplay({ message, traceback }) {
  const [showTrace, setShowTrace] = useState(false);

  if (!message) return null;

  return (
    <Paper sx={{ p: 2, bgcolor: 'error.main', color: 'error.contrastText' }}>
      <Typography variant="body2">{message}</Typography>
      {traceback && (
        <>
          <Typography
            variant="caption"
            sx={{ cursor: 'pointer', textDecoration: 'underline', mt: 1, display: 'block' }}
            onClick={() => setShowTrace(!showTrace)}
          >
            {showTrace ? 'Hide' : 'Show'} stack trace
          </Typography>
          {showTrace && (
            <Typography
              variant="caption"
              component="pre"
              sx={{ mt: 1, whiteSpace: 'pre-wrap', fontSize: '0.7rem' }}
            >
              {traceback}
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
}
