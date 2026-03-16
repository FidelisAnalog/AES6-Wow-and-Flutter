/**
 * Dark and light palettes for MUI theme.
 * Starting point borrowed from Browser-ABX color scheme.
 */

export const darkPalette = {
  mode: 'dark',
  primary: { main: '#90caf9' },
  secondary: { main: '#ce93d8' },
  background: {
    default: '#121212',
    paper: '#1e1e1e',
  },
  text: {
    primary: '#e0e0e0',
    secondary: '#aaaaaa',
  },
  error: { main: '#f44336' },
  warning: { main: '#ffa726' },
  info: { main: '#29b6f6' },
  success: { main: '#66bb6a' },
  divider: 'rgba(255,255,255,0.12)',
  // Custom plot/waveform colors — consumed by future chart components
  waveform: {
    trace: '#90caf9',
    traceDimmed: 'rgba(144,202,249,0.3)',
    zeroLine: 'rgba(255,255,255,0.2)',
    sigmaLine: '#f44336',
    grid: 'rgba(255,255,255,0.06)',
    region: 'rgba(144,202,249,0.15)',
  },
};

export const lightPalette = {
  mode: 'light',
  primary: { main: '#1976d2' },
  secondary: { main: '#9c27b0' },
  background: {
    default: '#fafafa',
    paper: '#ffffff',
  },
  text: {
    primary: '#212121',
    secondary: '#666666',
  },
  error: { main: '#d32f2f' },
  warning: { main: '#ed6c02' },
  info: { main: '#0288d1' },
  success: { main: '#2e7d32' },
  divider: 'rgba(0,0,0,0.12)',
  waveform: {
    trace: '#1976d2',
    traceDimmed: 'rgba(25,118,210,0.3)',
    zeroLine: 'rgba(0,0,0,0.2)',
    sigmaLine: '#d32f2f',
    grid: 'rgba(0,0,0,0.06)',
    region: 'rgba(25,118,210,0.1)',
  },
};
