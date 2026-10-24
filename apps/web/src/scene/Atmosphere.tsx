import { DAY, HOUR } from '@binsight/core';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Fog, type DirectionalLight, type HemisphereLight } from 'three';

const STORM = new Color('#3b4655');
import { useApp } from '../state/store.ts';
import { lightingAt } from './sky.ts';

/** Shared with every material that glows after dark (windows, street lamps). */
export const nightUniform = { value: 0 };

export function Atmosphere({ center }: { center: { x: number; z: number } }) {
  const sim = useApp((s) => s.sim);
  const scene = useThree((s) => s.scene);
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const light = useMemo(() => lightingAt(6), []);

  useEffect(() => {
    scene.background = new Color('#060a16');
    scene.fog = new Fog('#060a16', 1800, 5200);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene]);

  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    s.target.position.set(center.x, 0, center.z);
    scene.add(s.target);
    return () => {
      scene.remove(s.target);
    };
  }, [scene, center.x, center.z]);

  useFrame(() => {
    const { replay } = useApp.getState();
    const time = replay ? (sim.tape[replay.index]?.time ?? sim.time) : sim.time;
    const hour = (time % DAY) / HOUR;
    lightingAt(hour, light);
    // Overcast while a flood (monsoon) is on.
    if (sim.closures.length > 0) light.sky.lerp(STORM, 0.55 * light.daylight + 0.2);
    if (scene.background instanceof Color) scene.background.copy(light.sky);
    if (scene.fog) scene.fog.color.copy(light.sky);
    nightUniform.value = light.night;
    const s = sun.current;
    if (s) {
      s.intensity = 0.22 + 2.6 * light.daylight;
      s.color.copy(light.sunColor);
      const [dx, dy, dz] = light.sunDir;
      s.position.set(center.x + dx * 1400, dy * 1400 + 200, center.z + dz * 1400);
    }
    if (hemi.current) hemi.current.intensity = 0.12 + 1.05 * light.daylight;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#d6e6ff', '#3a3530', 1]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
        shadow-camera-left={-1150}
        shadow-camera-right={1150}
        shadow-camera-top={1150}
        shadow-camera-bottom={-1150}
        shadow-camera-near={10}
        shadow-camera-far={4200}
      />
    </>
  );
}
