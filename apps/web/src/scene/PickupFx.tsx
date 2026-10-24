import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D, RingGeometry, BoxGeometry } from 'three';
import { useApp } from '../state/store.ts';

/**
 * A little burst every time a truck empties a bin: a ring pulses out from the
 * bin and a handful of scraps arc into the truck. Amber when the pickup was
 * wasted (bin under 30%), teal otherwise.
 */
const MAX = 14;
const SCRAPS = 10;
const LIFE = 1.3;

interface Fx {
  start: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  wasted: boolean;
  seed: number;
}

export function PickupFx() {
  const sim = useApp((s) => s.sim);
  const rings = useRef<InstancedMesh>(null);
  const scraps = useRef<InstancedMesh>(null);
  const fx = useRef<Fx[]>([]);
  const seen = useRef(sim.pickups.at(-1)?.id ?? -1);
  const geo = useMemo(() => ({ ring: new RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), scrap: new BoxGeometry(1.6, 1.6, 1.6) }), []);
  const mats = useMemo(
    () => ({
      ring: new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
      scrap: new MeshBasicMaterial({ toneMapped: false }),
    }),
    [],
  );
  const scratch = useMemo(() => ({ o: new Object3D(), c: new Color() }), []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const { replay } = useApp.getState();
    if (!replay) {
      for (const p of sim.pickups) {
        if (p.id <= seen.current) continue;
        seen.current = p.id;
        const site = sim.city.bins[p.binId];
        const t = sim.trucks[p.truckId];
        if (!site) continue;
        fx.current.push({ start: now, x: site.x, z: site.z, tx: t?.x ?? site.x, tz: t?.z ?? site.z, wasted: p.wasted, seed: p.id * 7.13 });
        if (fx.current.length > MAX) fx.current.shift();
      }
    }
    fx.current = fx.current.filter((f) => now - f.start < LIFE);

    const { o, c } = scratch;
    const rm = rings.current!;
    const sm = scraps.current!;
    for (let i = 0; i < MAX; i++) {
      const f = fx.current[i];
      if (!f) {
        o.scale.setScalar(0);
        o.updateMatrix();
        rm.setMatrixAt(i, o.matrix);
        for (let k = 0; k < SCRAPS; k++) sm.setMatrixAt(i * SCRAPS + k, o.matrix);
        continue;
      }
      const a = (now - f.start) / LIFE;
      const hue = f.wasted ? '#fbbf24' : '#5eead4';
      o.position.set(f.x, 1.2, f.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(6 + a * 34);
      o.updateMatrix();
      rm.setMatrixAt(i, o.matrix);
      rm.setColorAt(i, c.set(hue).multiplyScalar(2.2 * (1 - a)));
      for (let k = 0; k < SCRAPS; k++) {
        const j = i * SCRAPS + k;
        const s = Math.sin(f.seed + k * 12.9898) * 43758.5453;
        const jitter = s - Math.floor(s);
        // Arc from the bin into the truck's hopper.
        const p = Math.min(1, a * 1.6 + jitter * 0.15);
        o.position.set(f.x + (f.tx - f.x) * p + (jitter - 0.5) * 6, 32 * Math.sin(Math.PI * p) * (0.7 + jitter * 0.6) + 2, f.z + (f.tz - f.z) * p + (jitter - 0.5) * 6);
        o.rotation.set(a * 9 + k, a * 7, k);
        o.scale.setScalar(p >= 1 ? 0 : 1 + jitter);
        o.updateMatrix();
        sm.setMatrixAt(j, o.matrix);
        sm.setColorAt(j, c.setHSL(0.08 + jitter * 0.3, 0.7, 0.55).multiplyScalar(1.4));
      }
    }
    rm.instanceMatrix.needsUpdate = true;
    sm.instanceMatrix.needsUpdate = true;
    if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={rings} args={[geo.ring, mats.ring, MAX]} frustumCulled={false} />
      <instancedMesh ref={scraps} args={[geo.scrap, mats.scrap, MAX * SCRAPS]} frustumCulled={false} />
    </group>
  );
}
