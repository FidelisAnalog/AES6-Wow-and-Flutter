/**
 * JS <-> Python bridge via Web Worker + Pyodide.
 *
 * Main thread interface: spawns a Web Worker that runs Pyodide,
 * communicates via postMessage. PCM data transferred as ArrayBuffer
 * (zero-copy). Status updates, results, and errors (with Python
 * stack traces) all come back through postMessage.
 */

let _worker = null;
let _onStatus = null;
let _onResult = null;
let _onError = null;
let _ready = false;

/**
 * Initialize the Python bridge. Call once on app mount.
 * Spawns the Pyodide Web Worker and wires up message handlers.
 */
export function initPyBridge() {
  // Spawn worker — Vite handles the URL via ?worker&url import
  // Using standard Worker constructor with module path
  _worker = new Worker(
    new URL('../workers/pyodideWorker.js', import.meta.url),
    { type: 'classic' }
  );

  _worker.onmessage = (e) => {
    const msg = e.data;

    switch (msg.type) {
      case 'ready':
        _ready = true;
        _onStatus?.('Python runtime ready');
        break;

      case 'status':
        _onStatus?.(msg.message);
        break;

      case 'result': {
        // Worker sends JSON string — parse it
        let data;
        try {
          data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        } catch (parseErr) {
          _onError?.('Failed to parse analysis results', String(parseErr));
          return;
        }
        _onResult?.(data);
        break;
      }

      case 'error':
        _onError?.(msg.message, msg.traceback || '');
        break;
    }
  };

  _worker.onerror = (err) => {
    _onError?.(
      'Worker error: ' + (err.message || 'unknown'),
      err.filename ? `${err.filename}:${err.lineno}` : '',
    );
  };
}

/** @param {(message: string) => void} cb */
export function onStatus(cb) { _onStatus = cb; }

/** @param {(result: object) => void} cb */
export function onResult(cb) { _onResult = cb; }

/** @param {(message: string, traceback: string) => void} cb */
export function onError(cb) { _onError = cb; }

export function isReady() { return _ready; }

/**
 * Run full analysis on PCM data.
 * @param {Float32Array|Float64Array} pcmData
 * @param {number} sampleRate
 */
export function analyzeFull(pcmData, sampleRate) {
  if (!_ready) {
    _onError?.('Python runtime not ready', '');
    return;
  }

  // Convert to Float64Array if needed (Python expects float64)
  const f64 = pcmData instanceof Float64Array
    ? pcmData
    : new Float64Array(pcmData);

  // Transfer the buffer to the worker (zero-copy)
  const buffer = f64.buffer;
  _worker.postMessage(
    { type: 'analyze', pcm: buffer, sampleRate },
    [buffer],
  );
}

/**
 * Run analysis on a sub-region.
 * @param {Float32Array|Float64Array} pcmData
 * @param {number} sampleRate
 * @param {number} startSec
 * @param {number} endSec
 */
export function analyzeRegion(pcmData, sampleRate, startSec, endSec) {
  if (!_ready) {
    _onError?.('Python runtime not ready', '');
    return;
  }

  const f64 = pcmData instanceof Float64Array
    ? pcmData
    : new Float64Array(pcmData);

  const buffer = f64.buffer;
  _worker.postMessage(
    { type: 'analyzeRegion', pcm: buffer, sampleRate, startSec, endSec },
    [buffer],
  );
}
