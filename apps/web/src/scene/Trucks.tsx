import type { TruckState } from '@binsight/core';
import { Html, Line } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, MeshBasicMaterial, type Group } from 'three';
import { TRUCK_COLORS } from '../lib/colors.ts';
import { useApp } from '../state/store.ts';
import { nightUniform } from './Atmosphere.tsx';

/** Trucks are drawn ~2.5× real size so they read from a city-wide camera. */
const SCALE = 2.5;

type DashedLine = { material: { dashOffset: number } };

function TruckBody({ truck, color }: { truck: TruckState; color: string }) {
  const group = useRef<Group>(null);
  const lights = useMemo(() => new MeshBasicMaterial({ color: '#fff7d6', toneMapped: false }), []);
  const glow = useMemo(() => new Color(), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(truck.x, 0.2, truck.z);
    g.rotation.y = truck.heading;
    lights.color.copy(glow.set('#fff3c4').multiplyScalar(0.6 + nightUniform.value * 4));
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useApp.getState().selectTruck(truck.id);
  };

  return (
    <group ref={group} onClick={onClick} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      <group scale={SCALE}>
        {/* chassis */}
        <mesh position={[0, 0.7, 0]} castShadow>
          <boxGeometry args={[2.4, 0.6, 8]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
        {/* compactor body */}
        <mesh position={[0, 2.2, -1]} castShadow>
          <boxGeometry args={[2.5, 2.6, 5.4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.45} metalness={0.15} />
        </mesh>
        {/* cab */}
        <mesh position={[0, 1.9, 2.9]} castShadow>
          <boxGeometry args={[2.4, 2, 1.8]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.2, 3.81]}>
          <boxGeometry args={[2.1, 0.9, 0.05]} />
          <meshStandardMaterial color="#0f172a" roughness={0.1} metalness={0.6} />
        </mesh>
        {[-0.85, 0.85].map((x) => (
          <mesh key={x} position={[x, 1.2, 3.82]} material={lights}>
            <boxGeometry args={[0.45, 0.3, 0.06]} />
          </mesh>
        ))}
        {/* beacon on the roof */}
        <mesh position={[0, 3.1, 2.9]}>
          <boxGeometry args={[0.8, 0.3, 0.4]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {[-2.6, 0.2, 2.8].map((z) =>
          [-1.25, 1.25].map((x) => (
            <mesh key={`${x}${z}`} position={[x, 0.55, z]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.55, 0.55, 0.4, 10]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          )),
        )}
      </group>
      <TruckChip truck={truck} color={color} />
    </group>
  );
}

function TruckChip({ truck, color }: { truck: TruckState; color: string }) {
  useApp((s) => s.tick);
  const selected = useApp((s) => s.selectedTruck === truck.id);
  const load = truck.load / truck.capacity;
  return (
    <Html position={[0, 16, 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
      <div
        className={`glass flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[10px] ${selected ? 'ring-1 ring-neon' : ''}`}
      >
        <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        T{truck.id + 1}
        <span className="h-1 w-8 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, load * 100)}%`, background: color }} />
        </span>
      </div>
    </Html>
  );
}

export function Trucks() {
  const sim = useApp((s) => s.sim);
  return (
    <group>
      {sim.trucks.map((t) => (
        <TruckBody key={t.id} truck={t} color={TRUCK_COLORS[t.id % TRUCK_COLORS.length]} />
      ))}
      <RouteRibbons />
    </group>
  );
}

/** Each truck's planned route as a marching dashed ribbon; rebuilt only when plans change. */
function RouteRibbons() {
  const sim = useApp((s) => s.sim);
  useApp((s) => s.tick);
  const selected = useApp((s) => s.selectedTruck);
  const version = sim.routeVersion;
  const routes = sim.trucks.map((t) => t.route);
  const ribbons = useMemo(
    () =>
      routes.map((r) => (r ? r.xs.map((x, i) => [x, 1.6, r.zs[i]] as [number, number, number]) : null)),
    // Routes only change identity when re-planned or finished.
    [version, ...routes],
  );
  const lines = useRef<(DashedLine | null)[]>([]);
  useFrame((_, dt) => {
    for (const l of lines.current) {
      if (!l) continue;
      l.material.dashOffset -= dt * 1.6;
    }
  });
  return (
    <group>
      {ribbons.map((pts, i) =>
        pts && pts.length > 1 ? (
          <Line
            key={`${version}-${i}`}
            ref={(el) => {
              lines.current[i] = el as unknown as DashedLine | null;
            }}
            points={pts}
            color={TRUCK_COLORS[i % TRUCK_COLORS.length]}
            lineWidth={selected === null || selected === i ? 3.2 : 1.4}
            dashed
            dashSize={14}
            gapSize={7}
            dashScale={0.4}
            transparent
            opacity={selected === null || selected === i ? 0.95 : 0.35}
            toneMapped={false}
          />
        ) : null,
      )}
    </group>
  );
}
