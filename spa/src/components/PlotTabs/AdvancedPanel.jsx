/**
 * Advanced configuration panel — transport type, RPM, motor params,
 * FM measurement bandwidth, polar plot low-pass.
 * Shows auto-detected RPM from wf_core when available.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, ToggleButtonGroup, ToggleButton, TextField,
  Button, Chip, Select, MenuItem, FormControl,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

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

const FM_BW_STORAGE_KEY = 'fmBwPreference';

export default function AdvancedPanel({
  currentOpts, onReanalyze, rpmInfo,
  fmBwInfo, inputType,
  polarLpHz, polarLpOptions, onPolarLpChange,
}) {
  const [transport, setTransport] = useState('turntable');
  const [rpmPreset, setRpmPreset] = useState(null);
  const [rpmCustom, setRpmCustom] = useState('');
  const [rpmMode, setRpmMode] = useState('auto'); // 'auto' | 'preset' | 'custom'
  const [motorSlots, setMotorSlots] = useState('');
  const [motorPoles, setMotorPoles] = useState('');
  const [driveRatio, setDriveRatio] = useState('');
  const [dirty, setDirty] = useState(false);

  // FM BW selection — 'max', 'aes_min', or numeric Hz string
  const [fmBwMode, setFmBwMode] = useState(() => {
    try { return localStorage.getItem(FM_BW_STORAGE_KEY) || 'max'; } catch { return 'max'; }
  });
  const [fmBwCustom, setFmBwCustom] = useState(''); // numeric Hz from options dropdown

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

  // FM BW handlers
  const handleFmBwMode = useCallback((_, val) => {
    if (val == null) return;
    setFmBwMode(val);
    setFmBwCustom('');
    // Persist only max and aes_min
    if (val === 'max' || val === 'aes_min') {
      try { localStorage.setItem(FM_BW_STORAGE_KEY, val); } catch {}
    }
    setDirty(true);
  }, []);

  const handleFmBwCustom = useCallback((e) => {
    const val = e.target.value;
    setFmBwCustom(val);
    setFmBwMode('custom');
    // Don't persist custom values
    setDirty(true);
  }, []);

  // Resolve what fm_bw value to send to wf_core
  const fmBwEffective = fmBwMode === 'max' ? null
    : fmBwMode === 'aes_min' ? 'aes_min'
    : (parseInt(fmBwCustom, 10) || null);

  // Check if current selection matches what was already measured
  const fmBwMatchesCurrent = fmBwInfo != null && (() => {
    if (fmBwMode === 'max') return fmBwInfo.value === fmBwInfo.max;
    if (fmBwMode === 'aes_min') return fmBwInfo.value === Math.min(200, fmBwInfo.max);
    if (fmBwMode === 'custom' && fmBwCustom) return fmBwInfo.value === parseInt(fmBwCustom, 10);
    return false;
  })();

  const handleApply = useCallback(() => {
    if (!onReanalyze) return;
    const opts = {};
    if (rpmMode !== 'auto' && rpm) opts.rpm = rpm;
    // auto mode: don't pass rpm, let wf_core detect
    if (motorSlots) opts.motor_slots = parseInt(motorSlots, 10) || undefined;
    if (motorPoles) opts.motor_poles = parseInt(motorPoles, 10) || undefined;
    if (driveRatio) opts.drive_ratio = parseFloat(driveRatio) || undefined;
    // Always include fm_bw so it overrides any previous value in analysisOpts
    // null tells wf_core to use max (default)
    opts.fm_bw = fmBwEffective;
    onReanalyze(opts);
    setDirty(false);
  }, [rpm, rpmMode, motorSlots, motorPoles, driveRatio, fmBwEffective, onReanalyze]);

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
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, fontSize: { xs: '0.75em', sm: '1em' }, '& .MuiToggleButton-root': { fontSize: { xs: '0.6rem', sm: '0.8rem' }, px: { xs: 1, sm: 1.5 } }, '& .MuiButton-root': { fontSize: { xs: '0.6rem', sm: '0.8rem' } }, '& .MuiTypography-root': { fontSize: { xs: '0.6rem', sm: 'inherit' } }, '& .MuiChip-root': { fontSize: { xs: '0.56rem', sm: '0.75rem' } }, '& .MuiInputBase-root': { fontSize: { xs: '0.6rem', sm: '0.8rem' } } }}>
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

      {/* FM Measurement Bandwidth — audio only */}
      {inputType !== 'device' && (
        <>
          <Box sx={rowSx}>
            <Typography variant="body2" color="text.secondary" sx={labelSx}>
              Unwt BW
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem', mr: 0.5 }}>
              Default
            </Typography>
            <ToggleButtonGroup
              value={fmBwMode === 'custom' ? null : fmBwMode}
              exclusive
              onChange={handleFmBwMode}
              size="small"
            >
              <ToggleButton value="max" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: '0.8rem' }}>
                Max
              </ToggleButton>
              <ToggleButton value="aes_min" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: '0.8rem' }}>
                AES Min (200 Hz)
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box sx={rowSx}>
            <Typography variant="body2" color="text.secondary" sx={labelSx} />
            <Chip
              label={fmBwInfo
                ? `Measured: ${Math.round(fmBwInfo.value)} Hz`
                : 'No measurement'}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.75rem' }}
              icon={fmBwMatchesCurrent ? <CheckIcon sx={{ fontSize: '0.85rem' }} /> : undefined}
              color={fmBwMatchesCurrent ? 'success' : 'default'}
            />
            {fmBwInfo?.options?.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 90 }}>
                <Select
                  value={fmBwMode === 'custom' ? fmBwCustom : ''}
                  onChange={handleFmBwCustom}
                  displayEmpty
                  sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: '4px', px: '8px' } }}
                >
                  <MenuItem value="" disabled sx={{ fontSize: '0.8rem' }}>Custom</MenuItem>
                  {fmBwInfo.options.map(hz => (
                    <MenuItem key={hz} value={String(hz)} sx={{ fontSize: '0.8rem' }}>{hz} Hz</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </>
      )}

      {/* Polar plot low-pass */}
      {polarLpOptions && (
        <Box sx={rowSx}>
          <Typography variant="body2" color="text.secondary" sx={labelSx}>
            Polar LP
          </Typography>
          <ToggleButtonGroup
            value={polarLpHz}
            exclusive
            onChange={(_, val) => val != null && onPolarLpChange(val)}
            size="small"
          >
            {polarLpOptions.map(hz => (
              <ToggleButton key={hz} value={hz} sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: '0.8rem' }}>
                {hz === 0 ? 'None' : `${hz} Hz`}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
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
