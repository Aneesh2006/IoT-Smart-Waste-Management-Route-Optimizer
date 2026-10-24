import { useEffect, useRef } from 'react';
import { sounds } from '../lib/sound.ts';
import { useApp } from '../state/store.ts';

/** Plays a cue for new simulation events while sound is on, rate-limited so time-warp stays calm. */
export function AudioCues() {
  const tick = useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const on = useApp((s) => s.sound);
  const seen = useRef(-1);
  const last = useRef<Record<string, number>>({});

  useEffect(() => {
    seen.current = sim.events.at(-1)?.id ?? -1;
  }, [sim]);

  useEffect(() => {
    const fresh = sim.events.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    if (!on) return;
    const now = performance.now();
    const play = (key: keyof typeof sounds, gap: number) => {
      if (now - (last.current[key] ?? 0) < gap) return;
      last.current[key] = now;
      sounds[key]();
    };
    for (const e of fresh) {
      if (e.kind === 'alert') play(/joined/.test(e.text) ? 'join' : 'alert', 1500);
      else if (e.kind === 'plan') play('plan', 800);
      else if (e.kind === 'overflow') play('overflow', 1200);
      else if (e.kind === 'unload') play('unload', 1500);
    }
  }, [tick, sim, on]);

  return null;
}
