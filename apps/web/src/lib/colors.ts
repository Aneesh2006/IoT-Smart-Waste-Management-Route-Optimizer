import { Color } from 'three';
import type { DistrictKind, PolicyId, WasteStream } from '@binsight/core';

export const TRUCK_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#4ade80', '#60a5fa', '#f87171'];

export const STREAM_COLORS: Record<WasteStream, string> = { wet: '#34d399', dry: '#60a5fa' };

export const DISTRICT_LABEL: Record<DistrictKind, string> = {
  residential: 'Residential',
  market: 'Market',
  commercial: 'Commercial',
  institutional: 'Institutional',
  industrial: 'Industrial',
  park: 'Park',
};

export const DISTRICT_COLORS: Record<DistrictKind, string> = {
  residential: '#c9b896',
  market: '#e0a96e',
  commercial: '#93a9c9',
  institutional: '#b9a2d6',
  industrial: '#9b9686',
  park: '#5fae52',
};

const STOPS: [number, string][] = [
  [0, '#22c55e'],
  [0.5, '#a3e635'],
  [0.72, '#facc15'],
  [0.88, '#f97316'],
  [1, '#ef4444'],
];
const stopColors = STOPS.map(([t, c]) => [t, new Color(c)] as const);

/** Fill fraction to the green → red ramp used everywhere (scene and HUD). */
export function fillColor(fill: number, out = new Color()): Color {
  const f = Math.min(1, Math.max(0, fill));
  for (let i = 1; i < stopColors.length; i++) {
    const [t1, c1] = stopColors[i];
    if (f <= t1) {
      const [t0, c0] = stopColors[i - 1];
      return out.copy(c0).lerp(c1, (f - t0) / (t1 - t0));
    }
  }
  return out.copy(stopColors[stopColors.length - 1][1]);
}

export function fillCss(fill: number) {
  return `#${fillColor(fill).getHexString()}`;
}

export type FillBand = 'ok' | 'filling' | 'critical' | 'overflow';

export function fillBand(fill: number): FillBand {
  if (fill >= 1) return 'overflow';
  if (fill >= 0.8) return 'critical';
  if (fill >= 0.5) return 'filling';
  return 'ok';
}

export const BAND_META: Record<FillBand, { label: string; color: string }> = {
  ok: { label: 'Healthy', color: '#22c55e' },
  filling: { label: 'Filling', color: '#facc15' },
  critical: { label: 'Critical', color: '#f97316' },
  overflow: { label: 'Overflowing', color: '#ef4444' },
};

export const POLICY_COLORS: Record<PolicyId, string> = {
  fixed: '#94a3b8',
  threshold: '#fbbf24',
  predictive: '#5eead4',
  dynamic: '#a78bfa',
  custom: '#f472b6',
};
