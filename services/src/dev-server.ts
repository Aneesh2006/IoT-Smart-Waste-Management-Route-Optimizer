import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Local stand-in for `vercel dev`: serves the same API on :3001 (Vite proxies
 * /api to it), with
 * - `.env` from the repo root,
 * - an in-memory MongoDB when MONGODB_URI is unset,
 * - a local realtime bus over Server-Sent Events when ABLY_API_KEY is unset,
 * - throwaway SESSION_SECRET / OPERATOR_PASSWORD when unset (printed below).
 */
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const notes: string[] = [];
if (!process.env.ABLY_API_KEY) {
  process.env.BINSIGHT_LOCAL_REALTIME = '1';
  notes.push('realtime: local SSE bus (set ABLY_API_KEY to use Ably)');
} else notes.push('realtime: Ably');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = randomBytes(32).toString('hex');
if (!process.env.OPERATOR_PASSWORD) {
  process.env.OPERATOR_PASSWORD = randomBytes(6).toString('base64url');
  notes.push(`operator password for this run: ${process.env.OPERATOR_PASSWORD}`);
}
if (!process.env.MONGODB_URI) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  notes.push('database: in-memory MongoDB, wiped on exit (set MONGODB_URI for Atlas)');
} else notes.push('database: MONGODB_URI');

// Imported only now, so everything above is in place before the services read their environment.
const { handle } = await import('./api.ts');
const { localBus } = await import('./realtime.ts');
const { channelName } = await import('@binsight/core');

const PORT = Number(process.env.API_PORT ?? 3001);

/** The local bus as Server-Sent Events: /api/realtime-local?topics=a,b */
function sse(req: IncomingMessage, res: ServerResponse, url: URL) {
  const wanted = new Set((url.searchParams.get('topics') ?? '').split(',').filter(Boolean).map(channelName));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': connected\n\n');
  const onMessage = (topic: string, data: unknown) => {
    if (wanted.has(channelName(topic))) res.write(`data: ${JSON.stringify({ topic, data })}\n\n`);
  };
  localBus.on('message', onMessage);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(ping);
    localBus.off('message', onMessage);
  });
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);
  if (url.pathname === '/api/realtime-local') return sse(req, res, url);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const response = await handle(new Request(url, { method: req.method, headers, body: hasBody ? await body(req) : undefined }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`BinSight API on http://localhost:${PORT}/api (Vite proxies /api here)`);
  for (const n of notes) console.log(`  ${n}`);
});
