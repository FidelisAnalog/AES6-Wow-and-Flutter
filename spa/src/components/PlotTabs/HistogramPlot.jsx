/**
 * Deviation histogram using Plotly.js directly.
 * Data from getPlotData('histogram'): { bins, counts, bin_edges }.
 */

import { useRef, useEffect } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useTheme } from '@mui/material/styles';

export default function HistogramPlot({ data, width, height }) {
  const divRef = useRef(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    if (!divRef.current || !data?.bins || !data?.counts || !width || !height) return;

    const { bins, counts, bin_edges } = data;
    const wf = theme.palette.waveform;
    const textColor = theme.palette.text.secondary;

    const dataMax = Math.max(Math.abs(bin_edges[0]), Math.abs(bin_edges[bin_edges.length - 1]));
    const halfRange = Math.max(dataMax, 0.1);
    const widths = bins.map((_, i) => bin_edges[i + 1] - bin_edges[i]);

    const traces = [{
      type: 'bar',
      x: bins,
      y: counts,
      width: widths,
      marker: {
        color: isDark ? '#42a5f5' : '#1976d2',
        line: { width: 0 },
      },
      hoverinfo: 'none',
    }];

    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

    const layout = {
      paper_bgcolor: wf.background,
      plot_bgcolor: wf.background,
      font: { color: textColor, family: 'monospace', size: 10 },
      margin: { t: 10, b: 35, l: 50, r: 10 },
      width,
      height,
      bargap: 0.02,
      hovermode: false,
      xaxis: {
        range: [-halfRange, halfRange],
        ticksuffix: '%',
        gridcolor: gridColor,
        zeroline: true,
        zerolinecolor: wf.zeroLine,
        zerolinewidth: 1.5,
      },
      yaxis: {
        gridcolor: gridColor,
        zeroline: false,
      },
    };

    Plotly.react(divRef.current, traces, layout, { displayModeBar: false, responsive: false, staticPlot: true });

    return () => {
      if (divRef.current) Plotly.purge(divRef.current);
    };
  }, [data, width, height, isDark, theme]);

  return <div ref={divRef} style={{ width, height }} />;
}
