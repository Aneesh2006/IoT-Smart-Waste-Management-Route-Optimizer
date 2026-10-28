import type { City } from '@binsight/core';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, Object3D, type InstancedMesh } from 'three';
import { DISTRICT_COLORS } from '../lib/colors.ts';
import { blockDelays, clamp01, easeOutBack, PAD_IN, useIntro } from './intro.ts';

const PAD_HEIGHT = 0.6;

export function Ground({ city }: { city: City }) {
  const pads = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const cx = (city.bounds.x0 + city.bounds.x1) / 2;
  const cz = (city.bounds.z0 + city.bounds.z1) / 2;

  useLayoutEffect(() => {
    const mesh = pads.current;
    if (!mesh) return;
    const o = new Object3D();
    const c = new Color();
    city.blocks.forEach((b, i) => {
      o.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      o.scale.set(b.x1 - b.x0, PAD_HEIGHT, b.z1 - b.z0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(DISTRICT_COLORS[b.district]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [city]);

  // Each pad pops out from its centre, rippling outward from the middle of the city.
  const delays = useMemo(() => blockDelays(city), [city]);
  const o = useMemo(() => new Object3D(), []);
  useIntro((t) => {
    const mesh = pads.current;
    if (!mesh) return;
    city.blocks.forEach((b, i) => {
      const p = clamp01((t - delays[i]) / PAD_IN);
      const k = p === 0 ? 0 : easeOutBack(p);
      o.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      o.scale.set((b.x1 - b.x0) * k, p === 0 ? 0 : PAD_HEIGHT, (b.z1 - b.z0) * k);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.05, cz]} receiveShadow>
        <planeGeometry args={[9000, 9000]} />
        <meshStandardMaterial color="#8f9c8f" roughness={1} />
      </mesh>
      <instancedMesh ref={pads} args={[geometry, undefined, city.blocks.length]} receiveShadow>
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

export { PAD_HEIGHT };
