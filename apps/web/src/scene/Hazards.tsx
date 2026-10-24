import { ROAD_HALF_WIDTH, type City } from '@binsight/core';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, type Group, type Mesh } from 'three';
import { useApp } from '../state/store.ts';
import { BIN_HEIGHT } from './Bins.tsx';

/** Flood water over closed roads, and flames over burning bins. */
export function Hazards({ city }: { city: City }) {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  return (
    <group>
      <Flood city={city} version={sim.roadVersion} />
      {[...sim.fires.keys()].map((id) => (
        <Fire key={id} x={city.bins[id].x} z={city.bins[id].z} />
      ))}
    </group>
  );
}

function Flood({ city, version }: { city: City; version: number }) {
  const sim = useApp((s) => s.sim);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  const geometry = useMemo(() => {
    const pos: number[] = [];
    for (const c of sim.closures) {
      for (const id of c.edges) {
        const e = city.edges[id];
        const a = city.nodes[e.a];
        const b = city.nodes[e.b];
        const half = (e.arterial ? ROAD_HALF_WIDTH.arterial : ROAD_HALF_WIDTH.street) + 3;
        const len = e.length || 1;
        const nx = (-(b.z - a.z) / len) * half;
        const nz = ((b.x - a.x) / len) * half;
        const y = 0.35;
        pos.push(a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
        pos.push(a.x + nx, y, a.z + nz, b.x - nx, y, b.z - nz, a.x - nx, y, a.z - nz);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    return g;
    // Rebuilt whenever roads close or reopen.
  }, [city, sim, version]);
  useFrame(({ clock }) => {
    material.color.setRGB(0.22, 0.74, 0.97).multiplyScalar(1.9 + Math.sin(clock.elapsedTime * 2.2) * 0.6);
  });
  return <mesh geometry={geometry} material={material} />;
}

function Fire({ x, z }: { x: number; z: number }) {
  const group = useRef<Group>(null);
  const inner = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = group.current;
    if (!g) return;
    g.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 9 + 1) * 0.18, 1 + Math.cos(t * 11) * 0.08);
    g.rotation.y = t * 1.5;
    if (inner.current) inner.current.position.y = BIN_HEIGHT + 9 + Math.sin(t * 17) * 1.2;
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={group}>
        <mesh position={[0, BIN_HEIGHT + 8, 0]}>
          <coneGeometry args={[6, 20, 8, 1, true]} />
          <meshBasicMaterial color="#ff6a00" toneMapped={false} transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={inner} position={[0, BIN_HEIGHT + 9, 0]}>
          <coneGeometry args={[3.4, 13, 8, 1, true]} />
          <meshBasicMaterial color="#ffd166" toneMapped={false} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <pointLight position={[0, BIN_HEIGHT + 10, 0]} color="#ff7a1a" intensity={6000} distance={160} decay={2} />
      <mesh position={[0, BIN_HEIGHT + 60, 0]}>
        <cylinderGeometry args={[1, 4, 120, 10, 1, true]} />
        <meshBasicMaterial color="#ff8c1a" toneMapped={false} transparent opacity={0.28} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
