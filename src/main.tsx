import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { App } from './App';
import { GlobalStyle } from './GlobalStyle';
import { theme } from './theme';
import { registerPwa } from './pwa/registerPwa';
import { loadBundledLines } from './storage/seedData';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

// Before the first render, so the lines list never paints without the bundled repertoire.
// Synchronous (the files are in the bundle), runs on every load so the bundled lines always match
// this build, never touches the user's own lines, and reports what it could not read through
// `seedReport()`.
loadBundledLines();

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// After the render call, and internally deferred to `window.load`: precaching the ~7 MB engine
// wasm must never compete with first paint (see src/pwa/registerPwa.ts).
registerPwa();
