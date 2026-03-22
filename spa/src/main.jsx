import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/index.js';
import App from './App.jsx';

// Wait for service worker to control the page before mounting.
// mini-coi.js registers a SW and reloads on first visit — starting
// Pyodide/fetch before the SW is active causes aborted requests.
async function mount() {
  if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      // Safety timeout — don't block forever if SW fails to activate
      setTimeout(resolve, 3000);
    });
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

mount();
