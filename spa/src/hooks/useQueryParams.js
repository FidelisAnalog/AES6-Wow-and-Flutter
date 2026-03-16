import { useMemo } from 'react';

/**
 * Parse common query params used across the app.
 * Returns a stable object (recalculated only on mount since URL doesn't change at runtime).
 */
export default function useQueryParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      embed: params.get('embed') === 'true',
      theme: params.get('theme'),                       // 'dark' | 'light' | 'system' | null
      hidePanel: (params.get('hidePanel') || '').split(',').filter(Boolean),
      file: params.get('file'),                         // URL to auto-load
    };
  }, []);
}
