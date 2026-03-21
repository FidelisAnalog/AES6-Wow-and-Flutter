/**
 * Log-frequency axis — frequency markings below the spectrum plot.
 * SVG, position: sticky inside scroll wrapper.
 * Adapted from TimeAxis.jsx.
 */

import React, { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { SPECTRUM_MIN_FREQ } from '../../config/constants.js';

const FONT_SIZE = 10;
const AXIS_HEIGHT = 24;

// Nice log-spaced tick candidates (Hz)
const TICK_CANDIDATES = [0.3, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

function formatFreq(hz) {
  if (hz < 1) return hz.toFixed(1);
  if (hz < 100) return hz.toFixed(hz % 1 === 0 ? 0 : 1);
  return Math.round(hz).toString();
}

export default React.memo(function FreqAxis({ viewFMin, viewFMax, width }) {
  const theme = useTheme();

  const ticks = useMemo(() => {
    if (width <= 0 || viewFMin >= viewFMax) return [];

    const logMin = Math.log10(Math.max(viewFMin, SPECTRUM_MIN_FREQ));
    const logMax = Math.log10(Math.max(viewFMax, SPECTRUM_MIN_FREQ));
    const logRange = logMax - logMin;
    if (logRange <= 0) return [];

    const minPixelsPerTick = 60;
    const result = [];

    // Use candidates that fall in range, with subticks for deep zoom
    for (const freq of TICK_CANDIDATES) {
      if (freq < viewFMin * 0.9 || freq > viewFMax * 1.1) continue;
      const logF = Math.log10(freq);
      const x = ((logF - logMin) / logRange) * width;
      if (x < -1 || x > width + 1) continue;
      result.push({ x, label: formatFreq(freq), freq });
    }

    // If too few ticks, add intermediate values
    if (result.length < 3 && logRange < 1) {
      // Generate linear subdivisions within the visible range
      const step = Math.pow(10, Math.floor(Math.log10(viewFMax - viewFMin)));
      const niceSteps = [1, 2, 5];
      for (const ns of niceSteps) {
        const s = step * ns;
        let f = Math.ceil(viewFMin / s) * s;
        while (f <= viewFMax) {
          if (f > 0 && !result.some(t => Math.abs(t.freq - f) / f < 0.05)) {
            const logF = Math.log10(f);
            const x = ((logF - logMin) / logRange) * width;
            if (x >= -1 && x <= width + 1) {
              result.push({ x, label: formatFreq(f), freq: f });
            }
          }
          f += s;
        }
      }
    }

    // Sort by x and filter out ticks too close together
    result.sort((a, b) => a.x - b.x);
    const filtered = [];
    for (const tick of result) {
      if (filtered.length === 0 || tick.x - filtered[filtered.length - 1].x >= minPixelsPerTick) {
        filtered.push(tick);
      }
    }
    return filtered;
  }, [viewFMin, viewFMax, width]);

  if (!width || viewFMin >= viewFMax) return null;

  return (
    <svg width={width} height={AXIS_HEIGHT} style={{ display: 'block', position: 'sticky', left: 0 }}>
      <rect x={0} y={0} width={width} height={AXIS_HEIGHT} fill={theme.palette.background.paper} />
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
            y={AXIS_HEIGHT - 5}
            fill={theme.palette.text.secondary}
            fontSize={FONT_SIZE}
            fontFamily="monospace"
          >
            {tick.label} Hz
          </text>
        </g>
      ))}
    </svg>
  );
});

export { AXIS_HEIGHT };
