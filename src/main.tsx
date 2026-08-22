import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { App } from './App';
import { GlobalStyle } from './GlobalStyle';
import { theme } from './theme';
import { registerPwa } from './pwa/registerPwa';
import { seedBundledLines } from './storage/seedData';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

// Before the first render, so the lines list never paints without the bundled repertoire and
// never has to re-read the store. Synchronous (the files are in the bundle), seeds each line
// exactly once ever, and reports what it could not read through `seedReport()`.
seedBundledLines();

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
