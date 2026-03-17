/* gesture-v1 */
/**
 * Waveform container — adapted from Browser-ABX Waveform.jsx.
 *
 * Architecture:
 * - Scrollable wrapper provides native touch momentum (iOS)
 * - Canvas main view renders inside scroll wrapper (position: sticky)
 * - Handle overlays are OUTSIDE scroll wrapper (absolute positioned)
 * - Native scroll ↔ view two-way sync via useLayoutEffect
 * - Gesture state machine prevents conflicting interactions
 * - Overview bar above main view, visible when zoomed
 * - DeviationAxis to the left, TimeAxis below the canvas
 * - Fully responsive via ResizeObserver
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Box, Paper, Button, CircularProgress, useTheme } from '@mui/material';
import WaveformMain from './WaveformMain.jsx';
import WaveformOverview from './WaveformOverview.jsx';
import LoopHandles from './LoopHandles.jsx';
import TimeAxis, { TIMELINE_HEIGHT } from './TimeAxis.jsx';
import DeviationAxis from './DeviationAxis.jsx';
import useWaveformData, { getYScale } from './useWaveformData.js';
import useWaveformGestures from './useWaveformGestures.js';

const MAIN_HEIGHT = 280;
const TOTAL_HEIGHT = MAIN_HEIGHT + TIMELINE_HEIGHT;
const AXIS_WIDTH = 52;
const EPSILON = 0.001;

function isViewZoomed(vs, ve, dur) {
  return vs > EPSILON || ve < dur - EPSILON;
}

export default function Waveform({
  tUniform,
  deviationPct,
  wfPeak2Sigma,
  totalDuration,
  harmonicOverlays = [],
  processing = false,
  onMeasureRegion,
}) {
  const theme = useTheme();

  // View state
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(totalDuration || 1);
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewEndRef = useRef(viewEnd);
  viewEndRef.current = viewEnd;

  // Loop handles
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(totalDuration || 1);

  // Container width
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const gestureRef = useRef('idle');

  const widthRef = useRef(containerWidth);
  widthRef.current = containerWidth;

  // Reset view when new data arrives
  useEffect(() => {
    if (totalDuration) {
      setViewStart(0);
      setViewEnd(totalDuration);
      setLoopStart(0);
      setLoopEnd(totalDuration);
    }
  }, [totalDuration]);

  const hasData = !!(tUniform && deviationPct);

  // Lock Y-axis bounds from full-file data so they don't jump while panning/zooming
  const [lockedYBounds, setLockedYBounds] = useState(null);
  useEffect(() => {
    if (!deviationPct) { setLockedYBounds(null); return; }
    const { yMax } = getYScale(deviationPct, null, wfPeak2Sigma);
    setLockedYBounds(yMax);
  }, [deviationPct, wfPeak2Sigma]);

  // Measure container width — re-run when data arrives (ref may be null on first render)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasData]);

  const handleViewChange = useCallback((s, e) => {
    setViewStart(s);
    setViewEnd(e);
  }, []);

  const handleLoopChange = useCallback((s, e) => {
    setLoopStart(s);
    setLoopEnd(e);
  }, []);

  // Waveform data hook
  const wfData = useWaveformData({
    tUniform,
    deviationPct,
    viewStart,
    viewEnd,
    width: containerWidth,
    height: MAIN_HEIGHT,
    yBoundsExplicit: lockedYBounds,
    wfPeak2Sigma,
  });

  // Gesture binding
  const { scrollCausedViewChangeRef, programmaticScrollRef } = useWaveformGestures({
    containerRef,
    scrollRef,
    viewStart,
    viewEnd,
    totalDuration,
    containerWidth,
    onViewChange: handleViewChange,
    gestureRef,
    hasData,
  });

  // --- View → scroll sync (useLayoutEffect, same pattern as Browser-ABX) ---
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (gestureRef.current === 'overviewDrag') return;
    if (scrollCausedViewChangeRef.current) {
      scrollCausedViewChangeRef.current = false;
      return;
    }
    const dur = totalDuration;
    const viewDur = viewEnd - viewStart;
    const w = containerWidth;
    if (dur <= 0 || w <= 0 || viewDur >= dur - EPSILON) {
      el.scrollLeft = 0;
      return;
    }
    const spacerW = w * (dur / viewDur);
    const maxScroll = spacerW - w;
    programmaticScrollRef.current = true;
    el.scrollLeft = (viewStart / (dur - viewDur)) * maxScroll;
  }, [viewStart, viewEnd, totalDuration, containerWidth]);

  // Overview bar gesture callbacks
  const handleOverviewGestureStart = useCallback(() => {
    gestureRef.current = 'overviewDrag';
  }, []);

  const handleOverviewGestureEnd = useCallback(() => {
    // Write correct scrollLeft BEFORE clearing overviewDrag
    const el = scrollRef.current;
    if (el) {
      const dur = totalDuration;
      const vs = viewStartRef.current;
      const ve = viewEndRef.current;
      const viewDur = ve - vs;
      const w = widthRef.current;
      if (dur > 0 && w > 0 && viewDur < dur - EPSILON) {
        const spacerW = w * (dur / viewDur);
        const maxSL = spacerW - w;
        programmaticScrollRef.current = true;
        el.scrollLeft = (vs / (dur - viewDur)) * maxSL;
      }
    }
    gestureRef.current = 'idle';
  }, [totalDuration]);

  // Re-measure logic
  const isFullFile = loopStart <= EPSILON && loopEnd >= (totalDuration || 1) - EPSILON;
  const showMeasure = !isFullFile;

  const isZoomed = isViewZoomed(viewStart, viewEnd, totalDuration);
  const viewDur = viewEnd - viewStart;

  // Spacer width for native scroll — proportional to zoom ratio
  const spacerWidth = isZoomed && viewDur > 0
    ? containerWidth * (totalDuration / viewDur)
    : containerWidth;

  if (!hasData) return null;

  return (
    <Paper sx={{ p: 2, width: '100%', overflow: 'hidden' }}>
      {/* Overview bar — above main view */}
      <Box sx={{ ml: `${AXIS_WIDTH}px` }}>
        <WaveformOverview
          tUniform={tUniform}
          deviationPct={deviationPct}
          totalDuration={totalDuration}
          viewStart={viewStart}
          viewEnd={viewEnd}
          wfPeak2Sigma={wfPeak2Sigma}
          loopStart={loopStart}
          loopEnd={loopEnd}
          onViewChange={handleViewChange}
          onGestureStart={handleOverviewGestureStart}
          onGestureEnd={handleOverviewGestureEnd}
        />
      </Box>

      {/* Main waveform area: Y-axis + scrollable canvas + handle overlays */}
      <Box sx={{ display: 'flex', width: '100%' }}>
        {/* Y-axis */}
        <DeviationAxis
          yMin={wfData.yMin}
          yMax={wfData.yMax}
          height={TOTAL_HEIGHT}
        />

        {/* Main area container — holds scroll wrapper and handle overlays */}
        <Box
          ref={containerRef}
          data-waveform-container
          sx={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            userSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
            overscrollBehaviorX: 'none',
            touchAction: 'none',
            cursor: 'pointer',
            border: `1px solid ${theme.palette.divider}`,
            borderTop: 'none',
            minHeight: TOTAL_HEIGHT,
          }}
        >
          {containerWidth > 0 && <>
            {/* Scrollable wrapper — provides native touch momentum on iOS */}
            <Box
              ref={scrollRef}
              sx={{
                width: '100%',
                height: TOTAL_HEIGHT,
                overflowX: isZoomed ? 'scroll' : 'hidden',
                overflowY: 'hidden',
                overscrollBehaviorX: 'none',
                WebkitOverflowScrolling: 'touch',
                touchAction: isZoomed ? 'pan-x' : 'none',
                overscrollBehaviorX: 'none',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              <div style={{ width: spacerWidth, height: TOTAL_HEIGHT }}>
                {/* Canvas waveform (sticky so it stays visible while scrolling) */}
                <WaveformMain
                  tUniform={tUniform}
                  deviationPct={deviationPct}
                  viewStart={viewStart}
                  viewEnd={viewEnd}
                  wfPeak2Sigma={wfPeak2Sigma}
                  harmonicOverlays={harmonicOverlays}
                  loopStart={loopStart}
                  loopEnd={loopEnd}
                  totalDuration={totalDuration}
                  startIdx={wfData.startIdx}
                  endIdx={wfData.endIdx}
                  yMin={wfData.yMin}
                  yMax={wfData.yMax}
                  timeToX={wfData.timeToX}
                  deviationToY={wfData.deviationToY}
                  width={containerWidth}
                  height={MAIN_HEIGHT}
                />

                {/* Timeline */}
                <TimeAxis
                  viewStart={viewStart}
                  viewEnd={viewEnd}
                  width={containerWidth}
                />
              </div>
            </Box>

            {/* Handle overlays — OUTSIDE scroll wrapper */}
            <LoopHandles
              loopStart={loopStart}
              loopEnd={loopEnd}
              totalDuration={totalDuration}
              containerWidth={containerWidth}
              containerHeight={MAIN_HEIGHT}
              timeToX={wfData.timeToX}
              xToTime={wfData.xToTime}
              gestureRef={gestureRef}
              onLoopChange={handleLoopChange}
            />
          </>}
        </Box>
      </Box>

      {/* Re-measure button */}
      {showMeasure && (
        <Box sx={{ ml: `${AXIS_WIDTH}px`, mt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => onMeasureRegion?.(loopStart, loopEnd)}
            disabled={processing}
            startIcon={processing ? <CircularProgress size={14} /> : null}
          >
            {processing ? 'Measuring...' : 'Measure'}
          </Button>
        </Box>
      )}
    </Paper>
  );
}
