import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Typography, CircularProgress, Box } from '@mui/material';
import Layout from './components/Layout/Layout.jsx';
import FileInput from './components/FileInput/FileInput.jsx';
import ErrorDisplay from './components/ErrorDisplay.jsx';
import StatsPanel from './components/StatsPanel/StatsPanel.jsx';
import Waveform from './components/Waveform/Waveform.jsx';
import Spectrum from './components/Spectrum/Spectrum.jsx';
import PlotTabs from './components/PlotTabs/PlotTabs.jsx';
import { getPeakColor } from './components/Spectrum/peakColors.js';
import { loadAudioFile, loadAudioFromUrl } from './services/audioLoader.js';
import useQueryParams from './hooks/useQueryParams.js';
import {
  initPyBridge, onStatus, onResult, onError,
  analyzeFull, getPlotData,
} from './services/pyBridge.js';

const EPSILON = 0.001;

function App() {
  const { file: fileUrl } = useQueryParams();
  const [pyReady, setPyReady] = useState(false);
  const [status, setStatus] = useState('Loading Python runtime...');
  const statusRef = useRef(null); // direct DOM updates during analysis to avoid re-renders
  const [processing, setProcessing] = useState(false);
  const [audioInfo, setAudioInfo] = useState(null);
  const [error, setError] = useState(null);
  const [errorTrace, setErrorTrace] = useState('');
  const audioRef = useRef(null); // keep PCM data for region re-analysis
  const [analysisOpts, setAnalysisOpts] = useState({});

  // Split result state: full-file vs region
  const [fullResult, setFullResult] = useState(null);
  const [regionResult, setRegionResult] = useState(null);
  const [lastMeasuredRegion, setLastMeasuredRegion] = useState(null);
  const isRegionMeasureRef = useRef(false);
  const pendingRegionRef = useRef(null); // [start, end] for the in-flight region measure
  const hasRegionResultRef = useRef(false);

  // Active result: region overrides full-file when present
  const activeResult = regionResult ?? fullResult;
  hasRegionResultRef.current = !!regionResult;

  // Harmonic overlays from spectrum peak selection
  const [harmonicOverlays, setHarmonicOverlays] = useState([]);

  useEffect(() => {
    initPyBridge();

    onStatus((msg) => {
      // During analysis, update DOM directly to avoid React re-renders that scroll the page
      if (statusRef.current) statusRef.current.textContent = msg;
      if (msg === 'Ready') {
        setPyReady(true);
        setStatus('Ready');
      }
    });

    onResult((res) => {
      if (isRegionMeasureRef.current) {
        setRegionResult(res);
        setLastMeasuredRegion(pendingRegionRef.current);
        isRegionMeasureRef.current = false;
        pendingRegionRef.current = null;
      } else {
        setFullResult(res);
        setRegionResult(null);
        setLastMeasuredRegion(null);
      }
      setProcessing(false);
      setStatus('Analysis complete');
      if (statusRef.current) statusRef.current.textContent = 'Analysis complete';
    });

    onError((msg, traceback) => {
      setError(msg);
      setErrorTrace(traceback);
      setProcessing(false);
      isRegionMeasureRef.current = false;
      pendingRegionRef.current = null;
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    setError(null);
    setErrorTrace('');
    setFullResult(null);
    setRegionResult(null);
    setLastMeasuredRegion(null);
    setHarmonicOverlays([]);
    isRegionMeasureRef.current = false;

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
      await analyzeFull(pcm, audio.sampleRate);
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
      setFullResult(null);
      setRegionResult(null);
      setLastMeasuredRegion(null);
      try {
        setStatus('Fetching file from URL...');
        const audio = await loadAudioFromUrl(fileUrl);
        const { pcm, ...audioMeta } = audio;
        audioRef.current = { pcm, sampleRate: audio.sampleRate };
        setAudioInfo(audioMeta);
        setProcessing(true);
        setStatus('Starting analysis...');
        await analyzeFull(pcm, audio.sampleRate);
        // Strip all query params after successful load
        window.history.replaceState({}, '', window.location.pathname);
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

    // If handles are at full-file position, restore full-file results
    // but re-run analysis so Python re-stashes full-file data for on-demand plots
    const dur = audioInfo?.duration || 0;
    const isFullFile = startSec <= EPSILON && endSec >= dur - EPSILON;
    if (isFullFile) {
      setRegionResult(null);
      setLastMeasuredRegion(null);
      setHarmonicOverlays([]);
      if (!hasRegionResultRef.current) {
        // Already on full file — no re-analysis needed
        return;
      }
      // Was on region — re-run full file to re-stash Python state
      const { pcm, sampleRate } = audioRef.current;
      isRegionMeasureRef.current = false;
      setProcessing(true);
      setStatus('Restoring full-file analysis...');
      analyzeFull(pcm, sampleRate, analysisOpts);
      return;
    }

    const { pcm, sampleRate } = audioRef.current;
    const startIdx = Math.round(startSec * sampleRate);
    const endIdx = Math.round(endSec * sampleRate);
    const slice = pcm.slice(startIdx, endIdx);

    isRegionMeasureRef.current = true;
    pendingRegionRef.current = [startSec, endSec];
    setProcessing(true);
    setStatus('Re-measuring region...');
    // Pass full-file detected RPM so wf_core doesn't re-detect on short slice
    const detectedRpm = fullResult?.metrics?.rpm?.value;
    const regionOpts = { ...analysisOpts };
    if (detectedRpm && !regionOpts.rpm) regionOpts.rpm = detectedRpm;
    analyzeFull(slice, sampleRate, regionOpts);
  }, [audioInfo, fullResult, analysisOpts]);

  // Harmonic overlay handler — called when spectrum peak selection changes
  const handleHarmonicSelect = useCallback((selectedFreqs, selectedIndices) => {
    if (!selectedFreqs.length) {
      setHarmonicOverlays([]);
      return;
    }
    try {
      const result = getPlotData('harmonic_extract', { freqs: selectedFreqs });
      if (result?.components) {
        // Build time array for overlay — offset to region position in full-file waveform
        const regionStart = lastMeasuredRegion ? lastMeasuredRegion[0] : 0;
        const activeSpec = (regionResult ?? fullResult)?.plots?.dev_time;
        const overlayT = activeSpec?.t?.map(t => t + regionStart);

        const overlays = result.components.map((data, i) => ({
          data,
          tUniform: overlayT,
          color: getPeakColor(selectedIndices[i]),
        }));
        setHarmonicOverlays(overlays);
      }
    } catch (e) {
      console.warn('[harmonic_extract] failed:', e);
      setHarmonicOverlays([]);
    }
  }, [lastMeasuredRegion, regionResult, fullResult]);

  // Re-analyze with additional params (e.g. RPM for polar plot)
  const handleReanalyze = useCallback(async (opts) => {
    if (!audioRef.current) return;
    const mergedOpts = { ...analysisOpts, ...opts };
    setAnalysisOpts(mergedOpts);
    const { pcm, sampleRate } = audioRef.current;
    setProcessing(true);
    setStatus('Re-analyzing...');
    await analyzeFull(pcm, sampleRate, mergedOpts);
  }, [analysisOpts]);

  const hasFile = !!audioInfo;

  return (
    <Layout>
      {/* Status row — with inline file chooser after first load */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {processing && <CircularProgress size={14} />}
        <Typography ref={statusRef} variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {status}
        </Typography>
        {hasFile && <FileInput onFileSelected={handleFile} disabled={!pyReady} compact />}
      </Box>

      {/* Hero area — spinner until ready, then file card (unless URL loading) */}
      {!hasFile && !pyReady && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '50%', height: '50vh', mx: 'auto', my: 'auto' }}>
          <CircularProgress size={32} />
        </Box>
      )}
      {!hasFile && pyReady && !fileUrl && <FileInput onFileSelected={handleFile} disabled={!pyReady} />}
      {!hasFile && pyReady && fileUrl && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '50%', height: '50vh', mx: 'auto', my: 'auto' }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {/* Error */}
      <ErrorDisplay message={error} traceback={errorTrace} />

      {/* Results + file info — above plots */}
      <StatsPanel
        result={activeResult}
        processing={processing}
        duration={activeResult?.metrics?.duration ?? audioInfo?.duration}
        audioInfo={audioInfo}
      />

      {/* Deviation waveform — always shows full-file data */}
      <Waveform
        tUniform={fullResult?.plots?.dev_time?.t}
        deviationPct={fullResult?.plots?.dev_time?.deviation_pct}
        wfPeak2Sigma={fullResult?.metrics?.standard?.unweighted_peak?.value}
        totalDuration={audioInfo?.duration}
        harmonicOverlays={harmonicOverlays}
        processing={processing}
        onMeasureRegion={handleMeasureRegion}
        lastMeasuredRegion={lastMeasuredRegion}
      />

      {/* Spectrum plot with peak selection */}
      <Spectrum
        spectrumData={activeResult?.plots?.spectrum}
        onHarmonicSelect={handleHarmonicSelect}
        processing={processing}
      />

      {/* On-demand plots: Histogram, Polar, Lissajous */}
      <PlotTabs
        available={activeResult?.available}
        processing={processing}
        onReanalyze={handleReanalyze}
        currentOpts={analysisOpts}
        rpmInfo={fullResult?.metrics?.rpm}
      />
    </Layout>
  );
}

export default App;
