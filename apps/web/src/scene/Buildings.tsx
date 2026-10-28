import { createRng, type City, type DistrictKind } from '@binsight/core';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, MeshStandardMaterial, Object3D, type InstancedMesh } from 'three';
import { useApp } from '../state/store.ts';
import { nightUniform } from './Atmosphere.tsx';
import { PAD_HEIGHT } from './Ground.tsx';
import { BUILDING_IN, BUILDING_LAG, blockDelays, clamp01, delayAt, easeOutBack, useIntro } from './intro.ts';

const PALETTE: Record<DistrictKind, string[]> = {
  residential: ['#efe4d2', '#e8d5bf', '#f3ece0', '#dcc7b0', '#e9dccb', '#f0d9c4'],
  commercial: ['#9fb4cc', '#b8c7d8', '#8aa1bb', '#c8d3df', '#7d93ad'],
  market: ['#f2a7a0', '#f6d58b', '#8fd3c6', '#f4b183', '#c9a7e8', '#a7d38f', '#f7e1a6'],
  institutional: ['#c97b5f', '#b8664c', '#d39073'],
  industrial: ['#8e99a6', '#a1a9b3', '#7f8994', '#b3aa98'],
  park: ['#cccccc'],
};

/**
 * Standard material plus procedural windows: a grid of panes on every wall,
 * a random share of them lit, fading in as night falls (and blooming).
 */
/** 1 normally, low in data view so ghosted buildings don't leave floating windows. */
const windowsUniform = { value: 1 };

function makeMaterial() {
  const m = new MeshStandardMaterial({ roughness: 0.82, metalness: 0.05 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.uniforms.uWindows = windowsUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWinPos;
        varying vec3 vWinNormal;
        varying float vWinSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 winWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          winWorld = instanceMatrix * winWorld;
        #endif
        winWorld = modelMatrix * winWorld;
        vWinPos = winWorld.xyz;
        vWinNormal = normal;
        vWinSeed = float(gl_InstanceID);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        uniform float uWindows;
        varying vec3 vWinPos;
        varying vec3 vWinNormal;
        varying float vWinSeed;
        float winHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (abs(vWinNormal.y) < 0.5) {
          float along = abs(vWinNormal.x) > 0.5 ? vWinPos.z : vWinPos.x;
          float fy = (vWinPos.y - ${PAD_HEIGHT.toFixed(2)}) / 3.2;
          float fx = along / 3.4;
          vec2 cell = vec2(floor(fx), floor(fy));
          vec2 f = fract(vec2(fx, fy));
          float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.78);
          float h = winHash(vec3(cell, vWinSeed));
          float lit = step(0.72, h);
          vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.62, 0.85, 1.0), step(0.95, h));
          // Far away a pane is under a pixel: fade to the facade's average glow instead of sparkling.
          float px = max(fwidth(fx), fwidth(fy));
          float detail = 1.0 - smoothstep(0.18, 0.5, px);
          float glow = mix(0.03, pane * lit, detail);
          diffuseColor.rgb *= 1.0 - pane * 0.18 * detail;
          totalEmissiveRadiance += warm * glow * uNight * uWindows * mix(1.0, 2.6, detail);
        }`,
      );
  };
  return m;
}

export function Buildings({ city }: { city: City }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const material = useMemo(makeMaterial, []);
  const dataView = useApp((s) => s.dataView);

  useEffect(() => {
    material.transparent = dataView;
    material.opacity = dataView ? 0.14 : 1;
    material.depthWrite = !dataView;
    material.needsUpdate = true;
    windowsUniform.value = dataView ? 0.12 : 1;
  }, [dataView, material]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = createRng(`${city.seed}/paint`);
    const o = new Object3D();
    const c = new Color();
    city.buildings.forEach((b, i) => {
      o.position.set(b.x, PAD_HEIGHT, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(rng.pick(PALETTE[b.district])).offsetHSL(0, 0, rng.range(-0.04, 0.04)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [city]);

  // Buildings rise out of their block just after the pad lands.
  const starts = useMemo(() => {
    const delays = blockDelays(city);
    return Float32Array.from(city.buildings, (b) => delayAt(city, delays, b.x, b.z) + BUILDING_LAG);
  }, [city]);
  const o = useMemo(() => new Object3D(), []);
  useIntro((t) => {
    const mesh = ref.current;
    if (!mesh) return;
    city.buildings.forEach((b, i) => {
      const p = clamp01((t - starts[i]) / BUILDING_IN);
      const k = p === 0 ? 0 : easeOutBack(p);
      const g = p === 0 ? 0 : Math.min(1, 0.6 + p);
      o.position.set(b.x, PAD_HEIGHT, b.z);
      o.scale.set(b.w * g, b.h * k, b.d * g);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, city.buildings.length]} castShadow={!dataView} receiveShadow />;
}
