import { useEffect } from 'react';
import { BottomBar } from './hud/BottomBar.tsx';
import { ComparePanel } from './hud/ComparePanel.tsx';
import { Inspector } from './hud/Inspector.tsx';
import { OpsPanel } from './hud/OpsPanel.tsx';
import { TopBar } from './hud/TopBar.tsx';
import { CityCanvas } from './scene/CityCanvas.tsx';
import { SPEEDS, useApp } from './state/store.ts';

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useApp.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.togglePause();
      } else if (e.key === 'Escape') {
        if (s.compareOpen) return s.setCompareOpen(false);
        s.selectBin(null);
        s.selectTruck(null);
      } else if (e.key === 'c') {
        s.setCompareOpen(!s.compareOpen);
      } else if (/^[1-5]$/.test(e.key)) {
        s.setSpeed(SPEEDS[Number(e.key) - 1]);
      } else if (e.key === 'n') {
        s.skipToNextShift();
      } else if (e.key === 'v') {
        s.toggleDataView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useHotkeys();
  const leftOpen = useApp((s) => s.leftOpen);
  return (
    <div className="fixed inset-0 select-none">
      <div className="absolute inset-0">
        <CityCanvas />
      </div>
      <TopBar />
      <div className="pointer-events-none absolute bottom-[156px] left-3 top-[76px] z-40 flex">{leftOpen && <OpsPanel />}</div>
      <div className="pointer-events-none absolute bottom-[156px] right-3 top-[76px] z-40 hidden md:flex">
        <Inspector />
      </div>
      <BottomBar />
      <ComparePanel />
    </div>
  );
}
