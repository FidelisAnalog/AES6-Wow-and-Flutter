/**
 * useCollapsible — persisted collapse state for panels.
 * Returns { collapsed, toggleCollapsed }.
 * Reusable across Spectrum, Waveform, or any panel.
 */
import { useState, useCallback } from 'react';

export default function useCollapsible(storageKey, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === 'true';
    } catch { /* ignore */ }
    return defaultCollapsed;
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggleCollapsed };
}
