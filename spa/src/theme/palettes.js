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
  // Health indicator dot
  statusIndicator: {
    ok: '#66bb6a',
    warning: '#ffa726',
    error: '#f44336',
  },
  // Custom plot/waveform colors — consumed by future chart components
  waveform: {
    background: '#1a1a1a',
    trace: '#42a5f5',
    traceDimmed: 'rgba(66,165,245,0.3)',
    zeroLine: 'rgba(255,255,255,0.2)',
    sigmaLine: '#f44336',
    grid: '#444444',
    region: 'rgba(255,183,77,0.2)',
    loopDim: 'rgba(0,0,0,0.25)',
    loopRegion: 'rgba(255,183,77,0.2)',
    loopHandle: '#ffb74d',
    overviewBackground: '#222222',
    axisBackground: '#222222',
    overviewFill: '#546e7a',
    overviewActiveFill: '#42a5f5',
    viewportIndicator: 'rgba(66,165,245,0.25)',
    handle: '#42a5f5',
    handleHover: '#bbdefb',
  },
  spectrum: {
    trace: '#66bb6a',
    couplingThreshold: '#ff9800',
    background: '#1a1a1a',
    grid: '#444444',
    overviewFill: '#546e7a',
    overviewActiveFill: '#66bb6a',
    viewportIndicator: 'rgba(102,187,106,0.25)',
    handle: '#66bb6a',
    handleHover: '#a5d6a7',
    labelBackground: 'rgba(26,26,26,0.85)',
    labelText: '#e0e0e0',
  },
};

export const lightPalette = {
  mode: 'light',
  primary: { main: '#1565c0' },
  secondary: { main: '#7b1fa2' },
  background: {
    default: '#e0e0e0',   // page — medium grey
    paper: '#f5f5f5',     // cards — noticeably lighter
  },
  text: {
    primary: '#212121',
    secondary: '#555555',
  },
  error: { main: '#d32f2f' },
  warning: { main: '#e65100' },
  info: { main: '#0277bd' },
  success: { main: '#2e7d32' },
  inputBackground: '#ffffff',
  // Health indicator dot
  statusIndicator: {
    ok: '#2e7d32',
    warning: '#e65100',
    error: '#d32f2f',
  },
  divider: 'rgba(0,0,0,0.15)',
  waveform: {
    background: '#ffffff',              // plot canvas — white
    trace: '#1565c0',
    traceDimmed: 'rgba(21,101,192,0.25)',
    zeroLine: 'rgba(0,0,0,0.15)',
    sigmaLine: '#c62828',
    grid: '#d0d0d0',
    region: 'rgba(230,81,0,0.12)',
    loopDim: 'rgba(0,0,0,0.08)',
    loopRegion: 'rgba(230,81,0,0.12)',
    loopHandle: '#e65100',
    overviewBackground: '#e8e8e8',      // overview — darker than card
    axisBackground: '#eaeaea',          // axis — between card and overview
    overviewFill: '#90a4ae',
    overviewActiveFill: '#1565c0',
    viewportIndicator: 'rgba(21,101,192,0.18)',
    handle: '#1565c0',
    handleHover: '#0d47a1',
  },
  spectrum: {
    trace: '#2e7d32',
    couplingThreshold: '#e65100',
    background: '#ffffff',              // plot canvas — white
    grid: '#d0d0d0',
    overviewFill: '#90a4ae',
    overviewActiveFill: '#2e7d32',
    viewportIndicator: 'rgba(46,125,50,0.18)',
    handle: '#2e7d32',
    handleHover: '#1b5e20',
    labelBackground: 'rgba(255,255,255,0.9)',
    labelText: '#212121',
  },
};
