/**
 * JS <-> Python bridge — runs Pyodide on the main thread.
 *
 * Previous architecture used a Web Worker, but Safari (and to a lesser
 * extent Chrome) blocks the main thread for 10-12s during worker WASM
 * execution due to browser-engine-level overhead. The actual Python
 * computation is ~250ms, so running on main thread is faster in practice.
 */

// Use globalThis to survive Vite HMR module re-evaluation
let _pyodide = globalThis.__pyodide ?? null;
let _onStatus = null;
let _onResult = null;
let _onError = null;
let _ready = globalThis.__pyodideReady ?? false;
let _initPromise = globalThis.__pyodideInitPromise ?? null;

const PYODIDE_VERSION = '0.27.5';

/**
 * Initialize the Python bridge. Call once on app mount.
 * Loads Pyodide, numpy, scipy, and wf_analyzer.py on the main thread.
 */
export function initPyBridge() {
  if (_initPromise) return; // Already initialized (React StrictMode double-mount)
  _initPromise = _init();
}

async function _init() {
  try {
    _onStatus?.('Loading Python runtime...');

    // Load Pyodide via script tag (dynamic import doesn't work through Vite)
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Pyodide script'));
      document.head.appendChild(script);
    });
    _pyodide = await globalThis.loadPyodide();

    _onStatus?.('Installing numpy + scipy...');
    await _pyodide.loadPackage(['numpy', 'scipy']);

    _onStatus?.('Loading analyzer module...');
    const resp = await fetch('/python/wf_analyzer.py');
    if (!resp.ok) {
      throw new Error(`Failed to fetch wf_analyzer.py: ${resp.status} ${resp.statusText}`);
    }
    const moduleCode = await resp.text();
    _pyodide.runPython(moduleCode);

    // Wire up status callback
    const statusCallback = (msg) => {
      _onStatus?.(String(msg));
    };
    _pyodide.globals.set('_js_status_callback', statusCallback);
    _pyodide.runPython(`
import json as _json
set_status_callback(_js_status_callback)
`);

    _ready = true;
    globalThis.__pyodide = _pyodide;
    globalThis.__pyodideReady = true;
    globalThis.__pyodideInitPromise = _initPromise;
    _onStatus?.('Python runtime ready');
  } catch (err) {
    _onError?.(
      'Failed to initialize Python runtime',
      String(err?.stack || err),
    );
  }
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

  const f64 = pcmData instanceof Float64Array
    ? pcmData
    : new Float64Array(pcmData);

  try {
    _pyodide.globals.set('_pcm_data', f64);
    _pyodide.globals.set('_sample_rate', sampleRate);

    _pyodide.runPython(`
import numpy as np
import traceback as _tb

_worker_result = None
_worker_error = None

try:
    _pcm = np.asarray(_pcm_data.to_py(), dtype=np.float64)
    _sr = int(_sample_rate)
    _result = analyze(_pcm, _sr)
    _worker_result = _json.dumps(_result)
except Exception as _e:
    _worker_error = _json.dumps({"message": str(_e), "traceback": _tb.format_exc()})
finally:
    del _pcm_data, _sample_rate
    # Clean up intermediate variables to free WASM memory
    for _v in ('_pcm', '_sr', '_result', '_e'):
        if _v in dir():
            exec(f'del {_v}')
    import gc; gc.collect()
`);

    const resultJson = _pyodide.globals.get('_worker_result');
    const errorJson = _pyodide.globals.get('_worker_error');

    _pyodide.runPython('del _worker_result, _worker_error');

    if (errorJson) {
      const err = JSON.parse(errorJson);
      _onError?.(err.message, err.traceback);
    } else if (resultJson) {
      const data = JSON.parse(resultJson);
      _onResult?.(data);
    }
  } catch (err) {
    _onError?.(String(err), err?.stack || '');
  }
}
