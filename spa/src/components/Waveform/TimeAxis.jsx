/**
 * Timeline ruler — time markings below the waveform.
 * Rendered as Canvas for consistency with waveform.
 * Adapts tick intervals to the visible time range (supports zoom).
 *
 * Adapted from Browser-ABX Timeline.jsx.
 */

import React, { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';

const FONT_SIZE = 10;
const TIMELINE_HEIGHT = 24;

function formatTime(seconds, showTenths) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (showTenths) {
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${mins}:${Math.floor(secs).toString().padStart(2, '0')}`;
}

function chooseInterval(visibleDuration, width) {
  const minPixelsPerTick = 60;
  const maxTicks = Math.floor(width / minPixelsPerTick);
  const idealInterval = visibleDuration / maxTicks;

  const candidates = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const c of candidates) {
    if (c >= idealInterval) return c;
  }
  return candidates[candidates.length - 1];
}

/**
 * SVG timeline rendered inside the waveform's scrollable wrapper.
 */
export default React.memo(function TimeAxis({ viewStart, viewEnd, width, y = 0 }) {
  const theme = useTheme();

  const ticks = useMemo(() => {
    const visibleDuration = viewEnd - viewStart;
    if (visibleDuration <= 0 || width <= 0) return [];

    const interval = chooseInterval(visibleDuration, width);
    const showTenths = interval < 1;
    const result = [];

    const firstTick = Math.ceil(viewStart / interval) * interval;

    for (let t = firstTick; t <= viewEnd + interval * 0.001; t += interval) {
      const x = ((t - viewStart) / visibleDuration) * width;
      if (x < -1 || x > width + 1) continue;
      result.push({ x, label: formatTime(t, showTenths) });
    }

    return result;
  }, [viewStart, viewEnd, width]);

  if (!width || viewStart >= viewEnd) return null;

  return (
    <svg width={width} height={TIMELINE_HEIGHT} style={{ display: 'block', position: 'sticky', left: 0 }}>
      <rect x={0} y={0} width={width} height={TIMELINE_HEIGHT} fill={theme.palette.background.paper} />
      {ticks.map((tick, i) => (
        <g key={i}>
          <line
            x1={tick.x} y1={0}
            x2={tick.x} y2={5}
            stroke={theme.palette.text.secondary}
            strokeWidth={1}
          />
          <text
            x={tick.x + 3}
            y={TIMELINE_HEIGHT - 5}
            fill={theme.palette.text.secondary}
            fontSize={FONT_SIZE}
            fontFamily="monospace"
          >
            {tick.label}
          </text>
        </g>
      ))}
    </svg>
  );
});

export { TIMELINE_HEIGHT };
