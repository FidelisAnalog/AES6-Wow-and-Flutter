/**
 * Polar plot using Plotly.js — scatterpolar trace for each revolution.
 * 0° at top, clockwise rotation, 20 radial ticks at 0.1%/div.
 */

import { useRef, useEffect } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useTheme } from '@mui/material/styles';
import { PEAK_COLORS } from '../Spectrum/peakColors.js';

const N_TICKS = 20;

export default function PolarPlot({ data, width, height }) {
  const divRef = useRef(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    if (!divRef.current || !data?.revolutions?.length || !data.f_mean || !width || !height) return;

    const { revolutions, f_mean } = data;
    const hzPerTick = f_mean * 0.001;

    let maxFreq = 0;
    for (const rev of revolutions) {
      for (const r of rev.radius) {
        if (r > maxFreq) maxFreq = r;
      }
    }
    maxFreq += hzPerTick * 0.5;

    const traces = revolutions.map((rev, ri) => ({
      type: 'scatterpolar',
      mode: 'lines',
      r: rev.radius.map(freq => Math.max(0, N_TICKS - (maxFreq - freq) / hzPerTick)),
      theta: rev.angle.map(a => (a * 180) / Math.PI),
      line: { color: PEAK_COLORS[ri % PEAK_COLORS.length], width: 1 },
      name: `Rev ${ri + 1}`,
      hoverinfo: 'none',
    }));

    const wf = theme.palette.waveform;
    const textColor = theme.palette.text.secondary;
    const gridColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';

    const layout = {
      polar: {
        bgcolor: wf.background,
        angularaxis: {
          direction: 'clockwise',
          rotation: 90,
          dtick: 45,
          tickfont: { size: 10, family: 'monospace', color: textColor },
          gridcolor: gridColor,
          linecolor: gridColor,
        },
        radialaxis: {
          range: [0, N_TICKS],
          dtick: 1,
          showticklabels: false,
          gridcolor: gridColor,
          linecolor: gridColor,
        },
      },
      paper_bgcolor: wf.background,
      plot_bgcolor: wf.background,
      font: { color: textColor, family: 'monospace' },
      showlegend: false,
      margin: { t: 20, b: 30, l: 20, r: 20 },
      width,
      height,
      annotations: [{
        text: '0.1%/div',
        xref: 'paper', yref: 'paper',
        x: 0.98, y: 0.02,
        showarrow: false,
        font: { size: 9, family: 'monospace', color: textColor },
      }],
    };

    Plotly.react(divRef.current, traces, layout, { displayModeBar: false, responsive: false });

    return () => {
      if (divRef.current) Plotly.purge(divRef.current);
    };
  }, [data, width, height, isDark, theme]);

  return <div ref={divRef} style={{ width, height }} />;
}
