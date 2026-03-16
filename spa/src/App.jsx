import { useState, useEffect, useCallback } from 'react';
import { Typography, CircularProgress, Box } from '@mui/material';
import Layout from './components/Layout/Layout.jsx';
import FileInput from './components/FileInput/FileInput.jsx';
import FileInfo from './components/FileInput/FileInfo.jsx';
import ErrorDisplay from './components/ErrorDisplay.jsx';
import StatsPanel from './components/StatsPanel/StatsPanel.jsx';
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

  useEffect(() => {
    initPyBridge();

    onStatus((msg) => {
      setStatus(msg);
      if (msg === 'Python runtime ready') {
        setPyReady(true);
        setStatus('Ready \u2014 drop a file to analyze');
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

    if (!file.name.match(/\.(wav|flac)$/i)) {
      setError('Unsupported file format. Please use WAV or FLAC.');
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

  // Page-level drop handler — files dropped anywhere on the page trigger loading
  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault();
    };
    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && pyReady) handleFile(file);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [pyReady, handleFile]);

  return (
    <Layout>
      {/* Status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {processing && <CircularProgress size={14} />}
        <Typography variant="body2" color="text.secondary">
          {status}
        </Typography>
      </Box>

      {/* File input */}
      <FileInput onFileSelected={handleFile} disabled={!pyReady} />

      {/* File info */}
      <FileInfo audioInfo={audioInfo} />

      {/* Error */}
      <ErrorDisplay message={error} traceback={errorTrace} />

      {/* Results */}
      <StatsPanel
        result={result}
        processing={processing}
        duration={audioInfo?.duration}
      />
    </Layout>
  );
}

export default App;
