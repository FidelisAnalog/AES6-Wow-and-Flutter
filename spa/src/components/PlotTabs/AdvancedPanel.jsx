/**
 * Advanced configuration panel — transport type, RPM, motor params.
 * These are global analysis parameters that affect re-analysis.
 * Shows auto-detected RPM from wf_core when available.
 */

import { useState, useCallback, useEffect } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton, TextField, Button, Chip } from '@mui/material';

const TRANSPORT_TYPES = [
  { label: 'Turntable', value: 'turntable' },
];

const RPM_PRESETS = {
  turntable: [
    { label: '16⅔', value: 16.67 },
    { label: '22½', value: 22.5 },
    { label: '33⅓', value: 33.33 },
    { label: '45', value: 45 },
    { label: '78', value: 78.26 },
  ],
};

export default function AdvancedPanel({ currentOpts, onReanalyze, rpmInfo }) {
  const [transport, setTransport] = useState('turntable');
  const [rpmPreset, setRpmPreset] = useState(null);
  const [rpmCustom, setRpmCustom] = useState('');
  const [rpmMode, setRpmMode] = useState('auto'); // 'auto' | 'preset' | 'custom'
  const [motorSlots, setMotorSlots] = useState('');
  const [motorPoles, setMotorPoles] = useState('');
  const [driveRatio, setDriveRatio] = useState('');
  const [dirty, setDirty] = useState(false);

  // Resolve effective RPM
  const rpm = rpmMode === 'auto'
    ? rpmInfo?.value ?? null
    : rpmMode === 'preset'
      ? rpmPreset
      : (parseFloat(rpmCustom) || null);

  const showMotorParams = transport === 'turntable';
  const showRpmPresets = transport !== 'other';
  const presets = RPM_PRESETS[transport] || [];

  // When rpmInfo changes (new analysis), reset to auto if user hasn't overridden
  useEffect(() => {
    if (rpmInfo && rpmInfo.source === 'detected' && rpmMode === 'auto') {
      setDirty(false);
    }
  }, [rpmInfo, rpmMode]);

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

  const handleResetToAuto = useCallback(() => {
    setRpmMode('auto');
    setRpmPreset(null);
    setRpmCustom('');
    setDirty(true);
  }, []);

  const handleApply = useCallback(() => {
    if (!onReanalyze) return;
    const opts = {};
    if (rpmMode !== 'auto' && rpm) opts.rpm = rpm;
    // auto mode: don't pass rpm, let wf_core detect
    if (motorSlots) opts.motor_slots = parseInt(motorSlots, 10) || undefined;
    if (motorPoles) opts.motor_poles = parseInt(motorPoles, 10) || undefined;
    if (driveRatio) opts.drive_ratio = parseFloat(driveRatio) || undefined;
    onReanalyze(opts);
    setDirty(false);
  }, [rpm, rpmMode, motorSlots, motorPoles, driveRatio, onReanalyze]);

  const rowSx = { display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' };
  const labelSx = { minWidth: 55, fontSize: '0.8rem' };
  const inputSx = { width: 70 };
  const inputProps = { style: { padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.8rem' } };

  // Format detected RPM display
  const detectedLabel = rpmInfo?.source === 'detected' && rpmInfo?.value != null
    ? `Detected: ${rpmInfo.value} RPM (${rpmInfo.f_rot_measured} Hz)`
    : rpmInfo?.source === 'user'
      ? `User: ${rpmInfo.value} RPM`
      : 'Not detected';

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

      {/* RPM — detected info + override */}
      <Box sx={rowSx}>
        <Typography variant="body2" color="text.secondary" sx={labelSx}>
          RPM
        </Typography>
        <Chip
          label={detectedLabel}
          size="small"
          color={rpmMode === 'auto' ? 'primary' : 'default'}
          variant={rpmMode === 'auto' ? 'filled' : 'outlined'}
          onClick={handleResetToAuto}
          sx={{ fontSize: '0.75rem' }}
        />
      </Box>

      {/* RPM override */}
      <Box sx={rowSx}>
        <Typography variant="body2" color="text.secondary" sx={labelSx}>
          Override
        </Typography>
        {showRpmPresets && presets.length > 0 && (
          <ToggleButtonGroup
            value={rpmMode === 'preset' ? rpmPreset : null}
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
            sx={{ textTransform: 'none', fontSize: '0.8rem' }}
          >
            Re-analyze
          </Button>
        </Box>
      )}
    </Box>
  );
}
