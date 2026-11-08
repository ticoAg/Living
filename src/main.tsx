import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/base.css';

// Workers static assets redirect /@handle to /%40handle on a full page load; show the @ again.
if (location.pathname.startsWith('/%40')) {
  history.replaceState(history.state, '', `/@${location.pathname.slice(4)}${location.search}${location.hash}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
