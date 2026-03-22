/**
 * Tabbed container: Advanced config, Histogram, Polar, (future: Lissajous).
 * Collapses to just tab bar on new file. Minimize glyph to collapse.
 * Polar auto-plots 2 revs when RPM is known.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Paper, Tabs, Tab, Box, Typography, IconButton } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AdvancedPanel from './AdvancedPanel.jsx';
import HistogramPlot from './HistogramPlot.jsx';
import PolarPlot from './PolarPlot.jsx';
import PolarControls from './PolarControls.jsx';
import { PEAK_COLORS } from '../Spectrum/peakColors.js';
import { getPlotData } from '../../services/pyBridge.js';

/** Revolution legend — colored lines with labels, rendered outside the Plotly canvas. */
function PolarLegend({ revolutions }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {revolutions.map((_, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 16, height: 3, bgcolor: PEAK_COLORS[i % PEAK_COLORS.length], borderRadius: 1 }} />
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            Rev {i + 1}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const TAB_DEFS_BASE = [
  { id: 'advanced', label: 'Config' },
  { id: 'histogram', label: 'Histogram' },
];
const TAB_POLAR = { id: 'polar', label: 'Polar' };
// { id: 'lissajous', label: 'Lissajous' },

const DEFAULT_POLAR_REVS = 2;

export default function PlotTabs({ available, processing, onReanalyze, currentOpts, rpmInfo }) {
  const [activeTab, setActiveTab] = useState(null);
  const [plotCache, setPlotCache] = useState({});
  const [containerWidth, setContainerWidth] = useState(0);
  const [minimized, setMinimized] = useState(true);
  const containerRef = useRef(null);
  const prevAvailableRef = useRef(null);
  const polarRevsRef = useRef(DEFAULT_POLAR_REVS);

  const hasRpm = rpmInfo?.value != null;
  const tabs = useMemo(() =>
    hasRpm ? [...TAB_DEFS_BASE, TAB_POLAR] : TAB_DEFS_BASE,
    [hasRpm]
  );

  // Reset plot cache and collapse when available changes (new file)
  useEffect(() => {
    if (available !== prevAvailableRef.current) {
      const isNewFile = !prevAvailableRef.current && available;
      prevAvailableRef.current = available;
      setPlotCache({});
      if (isNewFile) {
        setActiveTab(null);
        setMinimized(true);
      }
    }
  }, [available]);

  // Auto-re-plot polar when available changes (re-measure) and polar tab is open
  useEffect(() => {
    if (activeTab !== 'polar' || !available?.polar) return;
    try {
      const data = getPlotData('polar', { revolutions: polarRevsRef.current });
      if (data) setPlotCache(prev => ({ ...prev, polar: data }));
    } catch (e) {
      console.warn('[PlotTabs] polar auto-replot failed:', e);
    }
  }, [available, activeTab]);

  // Measure container — re-run when available or minimized changes (ref may not be in DOM)
  useEffect(() => {
    if (!containerRef.current) return;
    setContainerWidth(containerRef.current.clientWidth);
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [available, minimized]);

  const fetchPolar = useCallback((revs) => {
    const n = typeof revs === 'object' ? revs.revolutions : revs;
    if (!available?.polar || !n) return;
    polarRevsRef.current = n;
    try {
      const data = getPlotData('polar', { revolutions: n });
      if (data) setPlotCache(prev => ({ ...prev, polar: data }));
    } catch (e) {
      console.warn('[PlotTabs] polar fetch failed:', e);
    }
  }, [available]);

  const handleTabChange = useCallback((_, newTab) => {
    const tabId = tabs[newTab]?.id;
    if (!tabId) return;
    setActiveTab(tabId);
    setMinimized(false);

    // Auto-fetch histogram on first click
    if (tabId === 'histogram' && !plotCache.histogram && available?.histogram) {
      try {
        const data = getPlotData('histogram', {});
        if (data) setPlotCache(prev => ({ ...prev, histogram: data }));
      } catch (e) {
        console.warn('[PlotTabs] histogram fetch failed:', e);
      }
    }

    // Auto-plot polar when RPM is known
    if (tabId === 'polar' && available?.polar && !plotCache.polar) {
      fetchPolar(DEFAULT_POLAR_REVS);
    }
  }, [tabs, plotCache, available, fetchPolar]);

  const handleMinimize = useCallback(() => {
    setMinimized(true);
    setActiveTab(null);
  }, []);

  if (!available) return null;

  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Tabs
          value={activeIndex >= 0 ? activeIndex : false}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flex: 1, borderBottom: minimized ? 0 : 1, borderColor: 'divider', minHeight: 36 }}
        >
          {tabs.map(t => (
            <Tab
              key={t.id}
              label={t.label}
              sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }}
            />
          ))}
        </Tabs>
        {!minimized && (
          <IconButton size="small" onClick={handleMinimize} sx={{ mr: 1 }}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {!minimized && (
        <Box ref={containerRef} sx={{ width: '100%' }}>

          {/* Advanced config */}
          {activeTab === 'advanced' && (
            <AdvancedPanel currentOpts={currentOpts} onReanalyze={onReanalyze} rpmInfo={rpmInfo} />
          )}

          {/* Histogram */}
          {activeTab === 'histogram' && (() => {
            const plotW = Math.floor(containerWidth * 2 / 3);
            return (
              <Box sx={{ display: 'flex', width: '100%', pr: 2, pt: 2, pb: 2, boxSizing: 'border-box' }}>
                <Box sx={{ width: '33.33%' }} />
                <Box sx={{ flex: 1 }}>
                  {plotCache.histogram && plotW > 0 && (
                    <HistogramPlot data={plotCache.histogram} width={plotW} height={plotW} />
                  )}
                </Box>
              </Box>
            );
          })()}

          {/* Polar */}
          {activeTab === 'polar' && (() => {
            const polarSize = Math.floor(containerWidth * 2 / 3);
            return (
              <Box sx={{ display: 'flex', width: '100%', pr: 2, pt: 2, pb: 2, boxSizing: 'border-box' }}>
                <Box sx={{ width: '33.33%', p: 2, display: 'flex', flexDirection: 'column', gap: 1, boxSizing: 'border-box' }}>
                  <PolarControls available={available} onPlot={fetchPolar} />
                  {plotCache.polar && (
                    <PolarLegend revolutions={plotCache.polar.revolutions} />
                  )}
                </Box>
                <Box sx={{ flex: 1, height: polarSize }}>
                  {plotCache.polar && polarSize > 0 && (
                    <PolarPlot data={plotCache.polar} width={polarSize} height={polarSize} />
                  )}
                </Box>
              </Box>
            );
          })()}
        </Box>
      )}
    </Paper>
  );
}
