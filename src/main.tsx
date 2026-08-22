import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { App } from './App';
import { GlobalStyle } from './GlobalStyle';
import { theme } from './theme';
import { registerPwa } from './pwa/registerPwa';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

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
