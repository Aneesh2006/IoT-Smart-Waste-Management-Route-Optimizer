import {
  Simulation,
  binStatus,
  buildFleetFrame,
  buildRoutesFrame,
  defaultControl,
  phonePlacement,
  worldKey,
  type StateUpdate,
} from '@binsight/core';
import { describe, expect, it } from 'vitest';
import { LiveWorld } from '../src/live/LiveWorld.ts';

/** The cloud → browser path: messages built from a sim must rebuild the same city in the browser. */
function setup() {
  const control = { ...defaultControl('demo'), seed: 'live-test', policy: 'fixed' as const, startPolicy: 'fixed' as const, running: true };
  const key = worldKey(control);
  const src = new Simulation({ seed: control.seed, bins: control.bins, trucks: control.trucks, policy: 'fixed' });
  src.advance(3600 * 1.3);
  const calls: Record<string, unknown>[] = [];
  const world = new LiveWorld(control, { control: async (b) => void calls.push(b), notify: () => {} }, 0);
  return { control, key, src, world, calls };
}

const stateFrom = (src: Simulation, key: string): StateUpdate => {
  const now = Date.now();
  return {
    bins: src.bins.map((b) => ({ id: String(b.id), kind: 'fleet', r: b.reading, ok: b.sensorOk, temp: b.temperature, gas: b.gas, bat: b.battery, tDevice: now, world: key, status: binStatus({ r: b.reading, ok: b.sensorOk, temp: b.temperature }) })),
    hops: { tDevice: now - 300, tReceived: now - 240, tStored: now - 90, tPublish: now - 40 },
    batch: 10,
  };
};

describe('LiveWorld', () => {
  it('builds the same city as the cloud from the control record', () => {
    const { src, world } = setup();
    expect(world.city.bins.map((b) => b.label)).toEqual(src.city.bins.map((b) => b.label));
    expect(world.city.edges.length).toBe(src.city.edges.length);
  });

  it('applies fleet, routes and state messages', () => {
    const { key, src, world } = setup();
    expect(world.applyFleet(buildFleetFrame(src, key, 60, true))).toBe(true);
    src.trucks.forEach((t, i) => {
      expect(world.trucks[i].status).toBe(t.status);
      expect(world.trucks[i].x).toBeCloseTo(t.x, 0);
      expect(world.trucks[i].z).toBeCloseTo(t.z, 0);
    });
    expect(world.metrics.distanceM).toBeCloseTo(src.metrics.distanceM, 6);
    expect(world.time).toBe(src.time);

    world.applyRoutes(buildRoutesFrame(src, key));
    src.trucks.forEach((t, i) => {
      if (!t.route) return expect(world.trucks[i].route).toBeNull();
      const r = world.trucks[i].route!;
      expect(r.xs.length).toBe(t.route.xs.length);
      expect(r.xs.at(-1)).toBeCloseTo(t.route.xs.at(-1)!, 3);
      expect(r.stops.filter((s) => s.kind === 'bin').length).toBe(t.route.stops.filter((s) => s.kind === 'bin').length);
    });

    world.applyState(stateFrom(src, key));
    src.bins.forEach((b, i) => expect(world.bins[i].reading).toBeCloseTo(b.reading, 6));
    expect(world.latency()!.total).toBeGreaterThan(0);
  });

  it('ignores frames from another world and asks to rebuild', () => {
    const { src, world } = setup();
    expect(world.applyFleet(buildFleetFrame(src, 'someone-else:120:4:9', 60, false))).toBe(false);
  });

  it('places phones where every browser will agree', () => {
    const { world } = setup();
    const id = 'p-0b5c6f3e-1234';
    world.applyState({
      bins: [{ id, kind: 'phone', r: 0.5, ok: true, temp: 29, gas: 40, bat: 100, tDevice: Date.now(), nick: 'Priya', emoji: '🐯', status: 'filling' }],
      hops: { tDevice: 0, tReceived: 0, tStored: 0, tPublish: 0 },
      batch: 1,
    });
    const p = world.phones.get(id)!;
    expect(p.nick).toBe('Priya');
    expect(p).toMatchObject(phonePlacement(world.city, id));
  });

  it('sends operator actions to the cloud instead of simulating them', () => {
    const { world, calls } = setup();
    world.setPolicy('dynamic');
    world.trigger('fire');
    expect(calls).toEqual([
      { action: 'policy', policy: 'dynamic' },
      { action: 'chaos', kind: 'fire' },
    ]);
  });
});
