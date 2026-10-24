import type { HopSample } from './LiveWorld.ts';

/** One batch of readings on its way through the pipeline, as the X-Ray draws it. */
export interface Packet {
  id: number;
  kind: 'fleet' | 'phone';
  label: string;
  payload: unknown;
  hops: HopSample;
  /** True in Sandbox, where the timings are modelled rather than measured. */
  simulated: boolean;
}

let nextId = 1;
const listeners = new Set<(p: Packet) => void>();
const recent: Packet[] = [];

export function emitPacket(p: Omit<Packet, 'id'>) {
  const packet = { ...p, id: nextId++ };
  recent.push(packet);
  if (recent.length > 60) recent.shift();
  for (const fn of listeners) fn(packet);
}

export function onPacket(fn: (p: Packet) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function recentPackets() {
  return recent;
}
