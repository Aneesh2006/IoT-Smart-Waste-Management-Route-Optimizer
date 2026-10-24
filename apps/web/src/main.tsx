import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/space-grotesk';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

// No StrictMode: its double-mounted effects make drei's <Html> roots unmount mid-render.
createRoot(document.getElementById('root')!).render(<App />);

// Dev-only handles so the scene can be driven from devtools (or a hidden preview pane).
if (import.meta.env.DEV) {
  void Promise.all([import('@react-three/fiber'), import('./state/store.ts')]).then(([fiber, store]) => {
    Object.assign(window, { __app: store.useApp, __advance: fiber.advance });
  });
}
