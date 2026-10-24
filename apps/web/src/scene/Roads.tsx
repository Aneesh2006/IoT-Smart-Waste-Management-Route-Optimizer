import { ROAD_HALF_WIDTH, type City } from '@binsight/core';
import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';

/** One merged mesh for all asphalt, one for the arterial centre dashes. */
function buildRoads(city: City) {
  const asphalt: number[] = [];
  const dashes: number[] = [];
  const quad = (out: number[], ax: number, az: number, bx: number, bz: number, half: number, y: number) => {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * half;
    const nz = ((bx - ax) / len) * half;
    out.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    out.push(ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  };
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const half = e.arterial ? ROAD_HALF_WIDTH.arterial : ROAD_HALF_WIDTH.street;
    // Run a little past the ends so joints overlap cleanly.
    const len = e.length || 1;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const ext = a.kind === 'bin' || b.kind === 'bin' ? 0 : half;
    quad(asphalt, a.x - ux * ext, a.z - uz * ext, b.x + ux * ext, b.z + uz * ext, half, 0.08);
    if (e.arterial) {
      for (let s = 6; s < len - 6; s += 14) {
        quad(dashes, a.x + ux * s, a.z + uz * s, a.x + ux * (s + 6), a.z + uz * (s + 6), 0.35, 0.12);
      }
    }
  }
  const make = (positions: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.computeBoundingSphere();
    return g;
  };
  return { asphalt: make(asphalt), dashes: make(dashes) };
}

export function Roads({ city }: { city: City }) {
  const { asphalt, dashes } = useMemo(() => buildRoads(city), [city]);
  return (
    <group>
      <mesh geometry={asphalt} receiveShadow>
        <meshStandardMaterial color="#363b44" roughness={0.9} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={dashes}>
        <meshBasicMaterial color="#e8c35a" toneMapped={false} />
      </mesh>
    </group>
  );
}
