/// <reference lib="webworker" />
import { installCustomPolicy, policyOrder, runPolicy, type SimConfig } from '@binsight/core';

export interface CompareRequest {
  config: Partial<SimConfig>;
  days: number;
  customCode: string | null;
}

self.onmessage = (e: MessageEvent<CompareRequest>) => {
  const { config, days, customCode } = e.data;
  installCustomPolicy(customCode);
  for (const policy of policyOrder()) {
    self.postMessage({ type: 'row', row: runPolicy(config, policy, days) });
  }
  self.postMessage({ type: 'done' });
};
