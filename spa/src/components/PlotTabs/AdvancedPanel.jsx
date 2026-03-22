/**
 * Advanced configuration panel — transport type, RPM, motor params.
 * These are global analysis parameters that affect re-analysis.
 */

import { useState, useCallback, useEffect } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton, TextField, Button } from '@mui/material';

const TRANSPORT_TYPES = [
  { label: 'Turntable', value: 'turntable' },
  { label: 'Tape', value: 'tape' },
  { label: 'Other', value: 'other' },
];

const RPM_PRESETS = {
  turntable: [
    { label: '33⅓', value: 33.333 },
    { label: '45', value: 45 },
    { label: '78', value: 78 },
  ],
  tape: [
    { label: '1⅞ ips', value: null },
    { label: '3¾ ips', value: null },
    { label: '7½ ips', value: null },
    { label: '15 ips', value: null },
  ],
  other: [],
};

export default function AdvancedPanel({ currentOpts, onReanalyze }) {
  const [transport, setTransport] = useState('turntable');
  const [rpmPreset, setRpmPreset] = useState(33.333);
  const [rpmCustom, setRpmCustom] = useState('');
  const [rpmMode, setRpmMode] = useState('preset');
  const [motorSlots, setMotorSlots] = useState('');
  const [motorPoles, setMotorPoles] = useState('');
  const [driveRatio, setDriveRatio] = useState('');
  const [dirty, setDirty] = useState(false);

  const rpm = rpmMode === 'preset' ? rpmPreset : (parseFloat(rpmCustom) || null);
  const showMotorParams = transport === 'turntable';
  const showRpmPresets = transport !== 'other';
  const presets = RPM_PRESETS[transport] || [];

  const handleTransportChange = useCallback((_, val) => {
    if (val == null) return;
    setTransport(val);
    setRpmPreset(null);
    setRpmMode('custom');
    setDirty(true);
  }, []);

  const handlePresetChange = useCallback((_, val) => {
    if (val != null) {
      setRpmPreset(val);
      setRpmMode('preset');
      setDirty(true);
    }
  }, []);

  const handleCustomRpm = useCallback((e) => {
    setRpmCustom(e.target.value);
    setRpmMode('custom');
    setRpmPreset(null);
    setDirty(true);
  }, []);

  // Auto-apply default 33⅓ on first render if onReanalyze exists
  useEffect(() => {
    if (currentOpts?.rpm === 33.333) setDirty(false);
  }, [currentOpts]);

  const handleApply = useCallback(() => {
    if (!onReanalyze) return;
    const opts = {};
    if (rpm) opts.rpm = rpm;
    if (motorSlots) opts.motor_slots = parseInt(motorSlots, 10) || undefined;
    if (motorPoles) opts.motor_poles = parseInt(motorPoles, 10) || undefined;
    if (driveRatio) opts.drive_ratio = parseFloat(driveRatio) || undefined;
    onReanalyze(opts);
    setDirty(false);
  }, [rpm, motorSlots, motorPoles, driveRatio, onReanalyze]);

  const rowSx = { display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' };
  const labelSx = { minWidth: 55, fontSize: '0.8rem' };
  const inputSx = { width: 70 };
  const inputProps = { style: { padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.8rem' } };

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Transport type */}
      <Box sx={rowSx}>
        <Typography variant="body2" color="text.secondary" sx={labelSx}>
          Transport
        </Typography>
        <ToggleButtonGroup
          value={transport}
          exclusive
          onChange={handleTransportChange}
          size="small"
        >
          {TRANSPORT_TYPES.map(t => (
            <ToggleButton key={t.value} value={t.value} sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: '0.8rem' }}>
              {t.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* RPM */}
      <Box sx={rowSx}>
        <Typography variant="body2" color="text.secondary" sx={labelSx}>
          RPM
        </Typography>
        {showRpmPresets && presets.length > 0 && (
          <ToggleButtonGroup
            value={rpmPreset}
            exclusive
            onChange={handlePresetChange}
            size="small"
          >
            {presets.map(p => (
              <ToggleButton
                key={p.label}
                value={p.value}
                disabled={p.value == null}
                sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: '0.8rem' }}
              >
                {p.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <TextField
          size="small"
          placeholder="Custom"
          value={rpmCustom}
          onChange={handleCustomRpm}
          sx={inputSx}
          inputProps={inputProps}
        />
      </Box>

      {/* Motor params — turntable only */}
      {showMotorParams && (
        <Box sx={rowSx}>
          <Typography variant="body2" color="text.secondary" sx={labelSx}>
            Motor
          </Typography>
          <TextField
            size="small"
            placeholder="Slots"
            value={motorSlots}
            onChange={(e) => { setMotorSlots(e.target.value); setDirty(true); }}
            sx={{ width: 55 }}
            inputProps={inputProps}
          />
          <TextField
            size="small"
            placeholder="Poles"
            value={motorPoles}
            onChange={(e) => { setMotorPoles(e.target.value); setDirty(true); }}
            sx={{ width: 55 }}
            inputProps={inputProps}
          />
          <TextField
            size="small"
            placeholder="Drive ratio"
            value={driveRatio}
            onChange={(e) => { setDriveRatio(e.target.value); setDirty(true); }}
            sx={{ width: 80 }}
            inputProps={inputProps}
          />
        </Box>
      )}

      {/* Apply button */}
      {dirty && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleApply}
            disabled={!rpm}
            sx={{ textTransform: 'none', fontSize: '0.8rem' }}
          >
            Re-analyze
          </Button>
        </Box>
      )}
    </Box>
  );
}
