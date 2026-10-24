import { MapControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Suspense, useMemo } from 'react';
import { Vector3 } from 'three';
import { useApp } from '../state/store.ts';
import { Atmosphere } from './Atmosphere.tsx';
import { Bins } from './Bins.tsx';
import { Buildings } from './Buildings.tsx';
import { Facilities } from './Facilities.tsx';
import { Greenery } from './Greenery.tsx';
import { CameraProbe } from './cameraProbe.tsx';
import { Hazards } from './Hazards.tsx';
import { Heatmap } from './Heatmap.tsx';
import { NightSky } from './NightSky.tsx';
import { PhoneBins } from './PhoneBins.tsx';
import { PickupFx } from './PickupFx.tsx';
import { Weather } from './Weather.tsx';
import { LabelProjector } from './Labels.tsx';
import { Ground } from './Ground.tsx';
import { Roads } from './Roads.tsx';
import { Trucks } from './Trucks.tsx';

/** After a few seconds, drop to performance mode once if frames are slow (weak laptops, projectors). */
function FpsWatchdog() {
  const acc = useMemo(() => ({ warm: 0, t: 0, frames: 0, done: false }), []);
  useFrame((_, dt) => {
    if (acc.done) return;
    // Skip the first seconds: shader compilation and asset upload make them slow everywhere.
    if (acc.warm < 3) {
      acc.warm += dt;
      return;
    }
    acc.t += dt;
    acc.frames++;
    if (acc.t < 4) return;
    acc.done = true;
    const fps = acc.frames / acc.t;
    const s = useApp.getState();
    if (fps < 24 && s.quality === 'high') s.setQuality('low', true);
  });
  return null;
}

/** Advances the simulation every frame and nudges the HUD ~6 times a second. */
function SimDriver() {
  const acc = useMemo(() => ({ t: 0 }), []);
  useFrame((_, dt) => {
    const { sim, speed, paused, bump } = useApp.getState();
    if (!paused) sim.advance(Math.min(dt, 0.1) * speed);
    acc.t += dt;
    if (acc.t > 0.16) {
      acc.t = 0;
      bump();
    }
  });
  return null;
}

type Controls = { target: Vector3; update(): void };

/** Smoothly flies to a focus point, or keeps a followed truck centred. */
function CameraRig() {
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const camera = useThree((s) => s.camera);
  const offset = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  useFrame((_, dt) => {
    if (!controls) return;
    const { focus, followTruck, sim, clearFocus, orbit } = useApp.getState();
    // Cinematic mode: drift slowly around whatever we're looking at.
    if (orbit) {
      offset.copy(camera.position).sub(controls.target).applyAxisAngle(up, Math.min(dt, 0.1) * 0.06);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
    const target = followTruck !== null ? sim.trucks[followTruck] : focus;
    if (!target) return;
    const k = 1 - Math.exp(-dt * 3.5);
    const tgt = controls.target;
    const dx = (target.x - tgt.x) * k;
    const dz = (target.z - tgt.z) * k;
    tgt.x += dx;
    tgt.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
    let settled = Math.abs(target.x - tgt.x) < 2 && Math.abs(target.z - tgt.z) < 2;
    if (focus?.distance) {
      offset.copy(camera.position).sub(tgt);
      const len = offset.length();
      const next = len + (focus.distance - len) * k;
      offset.setLength(next);
      camera.position.copy(tgt).add(offset);
      settled = settled && Math.abs(next - focus.distance) < 3;
    }
    if (focus && settled) clearFocus();
    controls.update();
  });
  return null;
}

function World() {
  const sim = useApp((s) => s.sim);
  const simKey = useApp((s) => s.simKey);
  const city = sim.city;
  const center = useMemo(() => ({ x: (city.bounds.x0 + city.bounds.x1) / 2, z: (city.bounds.z0 + city.bounds.z1) / 2 }), [city]);
  return (
    <group key={simKey}>
      <Atmosphere center={center} />
      <Ground city={city} />
      <Roads city={city} />
      <Heatmap city={city} />
      <Buildings city={city} />
      <Greenery city={city} />
      <Facilities city={city} />
      <Bins city={city} />
      <Hazards city={city} />
      <PhoneBins />
      <Weather city={city} />
      <PickupFx />
      <NightSky />
      <Trucks />
    </group>
  );
}

export function CityCanvas() {
  const sim = useApp((s) => s.sim);
  const quality = useApp((s) => s.quality);
  const high = quality === 'high';
  const { x0, x1, z0, z1 } = sim.city.bounds;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return (
    <Canvas
      shadows={high ? 'percentage' : false}
      dpr={high ? [1, 2] : 1}
      camera={{ position: [cx - 650, 950, cz + 1250], fov: 38, near: 5, far: 12000 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onPointerMissed={() => {
        const s = useApp.getState();
        if (s.selectedBin !== null) s.selectBin(null);
        if (s.selectedTruck !== null) s.selectTruck(null);
      }}
    >
      <Suspense fallback={null}>
        <World />
        <SimDriver />
        <CameraRig />
        <FpsWatchdog />
        <CameraProbe />
        <LabelProjector />
        <MapControls
          makeDefault
          target={[cx, 0, cz]}
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={1.32}
          minDistance={40}
          maxDistance={3200}
          screenSpacePanning={false}
        />
        <EffectComposer key={quality} multisampling={high ? 4 : 0}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.85} radius={0.72} />
          <Vignette eskil={false} offset={0.22} darkness={0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
