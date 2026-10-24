/// <reference lib="webworker" />
import { installCustomPolicy, policyOrder, runPolicy, type PolicyId, type SimConfig } from '@binsight/core';

/** Every policy on one city (Compare), or one policy on several cities (capacity planner). */
export type CompareRequest =
  | { config: Partial<SimConfig>; days: number; customCode: string | null }
  | { variants: { name: string; config: Partial<SimConfig> }[]; policy: PolicyId; days: number; customCode: string | null };

self.onmessage = (e: MessageEvent<CompareRequest>) => {
  const req = e.data;
  installCustomPolicy(req.customCode);
  if ('variants' in req) {
    for (const v of req.variants) self.postMessage({ type: 'row', name: v.name, row: runPolicy(v.config, req.policy, req.days) });
  } else {
    for (const policy of policyOrder()) self.postMessage({ type: 'row', row: runPolicy(req.config, policy, req.days) });
  }
  self.postMessage({ type: 'done' });
};
