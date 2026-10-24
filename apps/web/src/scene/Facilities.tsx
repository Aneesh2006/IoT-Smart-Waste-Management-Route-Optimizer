import type { City } from '@binsight/core';

export function Facilities({ city }: { city: City }) {
  const { depot, landfill, recycling } = city;
  return (
    <group>
      {/* Depot: a long garage with bay doors. */}
      <group position={[depot.x - 30, 0, depot.z]}>
        <mesh position={[0, 7, 0]} castShadow receiveShadow>
          <boxGeometry args={[50, 14, 70]} />
          <meshStandardMaterial color="#d6dde6" roughness={0.7} />
        </mesh>
        <mesh position={[0, 15, 0]} castShadow>
          <boxGeometry args={[54, 2, 74]} />
          <meshStandardMaterial color="#0e7490" roughness={0.5} />
        </mesh>
        {[-22, -8, 6, 20].map((z) => (
          <mesh key={z} position={[25.2, 5, z]}>
            <boxGeometry args={[0.6, 9, 11]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        ))}
      </group>

      {/* Transfer station: a tipping hall beside a capped mound. */}
      <group position={[landfill.x + 40, 0, landfill.z]}>
        <mesh position={[90, 0, 30]} scale={[110, 34, 90]} receiveShadow castShadow>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#7d8b5a" roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 10, -10]} castShadow receiveShadow>
          <boxGeometry args={[60, 20, 44]} />
          <meshStandardMaterial color="#c2b8a3" roughness={0.8} />
        </mesh>
        <mesh position={[0, 21, -10]}>
          <boxGeometry args={[64, 2, 48]} />
          <meshStandardMaterial color="#a16207" roughness={0.6} />
        </mesh>
      </group>

      {/* Recycling centre: sorting shed with a green roof. */}
      <group position={[recycling.x, 0, recycling.z + 30]}>
        <mesh position={[0, 8, 0]} castShadow receiveShadow>
          <boxGeometry args={[70, 16, 40]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.7} />
        </mesh>
        <mesh position={[0, 17, 0]}>
          <boxGeometry args={[74, 2, 44]} />
          <meshStandardMaterial color="#16a34a" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}
