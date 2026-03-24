/**
 * Spectrum container — log-frequency spectrum plot with peak selection.
 *
 * Architecture mirrors Waveform.jsx:
 * - Scrollable wrapper for native touch momentum
 * - Canvas plot with position: sticky
 * - Overview bar above, freq axis below
 * - Gesture state machine prevents conflicting interactions
 * - Fully responsive via ResizeObserver
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Box, Paper, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import SpectrumPlot from './SpectrumPlot.jsx';
import SpectrumOverview from './SpectrumOverview.jsx';
import FreqAxis, { AXIS_HEIGHT } from './FreqAxis.jsx';
import AmplitudeAxis from './AmplitudeAxis.jsx';
import PeakChips from './PeakChips.jsx';
import useSpectrumData, { getAmpScale } from './useSpectrumData.js';
import useSpectrumNavigation from './useSpectrumNavigation.js';
import useResizableHeight from '../ResizeHandle.jsx';
import { SPECTRUM_MIN_FREQ } from '../../config/constants.js';
import useMediaQuery from '@mui/material/useMediaQuery';

const DEFAULT_HEIGHT = 240;
const STORAGE_KEY = 'spectrumHeight';
const AXIS_WIDTH_DESKTOP = 52;
const AXIS_WIDTH_MOBILE = 36;
const EPSILON = 0.001;

function logF(f) {
  return Math.log10(Math.max(f, SPECTRUM_MIN_FREQ));
}

function isViewZoomed(fMin, fMax, dFMin, dFMax) {
  return logF(fMin) > logF(dFMin) + EPSILON || logF(fMax) < logF(dFMax) - EPSILON;
}

export default function Spectrum({ spectrumData, onHarmonicSelect, processing = false }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const AXIS_WIDTH = isMobile ? AXIS_WIDTH_MOBILE : AXIS_WIDTH_DESKTOP;

  // Resizable plot height — drag bottom border of card
  const { plotHeight, ResizeBar } = useResizableHeight(STORAGE_KEY, DEFAULT_HEIGHT);
  const totalHeight = plotHeight + AXIS_HEIGHT;

  const freqs = spectrumData?.freqs;
  const amplitude = spectrumData?.amplitude;
  const peaks = spectrumData?.peaks || [];

  // Data bounds
  const dataFMin = freqs?.length ? Math.max(freqs[0], SPECTRUM_MIN_FREQ) : SPECTRUM_MIN_FREQ;
  const dataFMax = freqs?.length ? freqs[freqs.length - 1] : 100;

  // View state (frequencies in Hz)
  const [viewFMin, setViewFMin] = useState(dataFMin);
  const [viewFMax, setViewFMax] = useState(dataFMax);
  const viewFMinRef = useRef(viewFMin);
  viewFMinRef.current = viewFMin;
  const viewFMaxRef = useRef(viewFMax);
  viewFMaxRef.current = viewFMax;

  // Peak selection
  const [selectedPeakIndices, setSelectedPeakIndices] = useState([]);

  // Log/linear Y-axis toggle
  const [logAmpScale, setLogAmpScale] = useState(false);

  // Container width
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const gestureRef = useRef('idle');
  const widthRef = useRef(containerWidth);
  widthRef.current = containerWidth;

  // Reset view when new data arrives
  // Reset view only on new file (spectrumData goes null then repopulates).
  // Re-measure keeps viewport and selection.
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (!freqs?.length) {
      hadDataRef.current = false;
      return;
    }
    const fMin = Math.max(freqs[0], SPECTRUM_MIN_FREQ);
    const fMax = freqs[freqs.length - 1];
    setViewFMin(fMin);
    setViewFMax(fMax);
    setSelectedPeakIndices([]);
    hadDataRef.current = true;
  }, [freqs]);

  const hasData = !!(freqs && amplitude);

  // Lock Y-axis from full data
  const [lockedAmpMax, setLockedAmpMax] = useState(null);
  useEffect(() => {
    if (!amplitude) { setLockedAmpMax(null); return; }
    const { ampMax } = getAmpScale(amplitude);
    setLockedAmpMax(ampMax);
  }, [amplitude]);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasData]);

  const handleViewChange = useCallback((fMin, fMax) => {
    setViewFMin(fMin);
    setViewFMax(fMax);
  }, []);

  // Spectrum data hook
  const spData = useSpectrumData({
    freqs,
    amplitude,
    viewFMin,
    viewFMax,
    width: containerWidth,
    height: plotHeight,
    lockedAmpMax,
    logAmpScale,
  });

  // Navigation gestures
  const {
    scrollCausedViewChangeRef,
    programmaticScrollRef,
    zoomIn,
    zoomOut,
    resetZoom,
    isZoomed: gestureIsZoomed,
    isMaxZoom,
  } = useSpectrumNavigation({
    containerRef,
    scrollRef,
    viewFMin,
    viewFMax,
    dataFMin,
    dataFMax,
    containerWidth,
    onViewChange: handleViewChange,
    gestureRef,
    hasData,
  });

  // View → scroll sync
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (gestureRef.current === 'overviewDrag') return;
    if (scrollCausedViewChangeRef.current) {
      scrollCausedViewChangeRef.current = false;
      return;
    }
    const logMin = logF(viewFMin);
    const logMax = logF(viewFMax);
    const logDur = logMax - logMin;
    const totalLogRange = logF(dataFMax) - logF(dataFMin);
    const w = containerWidth;
    if (totalLogRange <= 0 || w <= 0 || logDur >= totalLogRange - EPSILON) {
      el.scrollLeft = 0;
      return;
    }
    const spacerW = w * (totalLogRange / logDur);
    const maxScroll = spacerW - w;
    programmaticScrollRef.current = true;
    el.scrollLeft = ((logMin - logF(dataFMin)) / (totalLogRange - logDur)) * maxScroll;
  }, [viewFMin, viewFMax, dataFMin, dataFMax, containerWidth]);

  // Overview gesture callbacks
  const handleOverviewGestureStart = useCallback(() => {
    gestureRef.current = 'overviewDrag';
  }, []);

  const handleOverviewGestureEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      const logMin = logF(viewFMinRef.current);
      const logMax = logF(viewFMaxRef.current);
      const logDur = logMax - logMin;
      const totalLogRange = logF(dataFMax) - logF(dataFMin);
      const w = widthRef.current;
      if (totalLogRange > 0 && w > 0 && logDur < totalLogRange - EPSILON) {
        const spacerW = w * (totalLogRange / logDur);
        const maxSL = spacerW - w;
        programmaticScrollRef.current = true;
        el.scrollLeft = ((logMin - logF(dataFMin)) / (totalLogRange - logDur)) * maxSL;
      }
    }
    gestureRef.current = 'idle';
  }, [dataFMin, dataFMax]);

  // Peak selection toggle
  const handleTogglePeak = useCallback((peakIdx) => {
    setSelectedPeakIndices(prev => {
      const next = prev.includes(peakIdx)
        ? prev.filter(i => i !== peakIdx)
        : [...prev, peakIdx];
      return next;
    });
  }, []);

  // Notify parent of selection changes — use ref for callback to avoid infinite loop
  const onHarmonicSelectRef = useRef(onHarmonicSelect);
  onHarmonicSelectRef.current = onHarmonicSelect;
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;

  useEffect(() => {
    if (!onHarmonicSelectRef.current) return;
    // Double-rAF: first rAF queues after layout, second fires after paint
    const rafId = requestAnimationFrame(() => {
      const rafId2 = requestAnimationFrame(() => {
        const selectedFreqs = selectedPeakIndices.map(i => peaksRef.current[i]?.freq).filter(Boolean);
        onHarmonicSelectRef.current(selectedFreqs, selectedPeakIndices);
      });
      cleanupRef.current = rafId2;
    });
    const cleanupRef = { current: null };
    return () => {
      cancelAnimationFrame(rafId);
      if (cleanupRef.current) cancelAnimationFrame(cleanupRef.current);
    };
  }, [selectedPeakIndices]);

  const isZoomed = isViewZoomed(viewFMin, viewFMax, dataFMin, dataFMax);
  const logDur = logF(viewFMax) - logF(viewFMin);
  const totalLogRange = logF(dataFMax) - logF(dataFMin);

  const spacerWidth = isZoomed && logDur > 0
    ? containerWidth * (totalLogRange / logDur)
    : containerWidth;

  if (!hasData) return null;

  return (
    <Paper sx={{ pt: { xs: 1, sm: 2 }, px: { xs: 1, sm: 2 }, pb: 0, width: '100%', overflow: 'hidden' }}>
      {/* Overview bar */}
      <Box sx={{ ml: `${AXIS_WIDTH}px` }}>
        <SpectrumOverview
          freqs={freqs}
          amplitude={amplitude}
          dataFMin={dataFMin}
          dataFMax={dataFMax}
          viewFMin={viewFMin}
          viewFMax={viewFMax}
          logAmpScale={logAmpScale}
          onViewChange={handleViewChange}
          onGestureStart={handleOverviewGestureStart}
          onGestureEnd={handleOverviewGestureEnd}
        />
      </Box>

      {/* Main spectrum area: Y-axis + scrollable canvas */}
      <Box sx={{ display: 'flex', width: '100%', position: 'relative' }}>
        {/* Y-axis label — rotated, positioned in card's left padding, centered on plot canvas */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            position: 'absolute',
            left: -14,
            top: plotHeight / 2,
            transform: 'rotate(-90deg) translateX(-50%)',
            transformOrigin: '0 0',
            whiteSpace: 'nowrap',
            fontSize: '0.55rem',
            opacity: 0.5,
            letterSpacing: 0.3,
            display: { xs: 'none', sm: 'block' },
          }}
        >
          Deviation (% RMS/√Hz)
        </Typography>
        <AmplitudeAxis
          ampMin={spData.ampMin}
          ampMax={spData.ampMax}
          height={plotHeight}
          logScale={logAmpScale}
          ampToY={spData.ampToY}
          width={AXIS_WIDTH}
        />

        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            userSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
            overscrollBehaviorX: 'none',
            touchAction: 'pan-y',
            cursor: 'pointer',
            border: `1px solid ${theme.palette.divider}`,
            borderTop: 'none',
            minHeight: totalHeight,
          }}
        >
          {containerWidth > 0 && (
            <Box
              ref={scrollRef}
              sx={{
                width: '100%',
                height: totalHeight,
                overflowX: isZoomed ? 'scroll' : 'hidden',
                overflowY: 'hidden',
                overscrollBehaviorX: 'none',
                WebkitOverflowScrolling: 'touch',
                touchAction: isZoomed ? 'pan-x pan-y' : 'pan-y',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              <div style={{ width: spacerWidth, height: totalHeight }}>
                <SpectrumPlot
                  freqs={freqs}
                  amplitude={amplitude}
                  peaks={peaks}
                  selectedPeakIndices={selectedPeakIndices}
                  startIdx={spData.startIdx}
                  endIdx={spData.endIdx}
                  ampMin={spData.ampMin}
                  ampMax={spData.ampMax}
                  freqToX={spData.freqToX}
                  ampToY={spData.ampToY}
                  width={containerWidth}
                  height={plotHeight}
                  logAmpScale={logAmpScale}
                  onResetZoom={resetZoom}
                />

                <FreqAxis
                  viewFMin={viewFMin}
                  viewFMax={viewFMax}
                  width={containerWidth}
                />
              </div>
            </Box>
          )}
        </Box>
      </Box>

      {/* Peak chips — disabled, kept for future lissajous wiring */}
      {/* <Box sx={{ ml: `${AXIS_WIDTH}px` }}>
        <PeakChips
          peaks={peaks}
          selectedPeakIndices={selectedPeakIndices}
          onTogglePeak={handleTogglePeak}
        />
      </Box> */}

      {/* Toolbar — scale toggle + zoom controls */}
      <Box
        sx={{
          ml: `${AXIS_WIDTH}px`,
          mt: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Tooltip title={logAmpScale ? 'Switch to linear scale' : 'Switch to log (dB) scale'}>
          <IconButton
            onClick={() => setLogAmpScale(prev => !prev)}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 'bold', minWidth: 32 }}
          >
            {logAmpScale ? 'LIN' : 'LOG'}
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        <Tooltip title="Zoom in (+)">
          <span>
            <IconButton onClick={zoomIn} disabled={isMaxZoom} size="small">
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Zoom out (-)">
          <span>
            <IconButton onClick={zoomOut} disabled={!isZoomed} size="small">
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Reset zoom (0)">
          <span>
            <IconButton onClick={resetZoom} disabled={!isZoomed} size="small">
              <ZoomOutMapIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <ResizeBar />
    </Paper>
  );
}
