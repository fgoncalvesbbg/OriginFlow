/** Application entry point: mounts the React root into the DOM. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../styles/animations.css';
import '../styles/print.css';
// Klarstein brand layer for the supplier-facing portals. Everything in it is scoped under
// `html.klarstein-brand`, which only <PortalTheme> sets, so importing it here is inert for
// the internal app.
import '../styles/klarstein-brand.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);