import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// first, so its popstate listener runs before wouter re-renders the page that reads it
import './lib/scroll';
import App from './App';
import { startChunkRecovery } from './lib/chunks';
import { startWarming } from './routes';
import './styles/base.css';

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
