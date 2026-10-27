// Every /api/<route> request lands here, one function for the whole API so warm
// instances share the MongoDB pool and the fleet simulation. The logic lives in
// services/src (api.ts routes it); `pnpm build` bundles it to services/dist.
export { default } from '../services/dist/server.mjs';
