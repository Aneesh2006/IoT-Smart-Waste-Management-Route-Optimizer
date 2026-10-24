/// <reference lib="webworker" />
import { POLICY_ORDER, runPolicy, type SimConfig } from '@binsight/core';

export interface CompareRequest {
  config: Partial<SimConfig>;
  days: number;
}

self.onmessage = (e: MessageEvent<CompareRequest>) => {
  const { config, days } = e.data;
  for (const policy of POLICY_ORDER) {
    self.postMessage({ type: 'row', row: runPolicy(config, policy, days) });
  }
  self.postMessage({ type: 'done' });
};
