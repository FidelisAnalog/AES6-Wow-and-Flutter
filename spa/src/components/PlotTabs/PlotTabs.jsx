/**
 * Tabbed container: Advanced config, Histogram, Polar, (future: Lissajous).
 * Advanced tab has transport/RPM/motor params.
 * Plot tabs auto-fetch or have controls.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Paper, Tabs, Tab, Box, Typography } from '@mui/material';
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

const TAB_DEFS = [
  { id: 'advanced', label: 'Advanced' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'polar', label: 'Polar' },
  // { id: 'lissajous', label: 'Lissajous' },
];

export default function PlotTabs({ available, processing, onReanalyze, currentOpts }) {
  const [activeTab, setActiveTab] = useState(null);
  const [plotCache, setPlotCache] = useState({});
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef(null);
  const prevAvailableRef = useRef(null);

  // All tabs always visible
  const tabs = TAB_DEFS;

  // Reset plot cache when available changes (new file or re-measure)
  useEffect(() => {
    if (available !== prevAvailableRef.current) {
      prevAvailableRef.current = available;
      setPlotCache({});
    }
  }, [available]);

  // Measure container — re-run when available changes (component returns null until available)
  useEffect(() => {
    if (!containerRef.current) return;
    setContainerWidth(containerRef.current.clientWidth);
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [available]);

  const handleTabChange = useCallback((_, newTab) => {
    const tabId = tabs[newTab]?.id;
    if (!tabId) return;
    setActiveTab(tabId);

    // Auto-fetch histogram on first click
    if (tabId === 'histogram' && !plotCache.histogram && available?.histogram) {
      try {
        const data = getPlotData('histogram', {});
        if (data) setPlotCache(prev => ({ ...prev, histogram: data }));
      } catch (e) {
        console.warn('[PlotTabs] histogram fetch failed:', e);
      }
    }
  }, [tabs, plotCache, available]);

  // Polar plot button handler — just fetches data (RPM already set via Advanced)
  const handlePolarPlot = useCallback(({ revolutions }) => {
    if (!available?.polar) return;
    try {
      const data = getPlotData('polar', { revolutions });
      if (data) setPlotCache(prev => ({ ...prev, polar: data }));
    } catch (e) {
      console.warn('[PlotTabs] polar fetch failed:', e);
    }
  }, [available]);

  if (!available) return null;

  const plotSize = Math.round((containerWidth || 400) * 0.6);
  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Tabs
        value={activeIndex >= 0 ? activeIndex : false}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36 }}
      >
        {tabs.map(t => (
          <Tab
            key={t.id}
            label={t.label}
            sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }}
          />
        ))}
      </Tabs>

      <Box ref={containerRef} sx={{ width: '100%' }}>
        {!activeTab && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 80 }}>
            <Typography variant="body2" color="text.secondary">
              Select a tab
            </Typography>
          </Box>
        )}

        {/* Advanced config */}
        {activeTab === 'advanced' && (
          <AdvancedPanel currentOpts={currentOpts} onReanalyze={onReanalyze} />
        )}

        {/* Histogram — same layout as polar: left 1/3 empty, right 2/3 plot */}
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

        {/* Polar — controls+legend on left, square plot on right */}
        {activeTab === 'polar' && (() => {
          const polarSize = Math.floor(containerWidth * 2 / 3);
          return (
            <Box sx={{ display: 'flex', width: '100%', pr: 2, pt: 2, pb: 2, boxSizing: 'border-box' }}>
              {/* Left 1/3: controls + legend */}
              <Box sx={{ width: '33.33%', p: 2, display: 'flex', flexDirection: 'column', gap: 1, boxSizing: 'border-box' }}>
                <PolarControls available={available} onPlot={handlePolarPlot} />
                {plotCache.polar && (
                  <PolarLegend revolutions={plotCache.polar.revolutions} />
                )}
              </Box>
              {/* Right 2/3: square plot */}
              <Box sx={{ flex: 1, height: polarSize }}>
                {plotCache.polar && polarSize > 0 && (
                  <PolarPlot data={plotCache.polar} width={polarSize} height={polarSize} />
                )}
              </Box>
            </Box>
          );
        })()}
      </Box>
    </Paper>
  );
}
