import { useEffect } from 'react';
import { BottomBar } from './hud/BottomBar.tsx';
import { ComparePanel } from './hud/ComparePanel.tsx';
import { GuideModal } from './hud/GuideModal.tsx';
import { ImpactPanel } from './hud/ImpactPanel.tsx';
import { Inspector } from './hud/Inspector.tsx';
import { LabPanel } from './hud/LabPanel.tsx';
import { OpsPanel } from './hud/OpsPanel.tsx';
import { PolicyEditor } from './hud/PolicyEditor.tsx';
import { SceneLabels } from './hud/SceneLabels.tsx';
import { TopBar } from './hud/TopBar.tsx';
import { XRay } from './hud/XRay.tsx';
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
        if (s.labOpen) return s.setLabOpen(false);
        if (s.guideOpen) return s.setGuideOpen(false);
        if (s.editorOpen) return s.setEditorOpen(false);
        if (s.xrayOpen) return s.setXrayOpen(false);
        if (s.impactOpen) return s.setImpactOpen(false);
        if (s.replay) return s.exitReplay();
        s.selectBin(null);
        s.selectTruck(null);
      } else if (e.key === 'c') {
        s.setCompareOpen(!s.compareOpen);
      } else if (e.key === 'l') {
        s.setLabOpen(!s.labOpen);
      } else if (e.key === 'r') {
        if (s.replay) s.exitReplay();
        else s.startReplay();
      } else if (e.key === 'i') {
        s.setImpactOpen(!s.impactOpen);
      } else if (e.key === 'g') {
        s.cycleHeatmap();
      } else if (e.key === 'x') {
        s.setXrayOpen(!s.xrayOpen);
      } else if (e.key === '?' || e.key === 'h') {
        s.setGuideOpen(!s.guideOpen);
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

function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center">
      <div className="glass rounded-full px-4 py-2 text-[12.5px] text-slate-100 shadow-[0_0_30px_rgb(94_234_212/0.25)]">{toast}</div>
    </div>
  );
}

export function App() {
  useHotkeys();
  const leftOpen = useApp((s) => s.leftOpen);
  return (
    <div className="fixed inset-0 select-none">
      <div className="absolute inset-0">
        <CityCanvas />
      </div>
      <SceneLabels />
      <TopBar />
      <div className="pointer-events-none absolute bottom-[156px] left-3 top-[76px] z-40 flex">{leftOpen && <OpsPanel />}</div>
      <div className="pointer-events-none absolute bottom-[156px] right-3 top-[76px] z-40 hidden md:flex">
        <Inspector />
      </div>
      <BottomBar />
      <ComparePanel />
      <LabPanel />
      <GuideModal />
      <PolicyEditor />
      <XRay />
      <ImpactPanel />
      <Toast />
    </div>
  );
}
