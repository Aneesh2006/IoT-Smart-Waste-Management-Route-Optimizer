import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/space-grotesk';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// /bin (audience) and /driver (crew) are phone pages: load them on their own so phones never download the 3D engine.
// No StrictMode: its double-mounted effects would open two MQTT connections in development.
if (window.location.pathname.startsWith('/bin')) {
  void import('./phone/PhoneApp.tsx').then(({ PhoneApp }) => root.render(<PhoneApp />));
} else if (window.location.pathname.startsWith('/driver')) {
  void import('./phone/DriverApp.tsx').then(({ DriverApp }) => root.render(<DriverApp />));
} else {
  void import('./App.tsx').then(({ App }) => root.render(<App />));
}

// Offline support in production builds: the service worker precaches the whole app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// Dev-only handles so the scene can be driven from devtools (or a hidden preview pane).
if (import.meta.env.DEV) {
  void Promise.all([import('@react-three/fiber'), import('./state/store.ts')]).then(([fiber, store]) => {
    Object.assign(window, { __app: store.useApp, __advance: fiber.advance });
  });
}
