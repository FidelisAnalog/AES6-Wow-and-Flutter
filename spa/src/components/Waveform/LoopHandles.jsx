/**
 * Loop handles — HTML overlay divs for measurement region selection.
 * Adapted from Browser-ABX Waveform.jsx handle pattern.
 *
 * Handles are OUTSIDE the scroll wrapper so they work reliably on touch.
 * Visuals (dimming, shading, lines) rendered by the parent Canvas.
 * This component provides interaction only.
 *
 * Hit areas: 40px outward bias, 4px inward. Mouse gets narrower effective
 * zone (8px centered on handle line) to avoid hijacking clicks near handles.
 */

import { useRef, useCallback } from 'react';
import { Typography, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { MIN_MEASUREMENT_SECONDS, MIN_DRIFT_SECONDS } from '../../config/constants.js';

const HIT_OUTWARD = 40;
const HIT_INWARD = 4;
const HIT_MOUSE = 8;
const EPSILON = 0.001;

export default function LoopHandles({
  loopStart,
  loopEnd,
  totalDuration,
  containerWidth,
  containerHeight,
  timeToX,
  xToTime,
  gestureRef,
  onLoopChange,
}) {
  const theme = useTheme();
  const draggingRef = useRef(null); // 'start' | 'end' | null
  const containerRectRef = useRef(null);

  const loopRegionRef = useRef([loopStart, loopEnd]);
  loopRegionRef.current = [loopStart, loopEnd];
  const onChangeRef = useRef(onLoopChange);
  onChangeRef.current = onLoopChange;
  const durationRef = useRef(totalDuration);
  durationRef.current = totalDuration;

  const isFullFile = loopStart <= EPSILON && loopEnd >= totalDuration - EPSILON;
  const loopDuration = loopEnd - loopStart;
  const showDriftWarning = loopDuration < MIN_DRIFT_SECONDS && !isFullFile;

  const startX = timeToX(loopStart);
  const endX = timeToX(loopEnd);

  // Clamp hit areas to container bounds
  const startHitLeft = Math.max(0, startX - HIT_OUTWARD);
  const startHitRight = Math.min(containerWidth, startX + HIT_INWARD);
  const startHitVisible = startHitRight > startHitLeft;

  const endHitLeft = Math.max(0, endX - HIT_INWARD);
  const endHitRight = Math.min(containerWidth, endX + HIT_OUTWARD);
  const endHitVisible = endHitRight > endHitLeft;

  // --- Pointer handlers ---
  const handlePointerDown = useCallback((handle) => (e) => {
    // For mouse, narrow the effective hit zone
    if (e.pointerType === 'mouse') {
      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const lineX = handle === 'start' ? rect.width - HIT_INWARD : HIT_INWARD;
      if (Math.abs(localX - lineX) > HIT_MOUSE) return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    draggingRef.current = handle;
    gestureRef.current = 'handleDrag';
    containerRectRef.current = e.currentTarget.closest('[data-waveform-container]')?.getBoundingClientRect();
  }, [gestureRef]);

  const handlePointerMove = useCallback((e) => {
    if (!draggingRef.current || !containerRectRef.current) return;
    const x = e.clientX - containerRectRef.current.left;
    const dur = durationRef.current;
    const time = Math.max(0, Math.min(xToTime(x), dur));

    const region = loopRegionRef.current;
    const onChange = onChangeRef.current;

    if (draggingRef.current === 'start') {
      let newStart = Math.max(0, time);
      let newEnd = region[1];
      if (newStart >= newEnd - MIN_MEASUREMENT_SECONDS) {
        newStart = Math.min(newStart, dur - MIN_MEASUREMENT_SECONDS);
        newEnd = Math.min(newStart + MIN_MEASUREMENT_SECONDS, dur);
      }
      onChange(newStart, newEnd);
    } else {
      let newStart = region[0];
      let newEnd = Math.min(dur, time);
      if (newEnd <= newStart + MIN_MEASUREMENT_SECONDS) {
        newEnd = Math.max(newEnd, MIN_MEASUREMENT_SECONDS);
        newStart = Math.max(newEnd - MIN_MEASUREMENT_SECONDS, 0);
      }
      onChange(newStart, newEnd);
    }
  }, [xToTime]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    // Clear gesture after microtask so click event sees handleDrag active
    setTimeout(() => {
      if (gestureRef.current === 'handleDrag') gestureRef.current = 'idle';
    }, 0);
  }, [gestureRef]);

  // Duration label
  const durationLabel = loopDuration < 60
    ? `${loopDuration.toFixed(1)}s`
    : `${Math.floor(loopDuration / 60)}m ${(loopDuration % 60).toFixed(0)}s`;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: containerHeight,
      pointerEvents: 'none',
      overflow: 'visible',
    }}>
      {/* Start handle hit area — biased left (outward) */}
      {startHitVisible && (
        <div
          onPointerDown={handlePointerDown('start')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          style={{
            position: 'absolute',
            left: startHitLeft,
            width: startHitRight - startHitLeft,
            height: '100%',
            cursor: 'default',
            touchAction: 'none',
            pointerEvents: 'auto',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          <div style={{
            position: 'absolute',
            right: 0,
            width: 8,
            height: '100%',
            cursor: 'col-resize',
          }} />
        </div>
      )}

      {/* End handle hit area — biased right (outward) */}
      {endHitVisible && (
        <div
          onPointerDown={handlePointerDown('end')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          style={{
            position: 'absolute',
            left: endHitLeft,
            width: endHitRight - endHitLeft,
            height: '100%',
            cursor: 'default',
            touchAction: 'none',
            pointerEvents: 'auto',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            width: 8,
            height: '100%',
            cursor: 'col-resize',
          }} />
        </div>
      )}

      {/* Duration label */}
      {!isFullFile && (
        <Box sx={{
          position: 'absolute',
          left: (startX + endX) / 2,
          top: 4,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}>
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.text.primary,
              bgcolor: theme.palette.background.paper,
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              fontSize: 10,
              opacity: 0.9,
              whiteSpace: 'nowrap',
            }}
          >
            {durationLabel}
            {showDriftWarning && ' (drift needs 20s)'}
          </Typography>
        </Box>
      )}
    </div>
  );
}
