import { describe, expect, it } from 'vitest';
import { latestPerBin, latestUpdate, oldestHops, parseMessage, truckFor, withStatus } from '../src/ingest-logic.ts';

const body = (o: Record<string, unknown>) => JSON.stringify({ city: 'demo', binId: '7', r: 0.5, ok: true, temp: 30, gas: 40, bat: 90, tDevice: Date.now(), tReceived: Date.now(), ...o });

describe('ingest logic', () => {
  it('accepts objects as well as JSON bodies', () => {
    expect(parseMessage({ city: 'demo', binId: 'p-1', r: 0.4 })!.kind).toBe('phone');
    expect(parseMessage([] as unknown as Record<string, unknown>)).toBeNull();
  });

  it('rejects junk and clamps what phones send', () => {
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage(JSON.stringify({ r: 1 }))).toBeNull();
    const m = parseMessage(body({ binId: 'p-abc', r: 9, nick: '<script>alert(1)</script>very long nickname', emoji: '🐯🦊🐼', event: 'collected' }))!;
    expect(m.kind).toBe('phone');
    expect(m.r).toBe(1.3);
    expect(m.nick).not.toContain('<');
    expect(m.nick!.length).toBeLessThanOrEqual(20);
    expect([...m.emoji!]).toHaveLength(2);
    expect(m.event).toBe('collected');
  });

  it('only fleet messages keep a world key', () => {
    expect(parseMessage(body({ world: 'w1' }))!.world).toBe('w1');
    expect(parseMessage(body({ binId: 'p-x', world: 'w1' }))!.world).toBeUndefined();
  });

  it('keeps the newest reading per bin and reports the oldest hops', () => {
    const a = { msg: parseMessage(body({ r: 0.2, tDevice: Date.now() - 2000, tReceived: 1 }))! };
    const b = { msg: parseMessage(body({ r: 0.3, tDevice: Date.now() - 1000, tReceived: 2 }))! };
    const c = { msg: parseMessage(body({ binId: '8', tDevice: Date.now() - 5000, tReceived: 3 }))! };
    const latest = latestPerBin([a, b, c]);
    expect(latest).toHaveLength(2);
    expect(latest.find((x) => x.msg.id === '7')!.msg.r).toBe(0.3);
    expect(oldestHops([a, b, c], 20, 30)).toMatchObject({ tReceived: 3, tStored: 20, tPublish: 30 });
  });

  it('derives status, fire first', () => {
    expect(withStatus(parseMessage(body({ r: 0.9, temp: 80 }))!).status).toBe('fire');
    expect(withStatus(parseMessage(body({ r: 1.1 }))!).status).toBe('overflow');
    expect(withStatus(parseMessage(body({ ok: false }))!).status).toBe('offline');
    expect(truckFor('p-abc')).toMatch(/^Truck [1-4]$/);
  });

  it('updates the latest state only when newer, leaving keys and other fields alone', () => {
    const u = latestUpdate({ city: 'demo', bin: '7', r: 0.5, tDevice: 100, nick: undefined });
    expect(u.filter).toEqual({ city: 'demo', bin: '7', $or: [{ tDevice: { $exists: false } }, { tDevice: { $lte: 100 } }] });
    expect(u.update).toEqual({ $set: { r: 0.5, tDevice: 100 } });
  });
});
