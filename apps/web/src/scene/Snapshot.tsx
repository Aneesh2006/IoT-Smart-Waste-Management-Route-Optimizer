import { formatClock } from '@binsight/core';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../state/store.ts';

/**
 * Save the 3D view as a slide-ready PNG. The capture runs right after the
 * post-processing pass renders (priority 2), while the frame is still in the
 * drawing buffer, so no preserveDrawingBuffer is needed.
 */
let pending: (() => void) | null = null;

export function requestSnapshot() {
  pending = () => undefined;
}

export function SnapshotCapture() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (!pending) return;
    pending = null;
    const src = gl.domElement;
    const shot = document.createElement('canvas');
    const strip = Math.round(src.height * 0.075);
    shot.width = src.width;
    shot.height = src.height + strip;
    const g = shot.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const { sim } = useApp.getState();
    const m = sim.metrics;
    const scale = strip / 64;
    g.fillStyle = '#05070d';
    g.fillRect(0, src.height, shot.width, strip);
    g.fillStyle = '#5eead4';
    g.fillRect(0, src.height, shot.width, Math.max(2, 3 * scale));
    g.textBaseline = 'middle';
    const y = src.height + strip / 2 + 2 * scale;
    g.font = `700 ${Math.round(26 * scale)}px "Space Grotesk Variable", sans-serif`;
    g.fillStyle = '#e2e8f0';
    g.fillText('Bin', 24 * scale, y);
    const bin = g.measureText('Bin').width;
    g.fillStyle = '#5eead4';
    g.fillText('Sight', 24 * scale + bin, y);
    const facts = [
      `D${Math.floor(sim.time / 86400) + 1} ${formatClock(sim.time)}`,
      `${sim.bins.length} bins · ${sim.trucks.length} trucks`,
      `${sim.policy.name}`,
      `${(m.distanceM / 1000).toFixed(1)} km driven`,
      `${m.overflowBinHours.toFixed(0)} bin-h of litter`,
      `seed ${sim.config.seed}`,
    ];
    g.font = `500 ${Math.round(17 * scale)}px "JetBrains Mono Variable", monospace`;
    g.fillStyle = '#94a3b8';
    g.textAlign = 'right';
    g.fillText(facts.join('   ·   '), shot.width - 24 * scale, y);
    shot.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `binsight-${sim.config.seed}-d${Math.floor(sim.time / 86400) + 1}-${formatClock(sim.time).replace(/[ :]/g, '')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      useApp.getState().showToast('Snapshot saved to your downloads.');
    }, 'image/png');
  }, 2);
  return null;
}
