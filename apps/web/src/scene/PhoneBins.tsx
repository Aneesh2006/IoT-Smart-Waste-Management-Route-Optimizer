import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { fillColor } from '../lib/colors.ts';
import { LiveWorld, type PhoneBin } from '../live/LiveWorld.ts';
import { useApp } from '../state/store.ts';
import { BIN_HEIGHT } from './Bins.tsx';

/** Audience phones, drawn as taller magenta-ringed bins so the room can find theirs. */
export function PhoneBins() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  if (!(sim instanceof LiveWorld)) return null;
  return (
    <group>
      {[...sim.phones.values()].map((p) => (
        <PhoneBinMesh key={p.id} phone={p} world={sim} />
      ))}
    </group>
  );
}

function PhoneBinMesh({ phone, world }: { phone: PhoneBin; world: LiveWorld }) {
  const fill = useRef<Mesh>(null);
  const ring = useRef<Group>(null);
  const color = useMemo(() => new Color(), []);
  useFrame(({ clock }) => {
    const p = world.phones.get(phone.id) ?? phone;
    const f = fill.current;
    if (f) {
      const level = Math.max(0.04, Math.min(1.3, p.r));
      f.scale.y = level * BIN_HEIGHT * 1.2;
      f.position.y = 0.7 + (level * BIN_HEIGHT * 1.2) / 2;
      fillColor(p.r, color).multiplyScalar(p.r >= 0.8 ? 1.8 + Math.sin(clock.elapsedTime * 5) * 0.5 : 1.4);
      (f.material as MeshBasicMaterial).color.copy(color);
    }
    if (ring.current) {
      ring.current.rotation.y = clock.elapsedTime * (p.dispatched ? 3 : 0.8);
      const k = p.dispatched ? 1 + Math.sin(clock.elapsedTime * 6) * 0.15 : 1;
      ring.current.scale.set(k, 1, k);
    }
  });
  return (
    <group position={[phone.x, 0, phone.z]}>
      <mesh position={[0, BIN_HEIGHT * 0.6 + 0.7, 0]}>
        <cylinderGeometry args={[4.6, 4.6, BIN_HEIGHT * 1.2, 20, 1, true]} />
        <meshStandardMaterial color="#f5d0fe" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh ref={fill}>
        <cylinderGeometry args={[4, 4, 1, 20]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <group ref={ring}>
        <mesh position={[0, 0.4, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[6, 8, 6]} />
          <meshBasicMaterial color={new Color('#e879f9').multiplyScalar(2)} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
