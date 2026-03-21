import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { DarkMode, LightMode } from '@mui/icons-material';
import { useThemeMode } from '../../theme/index.js';

export default function Header() {
  const { mode, toggleTheme } = useThemeMode();

  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 1.5,
        px: 0,
      }}
    >
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
        AES6 W&amp;F Analyzer <span style={{fontSize:'0.5em',opacity:0.5}}>Development Preview</span>
      </Typography>

      <Tooltip title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode (Ctrl+Shift+T)`}>
        <IconButton onClick={toggleTheme} size="small" color="inherit">
          {mode === 'dark' ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
