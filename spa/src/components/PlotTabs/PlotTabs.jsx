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
import useResizableHeight from '../ResizeHandle.jsx';


const TAB_DEFS_BASE = [
  { id: 'advanced', label: 'Config' },
  { id: 'histogram', label: 'Histogram' },
];
const TAB_POLAR = { id: 'polar', label: 'Polar' };
// { id: 'lissajous', label: 'Lissajous' },

const DEFAULT_POLAR_REVS = 2;
const DEFAULT_TAB_HEIGHT = 640;
const STORAGE_KEY_TAB_HEIGHT = 'plotTabsHeight';

export default function PlotTabs({ available, processing, onReanalyze, currentOpts, rpmInfo }) {
  const [activeTab, setActiveTab] = useState(null);
  const [plotCache, setPlotCache] = useState({});
  const [containerWidth, setContainerWidth] = useState(0);
  const [minimized, setMinimized] = useState(true);
  const containerRef = useRef(null);
  // Max card height = max square plot + overhead (tab bar + resize bar + padding)
  const isMobile = containerWidth > 0 && containerWidth < 600;
  const CONTROLS_W = isMobile ? 80 : 160;
  const PLOT_MARGINS = isMobile ? 24 : 48; // left margin + right margin
  const OVERHEAD = 78;
  const maxPlotSquare = Math.max(200, containerWidth - CONTROLS_W - PLOT_MARGINS);
  const maxTabHeight = maxPlotSquare + OVERHEAD;
  const { plotHeight: tabHeightStored, ResizeBar } = useResizableHeight(STORAGE_KEY_TAB_HEIGHT, DEFAULT_TAB_HEIGHT, maxTabHeight);
  const tabHeight = Math.min(tabHeightStored, maxTabHeight);

  const prevAvailableRef = useRef(null);
  const [polarRevs, setPolarRevs] = useState(DEFAULT_POLAR_REVS);

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
      setPolarRevs(DEFAULT_POLAR_REVS);
      if (isNewFile) {
        setActiveTab(null);
        setMinimized(true);
      }
    }
  }, [available]);

  // Auto-re-plot polar when available changes (re-measure) and polar tab is open
  // Clamp revs to new max if needed
  useEffect(() => {
    if (activeTab !== 'polar' || !available?.polar) return;
    const maxRevs = available.polar.max_revolutions ?? 10;
    const revs = Math.min(polarRevs, maxRevs);
    if (revs !== polarRevs) setPolarRevs(revs);
    try {
      const data = getPlotData('polar', { revolutions: revs });
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

  const handleRevsChange = useCallback((revs) => {
    const n = Number(revs);
    if (!available?.polar || !n) return;
    setPolarRevs(n);
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
      handleRevsChange(polarRevs);
    }
  }, [tabs, plotCache, available, handleRevsChange, polarRevs]);

  const handleMinimize = useCallback(() => {
    setMinimized(true);
    setActiveTab(null);
  }, []);

  if (!available) return null;

  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden', ...(minimized ? {} : { height: tabHeight, display: 'flex', flexDirection: 'column' }) }}>
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
        <Box ref={containerRef} sx={{ width: '100%', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {(() => {
            // Available height for plot content
            const contentHeight = tabHeight - OVERHEAD;
            const plotSize = Math.max(100, contentHeight);
            // Right margin = card padding (16px), left margin of plot = 2× that (shrink on mobile)
            const PLOT_LEFT_MARGIN = isMobile ? 8 : 32;
            const PLOT_RIGHT_MARGIN = 16;
            // containerWidth is the full card inner width. Plot area = containerWidth - CONTROLS_W.
            // Within the plot area, we have left margin + plot + right margin.
            const plotAreaWidth = containerWidth - CONTROLS_W;
            const plotWidth = Math.max(100, plotAreaWidth - PLOT_LEFT_MARGIN - PLOT_RIGHT_MARGIN);
            // Square: use the smaller of available height and width
            const squareSize = Math.min(plotSize, plotWidth);

            return <>
              {/* Advanced config */}
              {activeTab === 'advanced' && (
                <AdvancedPanel currentOpts={currentOpts} onReanalyze={onReanalyze} rpmInfo={rpmInfo} />
              )}

              {/* Histogram */}
              {activeTab === 'histogram' && (
                <Box sx={{ display: 'flex', width: '100%', height: '100%', boxSizing: 'border-box' }}>
                  <Box sx={{ width: CONTROLS_W, flexShrink: 0 }} />
                  <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', pr: { xs: 1, sm: 2 }, pt: 1 }}>
                    {plotCache.histogram && squareSize > 0 && (
                      <HistogramPlot data={plotCache.histogram} width={squareSize} height={squareSize} />
                    )}
                  </Box>
                </Box>
              )}

              {/* Polar */}
              {activeTab === 'polar' && (
                <Box sx={{ display: 'flex', width: '100%', height: '100%', boxSizing: 'border-box' }}>
                  <Box sx={{ width: CONTROLS_W, flexShrink: 0, p: isMobile ? 1 : 2, display: 'flex', flexDirection: 'column', gap: 1, boxSizing: 'border-box' }}>
                    <PolarControls available={available} revolutions={polarRevs} onRevsChange={handleRevsChange} plotData={plotCache.polar} />
                  </Box>
                  <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', pr: { xs: 1, sm: 2 }, pt: 1 }}>
                    {plotCache.polar && squareSize > 0 && (
                      <PolarPlot data={plotCache.polar} width={squareSize} height={squareSize} />
                    )}
                  </Box>
                </Box>
              )}
            </>;
          })()}
        </Box>
      )}
      {!minimized && <ResizeBar />}
    </Paper>
  );
}
