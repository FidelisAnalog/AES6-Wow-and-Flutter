/**
 * Web Worker: loads Pyodide + wf_core.py, runs analysis off main thread.
 *
 * Messages IN:
 *   { type: 'analyze', pcm: ArrayBuffer, sampleRate: number }
 *
 * Messages OUT:
 *   { type: 'ready' }
 *   { type: 'status', message: string }
 *   { type: 'result', data: object }
 *   { type: 'error', message: string, traceback: string }
 */

// Pin Pyodide version — update deliberately, not accidentally
const PYODIDE_VERSION = '0.27.5';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;

let pyodide = null;

/**
 * Bootstrap: load Pyodide, install packages, load wf_core.py,
 * wire up status callback. Posts { type: 'ready' } when done.
 */
async function init() {
  try {
    self.postMessage({ type: 'status', message: 'Loading Python runtime...' });

    // Load Pyodide
    importScripts(PYODIDE_URL);
    pyodide = await self.loadPyodide();

    self.postMessage({ type: 'status', message: 'Installing numpy + scipy...' });

    // Install packages — these are Pyodide built-in wheels, no network fetch
    await pyodide.loadPackage(['numpy', 'scipy']);

    self.postMessage({ type: 'status', message: 'Loading analyzer module...' });

    // Fetch wf_core.py from the app's public directory.
    // In dev (vite dev server) this is served from /python/wf_core.py.
    // In production build it's in the dist output.
    const resp = await fetch('/python/wf_core.py');
    if (!resp.ok) {
      throw new Error(`Failed to fetch wf_core.py: ${resp.status} ${resp.statusText}`);
    }
    const moduleCode = await resp.text();

    // Execute the module in Pyodide's global scope
    pyodide.runPython(moduleCode);

    // Wire up status callback: Python calls set_status_callback(fn).
    // We create a JS function and pass it in — postMessage must be called
    // from JS (not Python) because Python dicts are Pyodide proxies that
    // can't be structurally cloned by postMessage.
    let _lastWall = performance.now();
    const statusCallback = (msg) => {
      const now = performance.now();
      console.log(`[WALL] _status("${String(msg)}") — ${(now - _lastWall).toFixed(0)} ms since last`);
      _lastWall = now;
      self.postMessage({ type: 'status', message: String(msg) });
      const afterPost = performance.now();
      console.log(`[WALL] postMessage took ${(afterPost - now).toFixed(0)} ms`);
      _lastWall = afterPost;
    };
    pyodide.globals.set('_js_status_callback', statusCallback);

    pyodide.runPython(`
import json as _json
set_status_callback(_js_status_callback)
`);

    self.postMessage({ type: 'status', message: 'Python runtime ready' });
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: 'Failed to initialize Python runtime',
      traceback: String(err?.stack || err),
    });
  }
}

/**
 * Run full analysis. PCM arrives as ArrayBuffer (transferred from main thread).
 * Python errors are caught at the Python level to get proper tracebacks.
 * All postMessage calls happen from JS — Python dicts are Pyodide proxies
 * that can't be structurally cloned by postMessage.
 */
function runAnalyze(pcmBuffer, sampleRate) {
  const pcmArray = new Float64Array(pcmBuffer);

  console.log(`[WALL] runAnalyze start — ${pcmArray.length} samples`);
  const t0 = performance.now();

  // Pass data into Python's global scope
  pyodide.globals.set('_pcm_data', pcmArray);
  pyodide.globals.set('_sample_rate', sampleRate);

  console.log(`[WALL] globals.set done: ${(performance.now() - t0).toFixed(0)} ms`);

  // Python catches its own errors for full tracebacks.
  // Stores result/error as JSON strings in globals for JS to retrieve.
  const t1 = performance.now();
  pyodide.runPython(`
import numpy as np
import traceback as _tb

_worker_result = None
_worker_error = None

try:
    _pcm = np.asarray(_pcm_data.to_py(), dtype=np.float64)
    _sr = int(_sample_rate)
    _result = analyzeFull(_pcm, _sr)
    _worker_result = _json.dumps(_result)
except Exception as _e:
    _worker_error = _json.dumps({"message": str(_e), "traceback": _tb.format_exc()})
finally:
    del _pcm_data, _sample_rate
`);

  console.log(`[WALL] runPython total: ${(performance.now() - t1).toFixed(0)} ms`);

  // Retrieve from Python globals and postMessage from JS
  const resultJson = pyodide.globals.get('_worker_result');
  const errorJson = pyodide.globals.get('_worker_error');

  if (errorJson) {
    const err = JSON.parse(errorJson);
    self.postMessage({ type: 'error', message: err.message, traceback: err.traceback });
  } else if (resultJson) {
    self.postMessage({ type: 'result', data: resultJson });
  }

  // Clean up Python globals
  pyodide.runPython('del _worker_result, _worker_error');
}

// Message handler
self.onmessage = (e) => {
  const { type } = e.data;

  if (!pyodide && type !== 'init') {
    self.postMessage({
      type: 'error',
      message: 'Python runtime not loaded yet',
      traceback: '',
    });
    return;
  }

  try {
    if (type === 'analyze') {
      runAnalyze(e.data.pcm, e.data.sampleRate);
    }
  } catch (err) {
    // This catches JS-level errors (e.g. Pyodide proxy failures).
    // Python-level errors are caught inside runPython above.
    self.postMessage({
      type: 'error',
      message: String(err),
      traceback: err?.stack || '',
    });
  }
};

// Start loading immediately
init();
