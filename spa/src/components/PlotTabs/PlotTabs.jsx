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
import usePlotLayout from './usePlotLayout.js';
import { getPlotData } from '../../services/pyBridge.js';
import useResizableHeight from '../ResizeHandle.jsx';


const TAB_POLAR = { id: 'polar', label: 'Polar' };
const TAB_DEFS_BASE = [
  { id: 'histogram', label: 'Histogram' },
  { id: 'advanced', label: 'Config' },
];
// { id: 'lissajous', label: 'Lissajous' },

const DEFAULT_POLAR_REVS = 2;
const DEFAULT_TAB_HEIGHT = 640;
const STORAGE_KEY_TAB_HEIGHT = 'plotTabsHeight';
const STORAGE_KEY_POLAR_LP = 'polarLpHz';
const POLAR_LP_OPTIONS = [60, 100, 150, 200, 0];
const DEFAULT_POLAR_LP = 60;

export default function PlotTabs({ available, processing, onReanalyze, currentOpts, rpmInfo, fmBwInfo, inputType }) {
  const [activeTab, setActiveTab] = useState(null);
  const [plotCache, setPlotCache] = useState({});
  const [minimized, setMinimized] = useState(true);
  const containerRef = useRef(null);

  // Sizing — hook measures container + plot area, computes square size
  const { containerWidth, squareSize: rawSquare, maxTabHeight, isMobile, plotAreaRef, controlsRef, OVERHEAD } = usePlotLayout(containerRef, DEFAULT_TAB_HEIGHT, minimized);
  const { plotHeight: tabHeightStored, ResizeBar } = useResizableHeight(STORAGE_KEY_TAB_HEIGHT, DEFAULT_TAB_HEIGHT, maxTabHeight);
  const tabHeight = Math.min(tabHeightStored, maxTabHeight);
  const contentHeight = Math.max(100, tabHeight - OVERHEAD);
  const squareSize = rawSquare > 0 ? Math.min(contentHeight, rawSquare) : contentHeight;

  const prevAvailableRef = useRef(null);
  const [polarRevs, setPolarRevs] = useState(DEFAULT_POLAR_REVS);
  const [polarLayout, setPolarLayout] = useState(null);
  const [polarLpHz, setPolarLpHz] = useState(() => {
    try {
      const val = parseInt(localStorage.getItem(STORAGE_KEY_POLAR_LP), 10);
      if (POLAR_LP_OPTIONS.includes(val)) return val;
    } catch {}
    return DEFAULT_POLAR_LP;
  });

  const hasRpm = rpmInfo?.value != null;
  const tabs = useMemo(() =>
    hasRpm ? [TAB_POLAR, ...TAB_DEFS_BASE] : TAB_DEFS_BASE,
    [hasRpm]
  );

  // Reset plot cache and collapse when available changes (new file)
  useEffect(() => {
    if (available !== prevAvailableRef.current) {
      const isNewFile = !prevAvailableRef.current && available;
      prevAvailableRef.current = available;
      setPlotCache({});
      setPolarRevs(DEFAULT_POLAR_REVS);
      setPolarLayout(null);
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
      const data = getPlotData('polar', { revolutions: revs, polar_lp: polarLpHz });
      if (data) setPlotCache(prev => ({ ...prev, polar: data }));
    } catch (e) {
      console.warn('[PlotTabs] polar auto-replot failed:', e);
    }
  }, [available, activeTab, polarLpHz]);


  const handleRevsChange = useCallback((revs) => {
    const n = Number(revs);
    if (!available?.polar || !n) return;
    setPolarRevs(n);
    try {
      const data = getPlotData('polar', { revolutions: n, polar_lp: polarLpHz });
      if (data) setPlotCache(prev => ({ ...prev, polar: data }));
    } catch (e) {
      console.warn('[PlotTabs] polar fetch failed:', e);
    }
  }, [available, polarLpHz]);

  const handlePolarLpChange = useCallback((val) => {
    const n = Number(val);
    if (!POLAR_LP_OPTIONS.includes(n)) return;
    setPolarLpHz(n);
    try { localStorage.setItem(STORAGE_KEY_POLAR_LP, String(n)); } catch {}
    // Re-fetch polar if tab is open
    if (available?.polar) {
      try {
        const data = getPlotData('polar', { revolutions: polarRevs, polar_lp: n });
        if (data) setPlotCache(prev => ({ ...prev, polar: data }));
      } catch (e) {
        console.warn('[PlotTabs] polar LP re-fetch failed:', e);
      }
    }
  }, [available, polarRevs]);

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
      <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: minimized ? 0 : 1, borderColor: 'divider' }}>
        <Tabs
          value={activeIndex >= 0 ? activeIndex : false}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flex: 1, minHeight: 36 }}
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
        <Box ref={containerRef} sx={{ flex: 1, overflow: 'hidden', minHeight: 0, pr: { xs: 1, sm: 2 } }}>
          {activeTab === 'advanced' && (
            <AdvancedPanel
              currentOpts={currentOpts}
              onReanalyze={onReanalyze}
              rpmInfo={rpmInfo}
              fmBwInfo={fmBwInfo}
              inputType={inputType}
              polarLpHz={polarLpHz}
              polarLpOptions={POLAR_LP_OPTIONS}
              onPolarLpChange={handlePolarLpChange}
            />
          )}

          {activeTab === 'histogram' && (
            <Box ref={plotAreaRef} sx={{ display: 'flex', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
              {plotCache.histogram && squareSize > 0 && (
                <HistogramPlot data={plotCache.histogram} width={squareSize} height={squareSize} />
              )}
            </Box>
          )}

          {activeTab === 'polar' && (
            <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>
              <Box ref={controlsRef} sx={{ flexShrink: 0, p: isMobile ? 1 : 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <PolarControls available={available} revolutions={polarRevs} onRevsChange={handleRevsChange} plotData={plotCache.polar} />
              </Box>
              <Box ref={plotAreaRef} sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', pt: isMobile ? 1 : 2 }}>
                {plotCache.polar && squareSize > 0 && (
                  <PolarPlot data={plotCache.polar} width={squareSize} height={squareSize} polarLpHz={polarLpHz} savedLayout={polarLayout} onLayoutChange={setPolarLayout} />
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}
      {!minimized && <ResizeBar />}
    </Paper>
  );
}
