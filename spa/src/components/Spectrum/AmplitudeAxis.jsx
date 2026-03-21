/**
 * SVG Y-axis for spectral density (%/sqrt(Hz)).
 * Range 0 to ampMax. Adapted from DeviationAxis.jsx.
 */

import { useTheme } from '@mui/material/styles';

const AXIS_WIDTH = 52;

export default function AmplitudeAxis({ ampMax, height }) {
  const theme = useTheme();
  const textColor = theme.palette.text.secondary;

  if (!height || ampMax <= 0) return null;

  const rawStep = ampMax / 5;
  const step = niceNum(rawStep);

  const ticks = [];
  let val = 0;
  while (val <= ampMax) {
    const y = ((ampMax - val) / ampMax) * height;
    ticks.push({ val, y });
    val += step;
  }

  return (
    <svg width={AXIS_WIDTH} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {ticks.map(({ val, y }) => (
        <g key={val}>
          <line x1={AXIS_WIDTH - 6} y1={y} x2={AXIS_WIDTH} y2={y} stroke={textColor} strokeWidth={1} opacity={0.4} />
          <text
            x={AXIS_WIDTH - 10}
            y={y + 4}
            textAnchor="end"
            fill={textColor}
            fontSize={11}
            fontFamily="monospace"
          >
            {formatAmp(val, step)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function formatAmp(val, step) {
  if (val === 0) return '0';
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return val.toFixed(decimals);
}

function niceNum(x) {
  const exp = Math.floor(Math.log10(Math.abs(x) || 1e-10));
  const frac = x / Math.pow(10, exp);
  let nice;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3.5) nice = 2;
  else if (frac <= 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

export { AXIS_WIDTH };
