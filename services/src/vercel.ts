import { handle } from './api.ts';

/** The Vercel function's handler (Web Request → Response), bundled to dist/server.mjs by `pnpm build`. */
export default { fetch: handle };
