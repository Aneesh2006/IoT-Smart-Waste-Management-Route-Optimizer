import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Vector3 } from 'three';

/**
 * Screen-space labels without a React root per label: DOM elements register a
 * world-position getter here, and one projector inside the canvas moves them
 * every frame.
 */
type Anchor = { el: HTMLElement; at: () => readonly [number, number, number] | null };

const anchors = new Map<string, Anchor>();

/** Ref callback for a label element. Pass `null` position to hide it. */
export function anchor(key: string, at: Anchor['at']) {
  return (el: HTMLElement | null) => {
    if (el) anchors.set(key, { el, at });
    else anchors.delete(key);
  };
}

export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    for (const { el, at } of anchors.values()) {
      const p = at();
      if (!p) {
        el.style.visibility = 'hidden';
        continue;
      }
      v.set(p[0], p[1], p[2]).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  });
  return null;
}
