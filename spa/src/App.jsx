import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, CircularProgress } from '@mui/material';
import { loadAudioFile } from './services/audioLoader.js';
import {
  initPyBridge, onStatus, onResult, onError,
  analyzeFull,
} from './services/pyBridge.js';

function App() {
  const [pyReady, setPyReady] = useState(false);
  const [status, setStatus] = useState('Loading Python runtime...');
  const [processing, setProcessing] = useState(false);
  const [audioInfo, setAudioInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorTrace, setErrorTrace] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    initPyBridge();

    onStatus((msg) => {
      setStatus(msg);
      if (msg === 'Python runtime ready') {
        setPyReady(true);
        setStatus('Ready \u2014 drop a WAV file to analyze');
      }
    });

    onResult((res) => {
      setResult(res);
      setProcessing(false);
      setStatus('Analysis complete');
    });

    onError((msg, traceback) => {
      setError(msg);
      setErrorTrace(traceback);
      setProcessing(false);
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    setError(null);
    setErrorTrace('');
    setResult(null);

    if (!file.name.match(/\.wav$/i)) {
      setError('Only WAV files are supported in this phase.');
      return;
    }

    try {
      setStatus('Loading file...');
      const audio = await loadAudioFile(file);
      setAudioInfo(audio);
      setProcessing(true);
      setStatus('Starting analysis...');
      analyzeFull(audio.pcm, audio.sampleRate);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      <Typography variant="h5" gutterBottom>
        AES6 W&F Analyzer
      </Typography>

      {/* Status */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {processing && <CircularProgress size={14} sx={{ mr: 1 }} />}
        {status}
      </Typography>

      {/* Drop zone */}
      <Paper
        variant="outlined"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        sx={{
          p: 4, mb: 3, textAlign: 'center', cursor: 'pointer',
          border: '2px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          bgcolor: dragOver ? 'action.hover' : 'background.paper',
          opacity: pyReady ? 1 : 0.5,
          pointerEvents: pyReady ? 'auto' : 'none',
        }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.wav';
          input.onchange = (e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          };
          input.click();
        }}
      >
        <Typography color="text.secondary">
          Drop a WAV file here or click to browse
        </Typography>
      </Paper>

      {/* File info */}
      {audioInfo && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2">File: {audioInfo.fileName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {audioInfo.sampleRate} Hz | {audioInfo.channels}ch |{' '}
            {audioInfo.duration.toFixed(2)}s
          </Typography>
        </Paper>
      )}

      {/* Error */}
      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.main', color: 'error.contrastText' }}>
          <Typography variant="body2">{error}</Typography>
          {errorTrace && (
            <>
              <Typography
                variant="caption"
                sx={{ cursor: 'pointer', textDecoration: 'underline', mt: 1, display: 'block' }}
                onClick={() => setShowTrace(!showTrace)}
              >
                {showTrace ? 'Hide' : 'Show'} stack trace
              </Typography>
              {showTrace && (
                <Typography
                  variant="caption"
                  component="pre"
                  sx={{ mt: 1, whiteSpace: 'pre-wrap', fontSize: '0.7rem' }}
                >
                  {errorTrace}
                </Typography>
              )}
            </>
          )}
        </Paper>
      )}

      {/* Results */}
      {result && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            AES6-2008 Metrics
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            Carrier: {result.carrier_freq.toFixed(1)} Hz
            {' | '}Mean: {result.f_mean.toFixed(4)} Hz
          </Typography>

          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              DIN/IEC Unwtd
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              Peak (2σ): ±{result.aes6.peak_unweighted.toFixed(4)}%
              {' | '}RMS: {result.aes6.rms_unweighted.toFixed(4)}%
            </Typography>
          </Box>

          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              DIN/IEC Wtd
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              Peak (2σ): ±{result.aes6.peak_weighted.toFixed(4)}%
              {' | '}RMS: {result.aes6.rms_weighted.toFixed(4)}% (JIS)
              {' | '}Wow: {result.aes6.wow_rms.toFixed(4)}%
              {' | '}Flutter: {result.aes6.flutter_rms.toFixed(4)}%
            </Typography>
          </Box>

          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Drift (non-standard)
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              Drift: {result.aes6.drift_rms.toFixed(4)}%
            </Typography>
          </Box>

          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Signal
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              Duration: {result.duration.toFixed(2)}s
              {' | '}Deviation points: {result.t_uniform.length}
              {' | '}Peaks detected: {result.spectrum.peaks.length}
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );
}

export default App;
