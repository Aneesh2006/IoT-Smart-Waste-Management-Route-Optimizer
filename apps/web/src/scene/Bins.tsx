import type { City } from '@binsight/core';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  type InstancedMesh,
  type Mesh,
} from 'three';
import { DISTRICT_LABEL, STREAM_COLORS, fillColor, fillCss } from '../lib/colors.ts';
import { fmtPct } from '../lib/format.ts';
import { useApp } from '../state/store.ts';

/** Bins are drawn larger than life so a 1 m bin reads at city scale. */
export const BIN_HEIGHT = 30;
const BIN_RADIUS = 3.6;
const BASE_Y = 0.7;

export function Bins({ city }: { city: City }) {
  const sim = useApp((s) => s.sim);
  const count = city.bins.length;
  const shell = useRef<InstancedMesh>(null);
  const fill = useRef<InstancedMesh>(null);
  const base = useRef<InstancedMesh>(null);
  const beacon = useRef<InstancedMesh>(null);
  const ring = useRef<Mesh>(null);
  const dataView = useApp((s) => s.dataView);
  const widen = dataView ? 1.7 : 1;

  const geo = useMemo(
    () => ({
      shell: new CylinderGeometry(BIN_RADIUS + 0.5, BIN_RADIUS + 0.5, 1, 18, 1, true).translate(0, 0.5, 0),
      fill: new CylinderGeometry(BIN_RADIUS, BIN_RADIUS, 1, 18).translate(0, 0.5, 0),
      base: new CylinderGeometry(BIN_RADIUS + 1.6, BIN_RADIUS + 1.6, 0.6, 20),
      beacon: new CylinderGeometry(0.8, 3.4, 1, 14, 1, true).translate(0, 0.5, 0),
      ring: new RingGeometry(8.5, 10.5, 40).rotateX(-Math.PI / 2),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      shell: new MeshStandardMaterial({ color: '#e2f3ff', transparent: true, opacity: 0.16, roughness: 0.2, depthWrite: false, side: DoubleSide }),
      fill: new MeshBasicMaterial({ toneMapped: false }),
      base: new MeshBasicMaterial({ toneMapped: false }),
      beacon: new MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [],
  );

  useLayoutEffect(() => {
    const o = new Object3D();
    const c = new Color();
    city.bins.forEach((b, i) => {
      o.position.set(b.x, BASE_Y, b.z);
      o.scale.set(widen, BIN_HEIGHT, widen);
      o.updateMatrix();
      shell.current!.setMatrixAt(i, o.matrix);
      o.position.set(b.x, 0.3, b.z);
      o.scale.set(widen, 1, widen);
      o.updateMatrix();
      base.current!.setMatrixAt(i, o.matrix);
      base.current!.setColorAt(i, c.set(STREAM_COLORS[b.stream]).multiplyScalar(1.3));
    });
    shell.current!.instanceMatrix.needsUpdate = true;
    base.current!.instanceMatrix.needsUpdate = true;
    base.current!.instanceColor!.needsUpdate = true;
    shell.current!.computeBoundingSphere();
    base.current!.computeBoundingSphere();
  }, [city, widen]);

  const scratch = useMemo(() => ({ o: new Object3D(), c: new Color() }), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const { o, c } = scratch;
    const { selectedBin, hoveredBin } = useApp.getState();
    const fm = fill.current!;
    const bm = beacon.current!;
    for (let i = 0; i < count; i++) {
      const site = city.bins[i];
      const st = sim.bins[i];
      const level = Math.min(1.3, Math.max(0.03, st.fill));
      o.position.set(site.x, BASE_Y, site.z);
      o.rotation.set(0, 0, 0);
      o.scale.set(widen, level * BIN_HEIGHT, widen);
      o.updateMatrix();
      fm.setMatrixAt(i, o.matrix);

      let glow = 1.25;
      if (st.fill >= 1) glow = 1.9 + Math.sin(t * 6 + i) * 0.5;
      else if (st.fill >= 0.8) glow = 1.6 + Math.sin(t * 3 + i) * 0.35;
      if (i === hoveredBin || i === selectedBin) glow += 0.8;
      if (st.sensorOk) fillColor(st.fill, c).multiplyScalar(glow);
      else c.set('#475569').multiplyScalar(0.6 + 0.25 * Math.sin(t * 2 + i));
      fm.setColorAt(i, c);

      if (st.fill >= 1) {
        o.position.set(site.x, BASE_Y + BIN_HEIGHT, site.z);
        o.scale.set(1 + Math.sin(t * 4 + i) * 0.15, 110, 1 + Math.sin(t * 4 + i) * 0.15);
      } else {
        o.scale.set(0, 0, 0);
      }
      o.updateMatrix();
      bm.setMatrixAt(i, o.matrix);
    }
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    bm.instanceMatrix.needsUpdate = true;
    fm.computeBoundingSphere();
    bm.computeBoundingSphere();

    const r = ring.current;
    if (r) {
      if (selectedBin !== null) {
        const s = city.bins[selectedBin];
        r.visible = true;
        r.position.set(s.x, 0.9, s.z);
        r.rotation.y = t * 0.8;
        const k = 1 + Math.sin(t * 3) * 0.08;
        r.scale.set(k, 1, k);
      } else r.visible = false;
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) useApp.getState().hoverBin(e.instanceId);
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    useApp.getState().hoverBin(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) useApp.getState().selectBin(e.instanceId);
  };

  return (
    <group>
      <instancedMesh ref={base} args={[geo.base, mats.base, count]} />
      <instancedMesh ref={fill} args={[geo.fill, mats.fill, count]} castShadow />
      <instancedMesh
        ref={shell}
        args={[geo.shell, mats.shell, count]}
        onPointerMove={onOver}
        onPointerOut={onOut}
        onClick={onClick}
      />
      <instancedMesh ref={beacon} args={[geo.beacon, mats.beacon, count]} frustumCulled={false} />
      <mesh ref={ring} geometry={geo.ring} visible={false}>
        <meshBasicMaterial color="#5eead4" toneMapped={false} side={DoubleSide} />
      </mesh>
      <HoverTip city={city} />
    </group>
  );
}

function HoverTip({ city }: { city: City }) {
  const hovered = useApp((s) => s.hoveredBin);
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  if (hovered === null) return null;
  const site = city.bins[hovered];
  const st = sim.bins[hovered];
  return (
    <Html position={[site.x, BASE_Y + BIN_HEIGHT + 10, site.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div className="glass min-w-36 rounded-lg px-2.5 py-1.5 text-[11px] leading-tight">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono font-semibold text-slate-100">{site.label}</span>
          <span className="font-mono font-semibold" style={{ color: fillCss(st.reading) }}>
            {fmtPct(st.reading)}
          </span>
        </div>
        <div className="mt-0.5 text-slate-400">
          {DISTRICT_LABEL[site.district]} · {site.stream === 'wet' ? 'Wet' : 'Dry'} · {site.capacityL} L
        </div>
      </div>
    </Html>
  );
}
