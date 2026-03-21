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

/** Check if Pyodide's WASM memory is still alive (mobile Safari evicts on background). */
function _pyodideAlive() {
  if (!_pyodide) return false;
  try {
    _pyodide.runPython('1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the Python bridge. Call once on app mount.
 * Loads Pyodide, numpy, scipy, and wf_core.py on the main thread.
 * Re-initializes if WASM memory was evicted (mobile Safari background).
 */
export function initPyBridge() {
  if (_initPromise && _pyodideAlive()) return;
  // WASM dead or never initialized — reset and start fresh
  _pyodide = null;
  _ready = false;
  _initPromise = null;
  globalThis.__pyodide = null;
  globalThis.__pyodideReady = false;
  globalThis.__pyodideInitPromise = null;
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
    const resp = await fetch('/python/wf_core.py');
    if (!resp.ok) {
      throw new Error(`Failed to fetch wf_core.py: ${resp.status} ${resp.statusText}`);
    }
    const moduleCode = await resp.text();
    _pyodide.runPython(moduleCode);

    // Status callback returns a Promise so Python (via runPythonAsync) yields
    // to the browser event loop, allowing React to re-render between stages.
    let _lastWall = performance.now();
    const statusCallback = (msg) => {
      const now = performance.now();
      const str = String(msg);
      console.log(`[wf_core] ${str} — ${(now - _lastWall).toFixed(0)} ms`);
      _lastWall = now;
      _onStatus?.(str);
      return new Promise(r => requestAnimationFrame(r));
    };
    _pyodide.globals.set('_js_status_callback', statusCallback);
    _pyodide.runPython(`
import json as _json
import numpy as _np

def _np_default(obj):
    if isinstance(obj, _np.bool_):
        return bool(obj)
    if isinstance(obj, _np.integer):
        return int(obj)
    if isinstance(obj, _np.floating):
        return float(obj)
    if isinstance(obj, _np.ndarray):
        return obj.tolist()
    raise TypeError(f'Object of type {type(obj).__name__} is not JSON serializable')

set_status_callback(_js_status_callback)
`);

    _ready = true;
    globalThis.__pyodide = _pyodide;
    globalThis.__pyodideReady = true;
    globalThis.__pyodideInitPromise = _initPromise;
    _onStatus?.('Ready');
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
const _ANALYSIS_PY = `
import numpy as np
import traceback as _tb

_worker_result = None
_worker_error = None

try:
    _pcm = np.asarray(_pcm_data.to_py(), dtype=np.float64)
    _sr = int(_sample_rate)
    _result = await analyzeFull(_pcm, _sr)

    # Convert large numpy arrays in-place via .tolist() (C-level, fast).
    for _k in ('t', 'deviation_pct'):
        _arr = _result.get('plots', {}).get('dev_time', {}).get(_k)
        if _arr is not None and hasattr(_arr, 'tolist'):
            _result['plots']['dev_time'][_k] = _arr.tolist()
    for _k in ('freqs', 'amplitude'):
        _arr = _result.get('plots', {}).get('spectrum', {}).get(_k)
        if _arr is not None and hasattr(_arr, 'tolist'):
            _result['plots']['spectrum'][_k] = _arr.tolist()
    # Small numpy scalars/bools in metrics and peaks handled by default hook
    def _np_default(obj):
        if isinstance(obj, _np.bool_):
            return bool(obj)
        if isinstance(obj, _np.integer):
            return int(obj)
        if isinstance(obj, _np.floating):
            return float(obj)
        if isinstance(obj, _np.ndarray):
            return obj.tolist()
        raise TypeError(f'Object of type {type(obj).__name__} is not JSON serializable')
    _worker_result = _json.dumps(_result, default=_np_default)
except Exception as _e:
    _worker_error = _json.dumps({"message": str(_e), "traceback": _tb.format_exc()})
finally:
    del _pcm_data, _sample_rate
    # Clean up intermediate variables to free WASM memory
    for _v in ('_pcm', '_sr', '_result', '_e'):
        if _v in dir():
            exec(f'del {_v}')
    import gc; gc.collect()
`;

const MAX_RETRIES = 2;

export async function analyzeFull(pcmData, sampleRate) {
  if (!_ready || !_pyodideAlive()) {
    console.warn('[wf_core] Pyodide not ready or WASM evicted, reinitializing...');
    _onStatus?.('Reinitializing Python runtime...');
    initPyBridge();
    await _initPromise;
    if (!_ready) {
      _onError?.('Python runtime failed to reinitialize', '');
      return;
    }
  }

  const f64 = pcmData instanceof Float64Array
    ? pcmData
    : new Float64Array(pcmData);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      _pyodide.globals.set('_pcm_data', f64);
      _pyodide.globals.set('_sample_rate', sampleRate);

      await _pyodide.runPythonAsync(_ANALYSIS_PY);

      const resultJson = _pyodide.globals.get('_worker_result');
      const errorJson = _pyodide.globals.get('_worker_error');

      _pyodide.runPython('del _worker_result, _worker_error');

      if (errorJson) {
        const err = JSON.parse(errorJson);
        if (attempt < MAX_RETRIES - 1) {
          console.warn(`[wf_core] Attempt ${attempt + 1} failed: ${err.message}, retrying...`);
          await new Promise(r => setTimeout(r, 250));
          continue;
        }
        _onError?.(err.message, err.traceback);
      } else if (resultJson) {
        const data = JSON.parse(resultJson);
        _onResult?.(data);
      }
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[wf_core] Attempt ${attempt + 1} threw: ${err}, retrying...`);
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      _onError?.(String(err), err?.stack || '');
    }
  }
}

/**
 * Fetch on-demand plot data from stashed Python state.
 * @param {string} plotId - Plot identifier (e.g. 'polar', 'histogram', 'lissajous')
 * @param {object} [params={}] - Plot-specific parameters
 * @returns {object|null} Plot data, or null on error
 */
export function getPlotData(plotId, params = {}) {
  if (!_ready) {
    _onError?.('Python runtime not ready', '');
    return null;
  }

  try {
    _pyodide.globals.set('_plot_id', plotId);
    _pyodide.globals.set('_plot_params', JSON.stringify(params));

    _pyodide.runPython(`
import traceback as _tb

_plot_result = None
_plot_error = None

try:
    _params = _json.loads(_plot_params)
    _data = getPlotData(_plot_id, _params)
    _plot_result = _json.dumps(_data, default=_np_default)
except Exception as _e:
    _plot_error = _json.dumps({"message": str(_e), "traceback": _tb.format_exc()})
finally:
    del _plot_id, _plot_params
    for _v in ('_params', '_data', '_e'):
        if _v in dir():
            exec(f'del {_v}')
`);

    const resultJson = _pyodide.globals.get('_plot_result');
    const errorJson = _pyodide.globals.get('_plot_error');

    _pyodide.runPython('del _plot_result, _plot_error');

    if (errorJson) {
      const err = JSON.parse(errorJson);
      _onError?.(err.message, err.traceback);
      return null;
    }
    return resultJson ? JSON.parse(resultJson) : null;
  } catch (err) {
    _onError?.(String(err), err?.stack || '');
    return null;
  }
}
