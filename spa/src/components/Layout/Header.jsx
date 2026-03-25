import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { DarkMode, LightMode } from '@mui/icons-material';
import { useThemeMode } from '../../theme/index.js';

export default function Header() {
  const { mode, toggleTheme } = useThemeMode();
  const base = import.meta.env.BASE_URL || '/';
  const logoSrc = `${base}logo-${mode === 'dark' ? 'dark' : 'light'}.svg`;

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box component="img" src={logoSrc} alt="" sx={{ height: { xs: 48, sm: 58 } }} />
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: { xs: '1.5px', sm: '1px' }, fontSize: { xs: '1.251rem', sm: '1.5rem' } }}>
          W&amp;F Analyzer
          <Box component="span" sx={{ fontSize: '0.5em', ml: 1, color: 'error.main' }}>Dev Demo</Box>
        </Typography>
      </Box>

      <Tooltip title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode (Ctrl+Shift+T)`}>
        <IconButton onClick={toggleTheme} size="small" color="inherit">
          {mode === 'dark' ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
