import { useTheme } from '@mui/material/styles';

const AXIS_WIDTH = 52;

/**
 * SVG Y-axis for deviation %. Symmetric around 0. Zero tick always shown.
 */
export default function DeviationAxis({ yMin, yMax, height }) {
  const theme = useTheme();
  const textColor = theme.palette.text.secondary;

  if (!height || yMin >= yMax) return null;

  const range = yMax - yMin;
  const rawStep = range / 6;
  const step = niceNum(rawStep);

  // Generate ticks
  const ticks = [];
  let val = Math.ceil(yMin / step) * step;
  while (val <= yMax) {
    const y = ((yMax - val) / range) * height;
    ticks.push({ val, y });
    val += step;
  }

  // Ensure zero is present
  if (!ticks.some((t) => Math.abs(t.val) < step * 0.01)) {
    const y = ((yMax - 0) / range) * height;
    ticks.push({ val: 0, y });
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
            {formatDeviation(val, step)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function formatDeviation(val, step) {
  if (Math.abs(val) < 1e-10) return '0';
  // Determine decimal places from step size
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(decimals)}`;
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
