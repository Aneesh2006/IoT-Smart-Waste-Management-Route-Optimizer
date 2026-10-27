/// <reference lib="webworker" />
import { installCustomPolicy, policyOrder, runPolicy, validateCustomPolicy, type PolicyId, type SimConfig } from '@binsight/core';

/**
 * Every policy on one city (Compare), one policy on several city variants
 * (capacity planner), every policy on several seeds (Compare's "is it luck?"),
 * or a custom policy's test run (off the main thread, so a loop can't freeze the page).
 */
export type CompareRequest =
  | { validate: string }
  | { config: Partial<SimConfig>; days: number; customCode: string | null }
  | { variants: { name: string; config: Partial<SimConfig> }[]; policy: PolicyId; days: number; customCode: string | null }
  | { seeds: string[]; config: Partial<SimConfig>; days: number; customCode: string | null };

self.onmessage = (e: MessageEvent<CompareRequest>) => {
  const req = e.data;
  if ('validate' in req) {
    self.postMessage({ type: 'validated', report: validateCustomPolicy(req.validate) });
    return;
  }
  installCustomPolicy(req.customCode);
  if ('seeds' in req) {
    for (const seed of req.seeds) {
      for (const policy of policyOrder()) self.postMessage({ type: 'row', name: seed, row: runPolicy({ ...req.config, seed }, policy, req.days) });
    }
  } else if ('variants' in req) {
    for (const v of req.variants) self.postMessage({ type: 'row', name: v.name, row: runPolicy(v.config, req.policy, req.days) });
  } else {
    for (const policy of policyOrder()) self.postMessage({ type: 'row', row: runPolicy(req.config, policy, req.days) });
  }
  self.postMessage({ type: 'done' });
};
