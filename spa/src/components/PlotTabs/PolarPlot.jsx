/**
 * Polar plot using Plotly.js — scatterpolar trace for each revolution.
 * 0° at top, clockwise rotation, 20 radial ticks at 0.1%/div.
 * Uses Plotly.restyle for data updates to preserve zoom state.
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
  const initializedRef = useRef(false);

  // Full init on first render or theme/size change
  useEffect(() => {
    if (!divRef.current || !width || !height) return;
    initializedRef.current = false; // force re-init on theme/size change
  }, [width, height, isDark]);

  useEffect(() => {
    if (!divRef.current || !data?.revolutions?.length || !data.f_mean || !width || !height) return;

    const div = divRef.current;
    const { revolutions, f_mean } = data;
    const hzPerTick = f_mean * 0.001;

    let maxFreq = 0;
    for (const rev of revolutions) {
      for (const r of rev.radius) {
        if (r > maxFreq) maxFreq = r;
      }
    }
    maxFreq += hzPerTick * 0.5;

    const rArrays = revolutions.map(rev =>
      rev.radius.map(freq => Math.max(0, N_TICKS - (maxFreq - freq) / hzPerTick))
    );
    const thetaArrays = revolutions.map(rev =>
      rev.angle.map(a => (a * 180) / Math.PI)
    );

    if (initializedRef.current && div.data?.length) {
      // Data-only update — preserve zoom/pan
      // Match trace count: remove extra or add missing
      const existingCount = div.data.length;
      const newCount = revolutions.length;

      if (existingCount > newCount) {
        Plotly.deleteTraces(div, Array.from({ length: existingCount - newCount }, (_, i) => newCount + i));
      }

      // Restyle existing traces
      const updateCount = Math.min(existingCount, newCount);
      for (let i = 0; i < updateCount; i++) {
        Plotly.restyle(div, { r: [rArrays[i]], theta: [thetaArrays[i]] }, [i]);
      }

      // Add new traces if needed
      if (newCount > existingCount) {
        const newTraces = [];
        for (let i = existingCount; i < newCount; i++) {
          newTraces.push({
            type: 'scatterpolar',
            mode: 'lines',
            r: rArrays[i],
            theta: thetaArrays[i],
            line: { color: PEAK_COLORS[i % PEAK_COLORS.length], width: 1 },
            name: `Rev ${i + 1}`,
            hoverinfo: 'none',
          });
        }
        Plotly.addTraces(div, newTraces);
      }
    } else {
      // First render — full init
      const traces = revolutions.map((rev, ri) => ({
        type: 'scatterpolar',
        mode: 'lines',
        r: rArrays[ri],
        theta: thetaArrays[ri],
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

      Plotly.react(div, traces, layout, { displayModeBar: false, responsive: false });
      initializedRef.current = true;
    }

    return () => {
      if (!initializedRef.current) return;
      // Only purge on unmount, not on data change
    };
  }, [data, width, height, isDark, theme]);

  // Purge on unmount
  useEffect(() => {
    return () => {
      if (divRef.current) {
        Plotly.purge(divRef.current);
        initializedRef.current = false;
      }
    };
  }, []);

  return <div ref={divRef} style={{ width, height }} />;
}
