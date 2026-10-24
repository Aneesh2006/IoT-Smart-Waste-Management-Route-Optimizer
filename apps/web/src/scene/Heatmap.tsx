import type { City } from '@binsight/core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { useApp, type HeatMode } from '../state/store.ts';

const SIZE = 512;
const RADIUS_M = 75;

// Heat palette: transparent → indigo → teal → yellow → red.
const STOPS: [number, [number, number, number, number]][] = [
  [0, [0, 0, 0, 0]],
  [0.15, [67, 56, 202, 90]],
  [0.4, [20, 184, 166, 150]],
  [0.65, [250, 204, 21, 190]],
  [1, [239, 68, 68, 225]],
];
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
    const [t0, c0] = STOPS[k - 1];
    const [t1, c1] = STOPS[k];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let ch = 0; ch < 4; ch++) lut[i * 4 + ch] = c0[ch] + (c1[ch] - c0[ch]) * f;
  }
  return lut;
})();

/** Ground overlay: where the city's waste is right now, where it spilled, or where it is made. */
export function Heatmap({ city }: { city: City }) {
  const mode = useApp((s) => s.heatmap);
  const sim = useApp((s) => s.sim);
  const { intensity, output, texture } = useMemo(() => {
    const intensity = document.createElement('canvas');
    intensity.width = intensity.height = SIZE;
    const output = document.createElement('canvas');
    output.width = output.height = SIZE;
    const texture = new CanvasTexture(output);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    return { intensity, output, texture };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const pad = 120;
  const x0 = city.bounds.x0 - pad;
  const z0 = city.bounds.z0 - pad;
  const span = Math.max(city.bounds.x1 - city.bounds.x0, city.bounds.z1 - city.bounds.z0) + pad * 2;
  const last = useRef(0);

  useFrame(({ clock }) => {
    if (mode === 'off' || clock.elapsedTime - last.current < 0.4) return;
    last.current = clock.elapsedTime;
    const values = sim.bins.map((b) => (mode === 'fill' ? Math.min(1.2, b.fill) : mode === 'overflow' ? b.overflowHours : b.generatedL));
    const max = mode === 'fill' ? 1 : Math.max(1e-6, ...values);
    const g = intensity.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SIZE, SIZE);
    g.globalCompositeOperation = 'lighter';
    const r = (RADIUS_M / span) * SIZE;
    sim.city.bins.forEach((site, i) => {
      const v = values[i] / max;
      if (v <= 0.01) return;
      const px = ((site.x - x0) / span) * SIZE;
      const pz = ((site.z - z0) / span) * SIZE;
      const grad = g.createRadialGradient(px, pz, 0, px, pz, r);
      grad.addColorStop(0, `rgba(255,255,255,${Math.min(1, v) * 0.55})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(px - r, pz - r, r * 2, r * 2);
    });
    const src = g.getImageData(0, 0, SIZE, SIZE);
    const out = output.getContext('2d')!;
    const img = out.createImageData(SIZE, SIZE);
    for (let p = 0; p < src.data.length; p += 4) {
      const i = Math.min(255, src.data[p]) * 4;
      img.data[p] = LUT[i];
      img.data[p + 1] = LUT[i + 1];
      img.data[p + 2] = LUT[i + 2];
      img.data[p + 3] = LUT[i + 3];
    }
    out.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  });

  if (mode === 'off') return null;
  return (
    <mesh position={[x0 + span / 2, 1.1, z0 + span / 2]} rotation-x={-Math.PI / 2} renderOrder={2}>
      <planeGeometry args={[span, span]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export const HEAT_LABEL: Record<HeatMode, string> = {
  off: 'Heatmap off',
  fill: 'Heat: how full, right now',
  overflow: 'Heat: hours spent overflowing',
  generated: 'Heat: waste generated',
};
