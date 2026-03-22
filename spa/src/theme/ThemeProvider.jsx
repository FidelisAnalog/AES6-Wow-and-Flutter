import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { darkPalette, lightPalette } from './palettes.js';

const STORAGE_KEY = 'themeMode';

const ThemeContext = createContext({ mode: 'dark', toggleTheme: () => {}, setTheme: () => {} });

export function useThemeMode() {
  return useContext(ThemeContext);
}

function getSystemMode() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Resolve initial mode (priority: query param > localStorage > OS).
 * localStorage only stores when user has explicitly overridden the system default.
 */
function getInitialMode() {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('theme');
  if (qp === 'dark' || qp === 'light') return qp;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {}

  return getSystemMode();
}

export default function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getInitialMode);

  // Persist only when different from system; clear when matching system
  const persistMode = useCallback((m) => {
    try {
      if (m === getSystemMode()) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, m);
      }
    } catch {}
  }, []);

  const setTheme = useCallback((m) => {
    if (m === 'system') {
      const os = getSystemMode();
      setModeState(os);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    } else if (m === 'dark' || m === 'light') {
      setModeState(m);
      persistMode(m);
    }
  }, [persistMode]);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      persistMode(next);
      return next;
    });
  }, [persistMode]);

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

  // OS preference change listener — only follow if no localStorage override
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const handler = (e) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return; // user overrode, don't follow OS
      } catch {}
      setModeState(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme = useMemo(
    () => {
      const palette = mode === 'dark' ? darkPalette : lightPalette;
      return createTheme({
        palette,
        ...(palette.inputBackground ? {
          components: {
            MuiOutlinedInput: {
              styleOverrides: { root: { backgroundColor: palette.inputBackground } },
            },
            MuiButton: {
              styleOverrides: { outlined: { backgroundColor: palette.inputBackground } },
            },
            MuiToggleButtonGroup: {
              styleOverrides: {
                root: { backgroundColor: palette.inputBackground },
              },
            },
          },
        } : {}),
      });
    },
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
