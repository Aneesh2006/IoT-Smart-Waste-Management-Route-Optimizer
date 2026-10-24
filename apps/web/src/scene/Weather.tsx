import type { City } from '@binsight/core';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, type LineSegments, type Points, type Vector3 } from 'three';
import { useApp } from '../state/store.ts';
import { nightUniform } from './Atmosphere.tsx';

/** Monsoon rain while a road is flooded, fireworks over the markets on festival nights. */
export function Weather({ city }: { city: City }) {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const raining = sim.closures.length > 0;
  const festival = sim.festivalUntil > sim.time;
  return (
    <group>
      {raining && <Rain />}
      {festival && <Fireworks city={city} />}
    </group>
  );
}

const DROPS = 5000;
const AREA = 1400;
const TOP = 420;

function Rain() {
  const lines = useRef<LineSegments>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null;
  const { geometry, speed } = useMemo(() => {
    const pos = new Float32Array(DROPS * 6);
    const speed = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      const x = (Math.random() - 0.5) * AREA;
      const y = Math.random() * TOP;
      const z = (Math.random() - 0.5) * AREA;
      pos.set([x, y, z, x - 1.5, y + 9, z], i * 6);
      speed[i] = 160 + Math.random() * 90;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    return { geometry, speed };
  }, []);

  useFrame((_, dt) => {
    const l = lines.current;
    if (!l) return;
    if (controls) l.position.set(controls.target.x, 0, controls.target.z);
    const pos = geometry.attributes.position.array as Float32Array;
    const step = Math.min(dt, 0.1);
    for (let i = 0; i < DROPS; i++) {
      const k = i * 6;
      let y = pos[k + 1] - speed[i] * step;
      if (y < 0) y += TOP;
      pos[k + 1] = y;
      pos[k + 4] = y + 9;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#9fd3ff" transparent opacity={0.35} depthWrite={false} />
    </lineSegments>
  );
}

const SPARKS = 2400;

function Fireworks({ city }: { city: City }) {
  const points = useRef<Points>(null);
  const markets = useMemo(() => city.blocks.filter((b) => b.district === 'market'), [city]);
  const state = useMemo(() => {
    const pos = new Float32Array(SPARKS * 3);
    const col = new Float32Array(SPARKS * 3);
    const vel = new Float32Array(SPARKS * 3);
    const life = new Float32Array(SPARKS);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    return { pos, col, vel, life, geometry, next: 0, cursor: 0 };
  }, []);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1);
    const night = nightUniform.value;
    state.next -= step;
    if (state.next <= 0 && night > 0.4 && markets.length) {
      state.next = 0.35 + Math.random() * 0.5;
      const b = markets[Math.floor(Math.random() * markets.length)];
      const cx = b.x0 + Math.random() * (b.x1 - b.x0);
      const cz = b.z0 + Math.random() * (b.z1 - b.z0);
      const cy = 140 + Math.random() * 90;
      const hue = Math.random();
      for (let n = 0; n < 140; n++) {
        const i = state.cursor;
        state.cursor = (state.cursor + 1) % SPARKS;
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const v = 38 + Math.random() * 14;
        state.pos.set([cx, cy, cz], i * 3);
        state.vel.set([r * Math.cos(a) * v, u * v, r * Math.sin(a) * v], i * 3);
        // HSL-ish bright colours, pushed above 1 so they bloom.
        const h = (hue + Math.random() * 0.08) * 6;
        const c = [Math.max(0, Math.min(1, Math.abs(h - 3) - 1)), Math.max(0, Math.min(1, 2 - Math.abs(h - 2))), Math.max(0, Math.min(1, 2 - Math.abs(h - 4)))];
        state.col.set([c[0] * 3 + 0.6, c[1] * 3 + 0.6, c[2] * 3 + 0.6], i * 3);
        state.life[i] = 1.8 + Math.random() * 0.8;
      }
    }
    for (let i = 0; i < SPARKS; i++) {
      if (state.life[i] <= 0) continue;
      state.life[i] -= step;
      const k = i * 3;
      state.vel[k + 1] -= 22 * step;
      state.vel[k] *= 0.985;
      state.vel[k + 2] *= 0.985;
      state.pos[k] += state.vel[k] * step;
      state.pos[k + 1] += state.vel[k + 1] * step;
      state.pos[k + 2] += state.vel[k + 2] * step;
      const fade = Math.max(0, Math.min(1, state.life[i] / 1.2));
      if (state.life[i] <= 0) state.pos[k + 1] = -1000;
      state.col[k] *= fade < 1 ? 0.97 : 1;
      state.col[k + 1] *= fade < 1 ? 0.97 : 1;
      state.col[k + 2] *= fade < 1 ? 0.97 : 1;
    }
    state.geometry.attributes.position.needsUpdate = true;
    state.geometry.attributes.color.needsUpdate = true;
    if (points.current) points.current.visible = night > 0.2;
  });

  return (
    <points ref={points} geometry={state.geometry} frustumCulled={false}>
      <pointsMaterial size={5} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </points>
  );
}
