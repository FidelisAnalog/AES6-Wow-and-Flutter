import { useState, useEffect, useCallback, useRef } from 'react';
import { Typography, CircularProgress, Box } from '@mui/material';
import Layout from './components/Layout/Layout.jsx';
import FileInput from './components/FileInput/FileInput.jsx';
import FileInfo from './components/FileInput/FileInfo.jsx';
import ErrorDisplay from './components/ErrorDisplay.jsx';
import StatsPanel from './components/StatsPanel/StatsPanel.jsx';
import Waveform from './components/Waveform/Waveform.jsx';
import { loadAudioFile, loadAudioFromUrl } from './services/audioLoader.js';
import useQueryParams from './hooks/useQueryParams.js';
import {
  initPyBridge, onStatus, onResult, onError,
  analyzeFull,
} from './services/pyBridge.js';

function App() {
  const { file: fileUrl } = useQueryParams();
  const [pyReady, setPyReady] = useState(false);
  const [status, setStatus] = useState('Loading Python runtime...');
  const [processing, setProcessing] = useState(false);
  const [audioInfo, setAudioInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorTrace, setErrorTrace] = useState('');
  const audioRef = useRef(null); // keep PCM data for region re-analysis

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

      // Keep PCM only in ref (not React state) — large typed arrays in
      // React state cause Safari to stall 10-12s during rendering.
      const { pcm, ...audioMeta } = audio;
      audioRef.current = { pcm, sampleRate: audio.sampleRate };
      setAudioInfo(audioMeta);

      setProcessing(true);
      setStatus('Starting analysis...');
      analyzeFull(pcm, audio.sampleRate);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Auto-load from ?file=<URL> query param once Pyodide is ready
  const urlLoadedRef = useRef(false);
  useEffect(() => {
    if (!pyReady || !fileUrl || urlLoadedRef.current) return;
    urlLoadedRef.current = true;
    (async () => {
      setError(null);
      setErrorTrace('');
      setResult(null);
      try {
        setStatus('Fetching file from URL...');
        const audio = await loadAudioFromUrl(fileUrl);
        const { pcm, ...audioMeta } = audio;
        audioRef.current = { pcm, sampleRate: audio.sampleRate };
        setAudioInfo(audioMeta);
        setProcessing(true);
        setStatus('Starting analysis...');
        analyzeFull(pcm, audio.sampleRate);
      } catch (e) {
        setError(String(e));
        setStatus('URL load failed');
      }
    })();
  }, [pyReady, fileUrl]);

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

  const handleMeasureRegion = useCallback((startSec, endSec) => {
    if (!audioRef.current) return;
    const { pcm, sampleRate } = audioRef.current;
    const startIdx = Math.round(startSec * sampleRate);
    const endIdx = Math.round(endSec * sampleRate);
    const slice = pcm.slice(startIdx, endIdx);
    setProcessing(true);
    setStatus('Re-measuring region...');
    analyzeFull(slice, sampleRate);
  }, []);

  const hasFile = !!audioInfo;

  return (
    <Layout>
      {/* Status row — with inline file chooser after first load */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {processing && <CircularProgress size={14} />}
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {status}
        </Typography>
        {hasFile && <FileInput onFileSelected={handleFile} disabled={!pyReady} compact />}
      </Box>

      {/* Hero file input — only before first file is loaded */}
      {!hasFile && <FileInput onFileSelected={handleFile} disabled={!pyReady} />}

      {/* File info */}
      <FileInfo audioInfo={audioInfo} />

      {/* Error */}
      <ErrorDisplay message={error} traceback={errorTrace} />

      {/* Deviation waveform */}
      <Waveform
        tUniform={result?.t_uniform}
        deviationPct={result?.deviation_pct}
        wfPeak2Sigma={result?.wf_peak_2sigma}
        totalDuration={audioInfo?.duration}
        harmonicOverlays={[]}
        processing={processing}
        onMeasureRegion={handleMeasureRegion}
      />

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
