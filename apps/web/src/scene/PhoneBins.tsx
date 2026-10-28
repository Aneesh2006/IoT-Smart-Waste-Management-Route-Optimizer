import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, MeshBasicMaterial, type Group, type Mesh } from 'three';
import { fillColor } from '../lib/colors.ts';
import { LiveWorld, type PhoneBin, type PhoneRun } from '../live/LiveWorld.ts';
import { useApp } from '../state/store.ts';
import { nightUniform } from './Atmosphere.tsx';
import { BIN_HEIGHT } from './Bins.tsx';
import { TruckModel } from './Trucks.tsx';

const PHONE_TRUCK_COLOR = '#e879f9';

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
      {[...sim.phoneRuns.values()].map((r) => (
        <PhoneTruck key={`${r.phoneId}-${r.leftAt}`} run={r} />
      ))}
    </group>
  );
}

/** The truck sent to a phone's bin, with its road to the bin marching until it has picked up. */
function PhoneTruck({ run }: { run: PhoneRun }) {
  const root = useRef<Group>(null);
  const group = useRef<Group>(null);
  const line = useRef<{ material: { dashOffset: number } } | null>(null);
  const lights = useMemo(() => new MeshBasicMaterial({ color: '#fff3c4', toneMapped: false }), []);
  const points = useMemo(() => run.xs.map((x, i) => [x, 1.6, run.zs[i]] as [number, number, number]), [run]);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g || !root.current) return;
    root.current.visible = !useApp.getState().replay;
    g.position.set(run.x, 0.2, run.z);
    let d = run.heading - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, dt * 10);
    lights.color.set('#fff3c4').multiplyScalar(0.6 + nightUniform.value * 4);
    if (line.current) line.current.material.dashOffset -= dt * 1.6;
  });
  return (
    <group ref={root}>
      <group ref={group} position={[run.x, 0.2, run.z]}>
        <TruckModel color={PHONE_TRUCK_COLOR} lights={lights} />
      </group>
      {!run.picked && points.length > 1 && (
        <Line
          ref={(el) => {
            line.current = el as unknown as typeof line.current;
          }}
          points={points}
          color={PHONE_TRUCK_COLOR}
          lineWidth={3.2}
          dashed
          dashSize={14}
          gapSize={7}
          dashScale={0.4}
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      )}
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
