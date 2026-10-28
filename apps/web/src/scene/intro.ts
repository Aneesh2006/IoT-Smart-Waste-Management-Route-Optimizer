import type { City } from '@binsight/core';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';

/**
 * Load-in animation: each city block pops up in a ripple from the centre,
 * then its buildings grow and its trees sprout. Everything keys off the
 * block's delay so a block and its contents move together.
 */

/** Seconds for the ripple to reach the outermost block. */
const SPREAD = 1.5;
export const PAD_IN = 0.55;
export const BUILDING_LAG = 0.15;
export const BUILDING_IN = 0.75;
export const TREE_LAG = 0.35;
export const TREE_IN = 0.5;
export const INTRO_END = SPREAD + 0.15 + Math.max(BUILDING_LAG + BUILDING_IN, TREE_LAG + TREE_IN);

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

const cache = new WeakMap<City, Float32Array>();

/** Start time (s) of each block, by distance from the city centre plus a little jitter. */
export function blockDelays(city: City) {
  let delays = cache.get(city);
  if (delays) return delays;
  const cx = (city.bounds.x0 + city.bounds.x1) / 2;
  const cz = (city.bounds.z0 + city.bounds.z1) / 2;
  const dist = city.blocks.map((b) => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.z0 + b.z1) / 2 - cz));
  const far = Math.max(1, ...dist);
  delays = new Float32Array(city.blocks.map((b, i) => (dist[i] / far) * SPREAD + (((b.id * 2654435761) >>> 0) % 1000) / 1000 * 0.15));
  cache.set(city, delays);
  return delays;
}

/** Delay of whichever block contains (x, z); falls back to the nearest block. */
export function delayAt(city: City, delays: Float32Array, x: number, z: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < city.blocks.length; i++) {
    const b = city.blocks[i];
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    const d = dx * dx + dz * dz;
    if (d === 0) return delays[i];
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return delays[best];
}

/**
 * Calls `apply(t)` every frame until the intro ends (the last call is at INTRO_END,
 * so everything lands on its final pose). The first couple of frames don't advance
 * the clock: shader compilation stalls them and would otherwise skip the animation.
 */
export function useIntro(apply: (t: number) => void) {
  const fn = useRef(apply);
  fn.current = apply;
  const s = useMemo(() => ({ t: 0, frames: 0, done: reducedMotion }), []);
  useFrame((_, dt) => {
    if (s.done) return;
    s.t = Math.min(s.t + (s.frames++ < 2 ? 0 : dt), INTRO_END);
    fn.current(s.t);
    if (s.t >= INTRO_END) s.done = true;
  });
}
