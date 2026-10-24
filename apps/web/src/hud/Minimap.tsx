import { useEffect, useRef } from 'react';
import { STREAM_COLORS, TRUCK_COLORS, fillCss } from '../lib/colors.ts';
import { LiveWorld } from '../live/LiveWorld.ts';
import { cameraFootprint } from '../scene/cameraProbe.tsx';
import { useApp } from '../state/store.ts';
import { Panel } from './ui.tsx';

const SIZE = 156;

/** Top-down overview with the camera's view outlined; click to fly there. Doubles as the legend. */
export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useApp((s) => s.sim);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const g = c.getContext('2d')!;
    const { x0, x1, z0, z1 } = sim.city.bounds;
    const pad = 6;
    const span = Math.max(x1 - x0, z1 - z0);
    const s = (SIZE - pad * 2) / span;
    const ox = pad + (SIZE - pad * 2 - (x1 - x0) * s) / 2;
    const oz = pad + (SIZE - pad * 2 - (z1 - z0) * s) / 2;
    const px = (x: number) => ox + (x - x0) * s;
    const pz = (z: number) => oz + (z - z0) * s;

    // Roads change rarely: draw them once to an offscreen layer.
    const roads = document.createElement('canvas');
    roads.width = c.width;
    roads.height = c.height;
    const rg = roads.getContext('2d')!;
    rg.scale(dpr, dpr);
    const drawRoads = () => {
      rg.clearRect(0, 0, SIZE, SIZE);
      for (const e of sim.city.edges) {
        const a = sim.city.nodes[e.a];
        const b = sim.city.nodes[e.b];
        rg.strokeStyle = e.closed ? 'rgba(56,189,248,0.9)' : e.arterial ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.2)';
        rg.lineWidth = e.closed ? 2.5 : e.arterial ? 1.4 : 0.7;
        rg.beginPath();
        rg.moveTo(px(a.x), pz(a.z));
        rg.lineTo(px(b.x), pz(b.z));
        rg.stroke();
      }
    };
    let roadVersion = -1;

    const draw = () => {
      if (sim.roadVersion !== roadVersion) {
        roadVersion = sim.roadVersion;
        drawRoads();
      }
      const { replay } = useApp.getState();
      const tape = replay ? sim.tape[replay.index] : null;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(roads, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      sim.city.bins.forEach((site, i) => {
        const f = tape ? tape.fills[i] : sim.bins[i].fill;
        g.fillStyle = sim.bins[i].sensorOk || tape ? fillCss(f) : '#64748b';
        const r = f >= 1 ? 2.6 : 1.6;
        g.beginPath();
        g.arc(px(site.x), pz(site.z), r, 0, Math.PI * 2);
        g.fill();
      });
      if (sim instanceof LiveWorld) {
        for (const p of sim.phones.values()) {
          g.fillStyle = '#f0abfc';
          g.fillRect(px(p.x) - 2.5, pz(p.z) - 2.5, 5, 5);
        }
      }
      sim.trucks.forEach((t, i) => {
        const x = tape ? tape.trucks[i * 3] : t.x;
        const z = tape ? tape.trucks[i * 3 + 1] : t.z;
        g.fillStyle = TRUCK_COLORS[t.id % TRUCK_COLORS.length];
        g.strokeStyle = '#05070d';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(px(x), pz(z), 3.4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
      const corners = cameraFootprint.corners;
      if (corners.length === 4) {
        g.strokeStyle = 'rgba(94,234,212,0.9)';
        g.fillStyle = 'rgba(94,234,212,0.08)';
        g.lineWidth = 1.2;
        g.beginPath();
        corners.forEach((p, k) => (k ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z))));
        g.closePath();
        g.fill();
        g.stroke();
      }
    };
    draw();
    const id = window.setInterval(draw, 200);

    const onClick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const x = x0 + ((e.clientX - rect.left) * (SIZE / rect.width) - ox) / s;
      const z = z0 + ((e.clientY - rect.top) * (SIZE / rect.height) - oz) / s;
      useApp.setState({ focus: { x, z }, followTruck: null });
    };
    c.addEventListener('click', onClick);
    return () => {
      window.clearInterval(id);
      c.removeEventListener('click', onClick);
    };
  }, [sim]);

  return (
    <Panel className="pointer-events-auto hidden items-stretch gap-3 p-2.5 lg:flex">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} className="cursor-crosshair rounded-lg bg-black/40 ring-1 ring-white/10" title="Click to fly the camera there" />
      <div className="flex flex-col justify-between py-0.5 text-[10.5px] text-slate-400">
        <div className="eyebrow">Map</div>
        <div>
          <div className="mb-1">Fill</div>
          <span className="block h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg,#22c55e,#a3e635 50%,#facc15 72%,#f97316 88%,#ef4444)' }} />
        </div>
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STREAM_COLORS.wet }} /> Wet bin ring
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STREAM_COLORS.dry }} /> Dry bin ring
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#22d3ee 0 5px,transparent 5px 8px)' }} /> Route
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded bg-red-500 shadow-[0_0_8px_#ef4444]" /> Overflow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-fuchsia-300" /> Phone bin
          </span>
        </div>
      </div>
    </Panel>
  );
}
