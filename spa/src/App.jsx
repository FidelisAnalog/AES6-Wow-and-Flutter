import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Typography, CircularProgress, Box, useTheme } from '@mui/material';
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

/**
 * Health indicator dot — occupies same space as the spinner.
 * status: 'ok' | 'warning' | 'error'
 */
function StatusDot({ status }) {
  const theme = useTheme();
  const colors = theme.palette.statusIndicator;
  const color = colors[status] ?? colors.ok;
  return (
    <Box sx={{
      position: 'absolute',
      left: { xs: 9, sm: 6 },
      top: { xs: 2, sm: -1 },
      mt: { xs: '4px', sm: '5px' },
      width: { xs: 9, sm: 11 },
      height: { xs: 9, sm: 11 },
      borderRadius: '50%',
      backgroundColor: color,
    }} />
  );
}

function App() {
  const { file: fileUrl } = useQueryParams();
  const [pyReady, setPyReady] = useState(false);
  const [statusText, setStatusText] = useState('Loading Python runtime...');
  const statusRef = useRef(null); // direct DOM updates during analysis to avoid re-renders
  const [processing, setProcessing] = useState(false);
  // Health: 'loading' (init/processing), 'ok' (ready/complete), 'warning' (future), 'error'
  const [statusIndicator, setStatusIndicator] = useState('loading');
  const [audioInfo, setAudioInfo] = useState(null);
  const [error, setError] = useState(null);
  const [errorTrace, setErrorTrace] = useState('');
  const audioRef = useRef(null); // keep PCM data for region re-analysis
  const [analysisOpts, setAnalysisOpts] = useState(() => {
    try {
      const pref = localStorage.getItem('fmBwPreference');
      if (pref === 'aes_min') return { fm_bw: 'aes_min' };
    } catch {}
    return {};
  });

  // Single analysis entry point for audio — ensures opts and UI state are always consistent
  const analysisOptsRef = useRef(analysisOpts);
  analysisOptsRef.current = analysisOpts;
  const runAnalysis = useCallback((pcm, sampleRate, statusMsg, optsOverrides) => {
    const opts = { ...analysisOptsRef.current, ...optsOverrides };
    setProcessing(true);
    setStatusIndicator('loading');
    setStatusText(statusMsg);
    return analyzeFull(pcm, sampleRate, 'audio', opts);
  }, []);

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
        setStatusText('Ready');
        setStatusIndicator('ok');
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
      setStatusText('Analysis complete');
      setStatusIndicator('ok');
      if (statusRef.current) statusRef.current.textContent = 'Analysis complete';
    });

    onError((msg, traceback) => {
      setError(msg);
      setErrorTrace(traceback);
      setProcessing(false);
      setStatusIndicator('error');
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

    const isText = file.name.match(/\.txt$/i);
    const isAudio = file.name.match(/\.(wav|flac)$/i);

    if (!isText && !isAudio) {
      setError('Unsupported file format. Please use WAV, FLAC, or TXT (shaknspin).');
      return;
    }

    try {
      if (isText) {
        setStatusText('Reading text file...');
        const text = await file.text();
        audioRef.current = null;
        setAudioInfo({
          fileName: file.name,
          sampleRate: null,
          channels: null,
          duration: null,
          inputType: 'device',
        });
        setProcessing(true); setStatusIndicator('loading');
        setStatusText('Starting analysis...');
        await analyzeFull(text, null, 'device');
      } else {
        setStatusText('Loading file...');
        const audio = await loadAudioFile(file);

        // Keep PCM only in ref (not React state) — large typed arrays in
        // React state cause Safari to stall 10-12s during rendering.
        const { pcm, ...audioMeta } = audio;
        audioRef.current = { pcm, sampleRate: audio.sampleRate };
        setAudioInfo(audioMeta);

        await runAnalysis(pcm, audio.sampleRate, 'Starting analysis...');
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('device format')) {
        setError('This text file format isn\'t recognized. Currently only shaknspin exports are supported.');
      } else {
        setError(msg);
      }
    }
  }, [runAnalysis]);

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
        setStatusText('Fetching file from URL...');
        const audio = await loadAudioFromUrl(fileUrl);
        const { pcm, ...audioMeta } = audio;
        audioRef.current = { pcm, sampleRate: audio.sampleRate };
        setAudioInfo(audioMeta);
        await runAnalysis(pcm, audio.sampleRate, 'Starting analysis...');
        // Strip all query params after successful load
        window.history.replaceState({}, '', window.location.pathname);
      } catch (e) {
        setError(String(e));
        setStatusText('URL load failed');
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
    const dur = audioInfo?.duration ?? fullResult?.metrics?.duration ?? 0;
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
      runAnalysis(pcm, sampleRate, 'Restoring full-file analysis...');
      return;
    }

    const { pcm, sampleRate } = audioRef.current;
    const startIdx = Math.round(startSec * sampleRate);
    const endIdx = Math.round(endSec * sampleRate);
    const slice = pcm.slice(startIdx, endIdx);

    isRegionMeasureRef.current = true;
    pendingRegionRef.current = [startSec, endSec];
    // Pass full-file detected RPM so wf_core doesn't re-detect on short slice
    const detectedRpm = fullResult?.metrics?.rpm?.value;
    const regionOverrides = detectedRpm && !analysisOpts.rpm ? { rpm: detectedRpm } : {};
    runAnalysis(slice, sampleRate, 'Re-measuring region...', regionOverrides);
  }, [audioInfo, fullResult, runAnalysis]);

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

  // Re-analyze with additional params (e.g. RPM, fm_bw from config tab)
  const handleReanalyze = useCallback(async (opts) => {
    if (!audioRef.current) return;
    setAnalysisOpts(prev => ({ ...prev, ...opts }));
    const { pcm, sampleRate } = audioRef.current;
    await runAnalysis(pcm, sampleRate, 'Re-analyzing...', opts);
  }, [runAnalysis]);

  const hasFile = !!audioInfo;

  return (
    <Layout>
      {/* Status row — with inline file chooser after first load */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ position: 'relative', pl: '3ch', flex: 1 }}>
          {processing
            ? <CircularProgress size={14} sx={{ position: 'absolute', left: { xs: 9, sm: 6 }, top: { xs: 2, sm: -1 }, mt: { xs: '4px', sm: '5px' } }} />
            : statusIndicator !== 'loading' && <StatusDot status={statusIndicator} />
          }
          <Typography ref={statusRef} variant="body2" color="text.secondary">
            {statusText}
          </Typography>
        </Box>
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
        totalDuration={audioInfo?.duration ?? fullResult?.metrics?.duration}
        harmonicOverlays={harmonicOverlays}
        processing={processing}
        onMeasureRegion={audioInfo?.inputType !== 'device' ? handleMeasureRegion : null}
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
        fmBwInfo={activeResult?.metrics?.fm_bw}
        inputType={audioInfo?.inputType}
      />
    </Layout>
  );
}

export default App;
