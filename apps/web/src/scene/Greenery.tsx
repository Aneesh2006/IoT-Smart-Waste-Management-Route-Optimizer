import type { City } from '@binsight/core';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, CylinderGeometry, IcosahedronGeometry, MeshBasicMaterial, Object3D, SphereGeometry, type InstancedMesh } from 'three';
import { nightUniform } from './Atmosphere.tsx';
import { blockDelays, clamp01, delayAt, easeOutBack, TREE_IN, TREE_LAG, useIntro } from './intro.ts';

/** Trees, plus the arterial street lamps that come on at dusk. */
export function Greenery({ city }: { city: City }) {
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const poles = useRef<InstancedMesh>(null);
  const lamps = useRef<InstancedMesh>(null);
  const geo = useMemo(
    () => ({
      trunk: new CylinderGeometry(0.5, 0.7, 1, 6).translate(0, 0.5, 0),
      crown: new IcosahedronGeometry(1, 0),
      pole: new CylinderGeometry(0.25, 0.3, 1, 5).translate(0, 0.5, 0),
      lamp: new SphereGeometry(1, 8, 6),
    }),
    [],
  );
  const lampMaterial = useMemo(() => new MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }), []);
  const lampColor = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    const o = new Object3D();
    const c = new Color();
    city.trees.forEach((t, i) => {
      o.position.set(t.x, 0.6, t.z);
      o.scale.set(t.scale, 4 * t.scale, t.scale);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      trunks.current!.setMatrixAt(i, o.matrix);
      o.position.set(t.x, 0.6 + 6.5 * t.scale, t.z);
      o.scale.setScalar(4.2 * t.scale);
      o.rotation.set(0, t.x * 0.37, 0);
      o.updateMatrix();
      crowns.current!.setMatrixAt(i, o.matrix);
      crowns.current!.setColorAt(i, c.setHSL(0.27 + ((t.x * 13.1) % 1) * 0.06, 0.45, 0.32 + ((t.z * 7.3) % 1) * 0.08));
    });
    city.streetLights.forEach((l, i) => {
      o.rotation.set(0, 0, 0);
      o.position.set(l.x, 0, l.z);
      o.scale.set(1, 8, 1);
      o.updateMatrix();
      poles.current!.setMatrixAt(i, o.matrix);
      o.position.set(l.x, 8.4, l.z);
      o.scale.setScalar(0.9);
      o.updateMatrix();
      lamps.current!.setMatrixAt(i, o.matrix);
    });
    for (const m of [trunks, crowns, poles, lamps]) {
      m.current!.instanceMatrix.needsUpdate = true;
      if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true;
      m.current!.computeBoundingSphere();
    }
  }, [city]);

  // Trees sprout once their block's buildings are on the way up.
  const starts = useMemo(() => {
    const delays = blockDelays(city);
    return Float32Array.from(city.trees, (t) => delayAt(city, delays, t.x, t.z) + TREE_LAG);
  }, [city]);
  const o = useMemo(() => new Object3D(), []);
  useIntro((time) => {
    city.trees.forEach((t, i) => {
      const p = clamp01((time - starts[i]) / TREE_IN);
      const k = p === 0 ? 0 : easeOutBack(p);
      o.rotation.set(0, 0, 0);
      o.position.set(t.x, 0.6, t.z);
      o.scale.set(t.scale * k, 4 * t.scale * k, t.scale * k);
      o.updateMatrix();
      trunks.current!.setMatrixAt(i, o.matrix);
      o.position.set(t.x, 0.6 + 6.5 * t.scale * k, t.z);
      o.scale.setScalar(4.2 * t.scale * k);
      o.rotation.set(0, t.x * 0.37, 0);
      o.updateMatrix();
      crowns.current!.setMatrixAt(i, o.matrix);
    });
    trunks.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceMatrix.needsUpdate = true;
  });

  useFrame(() => {
    const n = nightUniform.value;
    lampMaterial.color.copy(lampColor.set('#ffd28a').multiplyScalar(0.35 + n * 5));
  });

  return (
    <group>
      <instancedMesh ref={trunks} args={[geo.trunk, undefined, city.trees.length]} castShadow>
        <meshStandardMaterial color="#6b4f3a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[geo.crown, undefined, city.trees.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={poles} args={[geo.pole, undefined, city.streetLights.length]}>
        <meshStandardMaterial color="#4b5563" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[geo.lamp, lampMaterial, city.streetLights.length]} />
    </group>
  );
}
