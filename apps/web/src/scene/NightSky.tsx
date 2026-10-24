import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, type Group, type Mesh, type MeshBasicMaterial, type PointsMaterial, type Vector3 } from 'three';
import { useApp } from '../state/store.ts';
import { nightUniform } from './Atmosphere.tsx';

/** A soft round dot, so stars aren't drawn as squares. */
function starSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Stars and a moon that fade in after dusk and follow the camera. */
export function NightSky() {
  const group = useRef<Group>(null);
  const moon = useRef<Mesh>(null);
  const stars = useRef<PointsMaterial>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null;
  const sprite = useMemo(starSprite, []);
  const geometry = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Upper hemisphere only, a little denser near the horizon.
      const u = Math.random() ** 0.7;
      const theta = Math.random() * Math.PI * 2;
      const y = 0.08 + u * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(theta) * r * 4200, y * 4200, Math.sin(theta) * r * 4200], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame(() => {
    const night = nightUniform.value;
    const g = group.current;
    if (!g) return;
    g.visible = night > 0.02 && !useApp.getState().dataView;
    if (controls) g.position.set(controls.target.x, 0, controls.target.z);
    if (stars.current) stars.current.opacity = night * 0.9;
    if (moon.current) (moon.current.material as MeshBasicMaterial).opacity = night;
  });

  return (
    <group ref={group}>
      <points geometry={geometry}>
        <pointsMaterial ref={stars} size={3.2} map={sprite} sizeAttenuation={false} color="#dbeafe" transparent depthWrite={false} fog={false} toneMapped={false} />
      </points>
      <mesh ref={moon} position={[-2400, 2100, -2600]}>
        <sphereGeometry args={[110, 24, 16]} />
        <meshBasicMaterial color="#fef9c3" transparent fog={false} toneMapped={false} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}
