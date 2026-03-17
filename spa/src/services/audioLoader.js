/**
 * Audio file loading and pre-processing pipeline.
 * WAV parsing (Phase 1), FLAC decode, carrier detection,
 * adaptive downsample, non-signal trimming, duration cap (Phase 2).
 */

import { FLACDecoder } from '@wasm-audio-decoders/flac';
import {
  MAX_FILE_DURATION_SECONDS,
  MIN_SAMPLE_RATE,
  DOWNSAMPLE_THRESHOLDS,
} from '../config/constants.js';

// ---------------------------------------------------------------------------
// WAV Parser (Phase 1 — unchanged)
// ---------------------------------------------------------------------------

/**
 * Parse a WAV file from an ArrayBuffer.
 * Handles 16-bit, 24-bit, 32-bit int and 32-bit float PCM.
 * Returns mono (left channel for stereo).
 */
export function parseWav(buffer, fileName) {
  const view = new DataView(buffer);

  const riff = String.fromCharCode(
    view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3),
  );
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  const wave = String.fromCharCode(
    view.getUint8(8), view.getUint8(9),
    view.getUint8(10), view.getUint8(11),
  );
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file (missing WAVE format)');
  }

  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (dataOffset === 0) {
    throw new Error('No data chunk found in WAV file');
  }

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV format (audioFormat=${audioFormat}). ` +
      'Only PCM and IEEE float are supported.',
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataSize / bytesPerSample;
  const samplesPerChannel = totalSamples / numChannels;

  const pcm = new Float32Array(samplesPerChannel);

  for (let i = 0; i < samplesPerChannel; i++) {
    const bytePos = dataOffset + i * numChannels * bytesPerSample;

    if (audioFormat === 3 && bitsPerSample === 32) {
      pcm[i] = view.getFloat32(bytePos, true);
    } else if (bitsPerSample === 16) {
      pcm[i] = view.getInt16(bytePos, true) / 32768.0;
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(bytePos);
      const b1 = view.getUint8(bytePos + 1);
      const b2 = view.getUint8(bytePos + 2);
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= ~0xFFFFFF;
      pcm[i] = val / 8388608.0;
    } else if (bitsPerSample === 32) {
      pcm[i] = view.getInt32(bytePos, true) / 2147483648.0;
    } else {
      throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
    }
  }

  return {
    pcm,
    sampleRate,
    channels: numChannels,
    duration: samplesPerChannel / sampleRate,
    fileName,
  };
}

// ---------------------------------------------------------------------------
// FLAC Decoder
// ---------------------------------------------------------------------------

let _flacDecoder = null;

async function getFlacDecoder() {
  if (!_flacDecoder) {
    _flacDecoder = new FLACDecoder();
    await _flacDecoder.ready;
  }
  return _flacDecoder;
}

/**
 * Detect FLAC by magic bytes (fLaC) at offset 0.
 */
function isFlac(buffer) {
  if (buffer.byteLength < 4) return false;
  const view = new DataView(buffer);
  return (
    view.getUint8(0) === 0x66 && // f
    view.getUint8(1) === 0x4C && // L
    view.getUint8(2) === 0x61 && // a
    view.getUint8(3) === 0x43    // C
  );
}

/**
 * Decode FLAC ArrayBuffer → { pcm: Float32Array, sampleRate, channels, duration, fileName }.
 * Returns left channel for stereo.
 */
async function decodeFlac(buffer, fileName) {
  const decoder = await getFlacDecoder();
  const { channelData, sampleRate, samplesDecoded } = await decoder.decodeFile(new Uint8Array(buffer));

  if (!channelData || channelData.length === 0 || samplesDecoded === 0) {
    throw new Error('FLAC decode returned no audio data');
  }

  // channelData is array of Float32Arrays, one per channel
  const pcm = channelData[0]; // left channel
  return {
    pcm,
    sampleRate,
    channels: channelData.length,
    duration: samplesDecoded / sampleRate,
    fileName,
  };
}

// ---------------------------------------------------------------------------
// Quick Carrier Detection (JS-side FFT for downsample decision only)
// ---------------------------------------------------------------------------

/**
 * Detect dominant carrier frequency from the first ~2s of audio using Web Audio FFT.
 * Used only for choosing the downsample target rate.
 * Returns frequency in Hz, or null if detection fails.
 */
async function detectCarrierFrequency(pcm, sampleRate) {
  // Use first 2 seconds (or full signal if shorter)
  const samplesToUse = Math.min(pcm.length, sampleRate * 2);

  // FFT size — power of 2, at least 8192 for reasonable resolution
  const fftSize = 8192;
  if (samplesToUse < fftSize) return null;

  // Use OfflineAudioContext to compute FFT via AnalyserNode
  const ctx = new OfflineAudioContext(1, samplesToUse, sampleRate);
  const buf = ctx.createBuffer(1, samplesToUse, sampleRate);
  buf.getChannelData(0).set(pcm.subarray(0, samplesToUse));

  const source = ctx.createBufferSource();
  source.buffer = buf;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  source.start();

  await ctx.startRendering();

  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);

  // Find peak above 20 Hz
  const binWidth = sampleRate / fftSize;
  const minBin = Math.ceil(20 / binWidth);
  let maxVal = -Infinity;
  let maxBin = minBin;

  for (let i = minBin; i < freqData.length; i++) {
    if (freqData[i] > maxVal) {
      maxVal = freqData[i];
      maxBin = i;
    }
  }

  return maxBin * binWidth;
}

// ---------------------------------------------------------------------------
// Adaptive Downsample via OfflineAudioContext
// ---------------------------------------------------------------------------

/**
 * Downsample PCM if needed based on detected carrier frequency.
 * Returns { pcm, sampleRate, wasDownsampled, originalSampleRate }.
 */
async function adaptiveDownsample(pcm, sampleRate, carrierHz) {
  let targetRate = sampleRate; // default: no downsample

  if (carrierHz !== null) {
    const { LOW_CARRIER_HZ, LOW_TARGET_RATE, HIGH_CARRIER_HZ, HIGH_TARGET_RATE } = DOWNSAMPLE_THRESHOLDS;
    if (carrierHz < LOW_CARRIER_HZ) {
      targetRate = LOW_TARGET_RATE;
    } else if (carrierHz < HIGH_CARRIER_HZ) {
      targetRate = HIGH_TARGET_RATE;
    }
  }

  if (sampleRate <= targetRate) {
    return { pcm, sampleRate, wasDownsampled: false, originalSampleRate: sampleRate };
  }

  // OfflineAudioContext handles anti-alias filtering automatically
  const targetLength = Math.round(pcm.length * targetRate / sampleRate);
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);

  const buf = offlineCtx.createBuffer(1, pcm.length, sampleRate);
  buf.getChannelData(0).set(pcm);

  const source = offlineCtx.createBufferSource();
  source.buffer = buf;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return {
    pcm: rendered.getChannelData(0),
    sampleRate: targetRate,
    wasDownsampled: true,
    originalSampleRate: sampleRate,
  };
}

// ---------------------------------------------------------------------------
// Non-signal Trimming
// ---------------------------------------------------------------------------

/**
 * Trim silence/noise from head and tail of PCM data.
 * Uses RMS of middle 10% as reference, scans outward for onset.
 */
function trimNonSignal(pcm, sampleRate) {
  const len = pcm.length;
  if (len === 0) return pcm;

  // Compute reference RMS from middle 10%
  const midStart = Math.floor(len * 0.45);
  const midEnd = Math.floor(len * 0.55);
  let sumSq = 0;
  for (let i = midStart; i < midEnd; i++) {
    sumSq += pcm[i] * pcm[i];
  }
  const midRms = Math.sqrt(sumSq / (midEnd - midStart));

  if (midRms === 0) return pcm; // silent file, nothing to trim

  // Threshold: -20 dB below midpoint RMS
  const threshold = midRms * 0.1; // 10^(-20/20) = 0.1

  // Window size for running RMS (~10ms)
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));

  // Scan from head
  let headIdx = 0;
  for (let i = 0; i <= len - windowSize; i += windowSize) {
    let ws = 0;
    for (let j = i; j < i + windowSize; j++) {
      ws += pcm[j] * pcm[j];
    }
    if (Math.sqrt(ws / windowSize) >= threshold) {
      headIdx = i;
      break;
    }
  }

  // Scan from tail
  let tailIdx = len;
  for (let i = len - windowSize; i >= 0; i -= windowSize) {
    let ws = 0;
    for (let j = i; j < i + windowSize; j++) {
      ws += pcm[j] * pcm[j];
    }
    if (Math.sqrt(ws / windowSize) >= threshold) {
      tailIdx = Math.min(len, i + windowSize);
      break;
    }
  }

  // Add ~50ms margin before onset, ~50ms after offset
  const marginSamples = Math.round(sampleRate * 0.05);
  headIdx = Math.max(0, headIdx - marginSamples);
  tailIdx = Math.min(len, tailIdx + marginSamples);

  if (headIdx >= tailIdx) return pcm; // edge case: don't trim to nothing

  return pcm.subarray(headIdx, tailIdx);
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Load and pre-process an audio file.
 * @param {File} file
 * @returns {Promise<object>} Processed audio info
 */
export async function loadAudioFile(file) {
  let _t = performance.now();
  const _lap = (label) => {
    const now = performance.now();
    console.log(`[MAIN] ${label}: ${(now - _t).toFixed(0)} ms`);
    _t = now;
  };

  // Read file
  const buffer = await file.arrayBuffer();
  _lap('file.arrayBuffer()');

  // Detect format and decode
  let raw;
  if (isFlac(buffer) || file.name.match(/\.flac$/i)) {
    raw = await decodeFlac(buffer, file.name);
    _lap('decodeFlac');
  } else if (file.name.match(/\.wav$/i)) {
    raw = parseWav(buffer, file.name);
    _lap('parseWav');
  } else {
    throw new Error('Unsupported file format. Please use WAV or FLAC.');
  }

  // Sample rate check
  if (raw.sampleRate < MIN_SAMPLE_RATE) {
    throw new Error(
      `Sample rate too low (${raw.sampleRate} Hz). Minimum ${MIN_SAMPLE_RATE} Hz required.`,
    );
  }

  // Carrier detection — kept for UI info, but JS-side downsampling is disabled.
  // Browser OfflineAudioContext resampling introduces phase distortion that
  // corrupts zero-crossing timing and produces incorrect W&F numbers.
  // Python handles native sample rates fast enough (~220ms for 105Hz/67s).
  const detectedCarrierHz = await detectCarrierFrequency(raw.pcm, raw.sampleRate);
  _lap('detectCarrierFrequency');

  // No JS-side downsample — pass native rate through to Python
  const ds = { pcm: raw.pcm, sampleRate: raw.sampleRate, wasDownsampled: false, originalSampleRate: raw.sampleRate };

  // Non-signal trimming
  let pcm = trimNonSignal(ds.pcm, ds.sampleRate);
  _lap('trimNonSignal');

  // Track original duration before cap
  const originalDuration = pcm.length / ds.sampleRate;

  // Duration cap
  let wasTruncated = false;
  const maxSamples = MAX_FILE_DURATION_SECONDS * ds.sampleRate;
  if (pcm.length > maxSamples) {
    pcm = pcm.subarray(0, maxSamples);
    wasTruncated = true;
  }

  const duration = pcm.length / ds.sampleRate;

  return {
    pcm,
    sampleRate: ds.sampleRate,
    channels: raw.channels,
    duration,
    fileName: raw.fileName,
    originalDuration,
    wasTruncated,
    wasDownsampled: ds.wasDownsampled,
    originalSampleRate: ds.originalSampleRate,
    detectedCarrierHz,
  };
}
