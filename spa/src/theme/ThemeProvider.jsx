import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { darkPalette, lightPalette } from './palettes.js';

const ThemeContext = createContext({ mode: 'dark', toggleTheme: () => {}, setTheme: () => {} });

export function useThemeMode() {
  return useContext(ThemeContext);
}

/**
 * Resolve initial mode from sources (priority: query param > OS preference).
 * postMessage override is handled at runtime via the effect.
 */
function getInitialMode() {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('theme');
  if (qp === 'dark' || qp === 'light') return qp;

  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export default function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getInitialMode);

  const setTheme = useCallback((m) => {
    if (m === 'system') {
      const os = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      setModeState(os);
    } else if (m === 'dark' || m === 'light') {
      setModeState(m);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Ctrl+Shift+T keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleTheme]);

  // postMessage override (highest priority at runtime)
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'setTheme') {
        setTheme(e.data.value);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setTheme]);

  // OS preference change listener
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const handler = (e) => {
      // Only follow OS if user hasn't manually toggled (we don't track this,
      // so we always follow OS changes — acceptable trade-off)
      setModeState(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme = useMemo(
    () => createTheme({ palette: mode === 'dark' ? darkPalette : lightPalette }),
    [mode],
  );

  const ctx = useMemo(() => ({ mode, toggleTheme, setTheme }), [mode, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={ctx}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}
