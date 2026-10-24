import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';

/** Where the camera is looking on the ground, shared with the 2D minimap. */
export const cameraFootprint = {
  corners: [] as { x: number; z: number }[],
  version: 0,
};

const NDC: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export function CameraProbe() {
  const camera = useThree((s) => s.camera);
  const tools = useMemo(() => ({ ray: new Raycaster(), ground: new Plane(new Vector3(0, 1, 0), 0), hit: new Vector3(), ndc: new Vector2(), t: 0 }), []);
  useFrame((_, dt) => {
    tools.t += dt;
    if (tools.t < 0.15) return;
    tools.t = 0;
    const corners: { x: number; z: number }[] = [];
    for (const [x, y] of NDC) {
      tools.ndc.set(x, y);
      tools.ray.setFromCamera(tools.ndc, camera);
      // Rays above the horizon never meet the ground; clamp them to a far point instead.
      if (tools.ray.ray.intersectPlane(tools.ground, tools.hit)) corners.push({ x: tools.hit.x, z: tools.hit.z });
      else {
        const d = tools.ray.ray.direction;
        corners.push({ x: camera.position.x + d.x * 4000, z: camera.position.z + d.z * 4000 });
      }
    }
    cameraFootprint.corners = corners;
    cameraFootprint.version++;
  });
  return null;
}
