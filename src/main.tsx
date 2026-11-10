import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// first, so its popstate listener runs before wouter re-renders the page that reads it
import './lib/scroll';
import App from './App';
import { startChunkRecovery } from './lib/chunks';
import { startWarming } from './routes';
import './styles/base.css';

// Web fonts come in their own stylesheet so their ~300 @font-face rules don't hold up first paint; until a
// face arrives the text shows in the next font of its stack (font-display: swap). In a build index.html
// already links it (see the fonts plugin in vite.config.ts) and this import adds nothing.
void import('virtual:fonts.css');

// Workers static assets redirect /@handle to /%40handle on a full page load; show the @ again.
if (location.pathname.startsWith('/%40')) {
  history.replaceState(history.state, '', `/@${location.pathname.slice(4)}${location.search}${location.hash}`);
}

startChunkRecovery();
startWarming();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
