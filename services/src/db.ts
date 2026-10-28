import { attachDatabasePool } from '@vercel/functions';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { BinStatus, IngestMessage, LiveControl, RoutesFrame } from '@binsight/core';
import { env } from './shared.ts';

/**
 * MongoDB Atlas in place of DynamoDB. One client per function instance, cached
 * on globalThis so warm invocations (and Vite-style reloads in dev) reuse the
 * connection pool, and the indexes are created once per instance.
 */
export interface BinDoc {
  city: string;
  bin: string;
  kind: 'fleet' | 'phone';
  r: number;
  ok: boolean;
  temp: number;
  gas: number;
  bat: number;
  tDevice: number;
  simT?: number;
  world?: string;
  status: BinStatus;
  lastSeen: number;
  tReceived?: number;
  nick?: string;
  emoji?: string;
  score?: number;
  dispatchAt?: number;
  fireAlertAt?: number;
  /** Phones only: TTL index deletes the row a day after the phone's last reading. */
  expiresAt?: Date;
}

export interface ReadingDoc {
  bin: string;
  t: number;
  r: number;
  temp: number;
  gas: number;
  expiresAt: Date;
}

export type ControlDoc = LiveControl;

/** The fleet tick's own state: who holds the lease and how far the city has been published. */
export interface FleetDoc {
  city: string;
  leaseOwner?: string;
  leaseUntil?: number;
  /** Wall clock of the last finished tick. */
  wall?: number;
  /** Sim time up to which bin readings have been ingested. */
  simT?: number;
  world?: string;
  lastEvent?: number;
  routeVersion?: number;
  /** The current routes, so late joiners get them from /api/state (Ably keeps no retained messages). */
  routes?: RoutesFrame;
}

/** Readings waiting to be ingested: ingest paused, or a run failed. The SQS queue's job. */
export interface InboxDoc {
  city: string;
  msg: IngestMessage;
  tQueued: number;
  attempts: number;
  /** After a failed try, wait until then before the next one. */
  retryAt?: number;
  lastError?: string;
}

export interface MetricsDoc {
  city: string;
  minute: number;
  expiresAt: Date;
  [counter: string]: unknown;
}

export interface Collections {
  control: Collection<ControlDoc>;
  fleet: Collection<FleetDoc>;
  bins: Collection<BinDoc>;
  readings: Collection<ReadingDoc>;
  inbox: Collection<InboxDoc>;
  deadLetters: Collection<InboxDoc & { failedAt: number }>;
  metrics: Collection<MetricsDoc>;
}

interface Cached {
  client: MongoClient;
  db: Db;
  ready: Promise<Collections>;
}

const KEY = Symbol.for('binsight.mongo');
const g = globalThis as typeof globalThis & { [KEY]?: Cached };

function collections(db: Db): Collections {
  const c = <T extends Document>(name: string) => db.collection<T>(name);
  return {
    control: c<ControlDoc>('control'),
    fleet: c<FleetDoc>('fleet'),
    bins: c<BinDoc>('bins'),
    readings: c<ReadingDoc>('readings'),
    inbox: c<InboxDoc>('inbox'),
    deadLetters: c<InboxDoc & { failedAt: number }>('deadLetters'),
    metrics: c<MetricsDoc>('metrics'),
  };
}

export async function ensureIndexes(col: Collections) {
  await Promise.all([
    col.control.createIndex({ city: 1 }, { unique: true }),
    col.fleet.createIndex({ city: 1 }, { unique: true }),
    col.bins.createIndex({ city: 1, bin: 1 }, { unique: true }),
    col.bins.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Unique (bin, t) makes a retried batch insert idempotent.
    col.readings.createIndex({ bin: 1, t: 1 }, { unique: true }),
    col.readings.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    col.inbox.createIndex({ city: 1, tQueued: 1 }),
    col.deadLetters.createIndex({ failedAt: 1 }, { expireAfterSeconds: 4 * 24 * 3600 }),
    col.metrics.createIndex({ city: 1, minute: 1 }, { unique: true }),
    col.metrics.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  return col;
}

function connect(client: MongoClient, dbName: string): Cached {
  const db = client.db(dbName);
  const ready = client.connect().then(() => ensureIndexes(collections(db)));
  // A failed connect must not poison the instance: the next request tries again.
  ready.catch(() => {
    if (g[KEY]?.client === client) delete g[KEY];
  });
  return { client, db, ready };
}

export function db(): Promise<Collections> {
  if (!g[KEY]) {
    const client = new MongoClient(env.mongoUri, { maxPoolSize: 10, maxIdleTimeMS: 60_000, appName: 'binsight' });
    // On Fluid compute, close idle pool connections before the instance is suspended.
    attachDatabasePool(client);
    g[KEY] = connect(client, env.mongoDb);
  }
  return g[KEY].ready;
}

/** Tests (and the dev server) can hand in their own client, e.g. one pointed at mongodb-memory-server. */
export function useMongoClient(client: MongoClient, dbName: string) {
  g[KEY] = connect(client, dbName);
  return g[KEY].ready;
}

export function isDuplicateKey(e: unknown) {
  return (e as { code?: number }).code === 11000;
}
