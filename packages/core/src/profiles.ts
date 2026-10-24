import type { DistrictKind } from './types.ts';

/**
 * How fast each kind of neighbourhood produces waste. `daily` is the share of
 * a bin's capacity generated per average day; `hourly` and `weekday` shape it
 * (both average to 1, so they move waste around without changing the total).
 */
export interface WasteProfile {
  daily: number;
  hourly: number[];
  /** Monday first. */
  weekday: number[];
}

const normalise = (xs: number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.map((x) => x / mean);
};

// Hour of day:          0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
const RESIDENTIAL = [0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1.4, 2.2, 2.4, 1.8, 1.0, 0.8, 0.9, 1.0, 0.8, 0.7, 0.8, 1.0, 1.3, 1.8, 2.1, 1.8, 1.0, 0.5];
const MARKET = [0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 1.9, 1.8, 1.4, 1.2, 1.3, 1.7, 2.3, 2.8, 3.0, 2.6, 1.6, 0.6, 0.2];
const COMMERCIAL = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.7, 1.5, 2.1, 2.2, 2.1, 2.4, 2.3, 1.9, 1.8, 1.7, 1.5, 1.2, 0.8, 0.5, 0.3, 0.2, 0.1];
const INSTITUTIONAL = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 1.0, 2.0, 2.3, 2.2, 2.0, 2.5, 2.4, 2.0, 1.8, 1.4, 0.8, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1];
const INDUSTRIAL = [0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 1.0, 1.5, 1.6, 1.6, 1.6, 1.6, 1.4, 1.5, 1.6, 1.6, 1.5, 1.3, 1.0, 0.8, 0.6, 0.5, 0.4, 0.4];
const PARK = [0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 1.2, 1.4, 1.0, 0.6, 0.5, 0.6, 0.8, 0.8, 0.8, 1.0, 1.6, 2.4, 2.9, 2.6, 1.8, 0.9, 0.3, 0.1];

export const PROFILES: Record<DistrictKind, WasteProfile> = {
  residential: { daily: 0.42, hourly: normalise(RESIDENTIAL), weekday: normalise([1, 0.95, 0.95, 1, 1.05, 1.2, 1.25]) },
  market: { daily: 0.95, hourly: normalise(MARKET), weekday: normalise([0.9, 0.85, 0.9, 0.95, 1.1, 1.35, 1.45]) },
  commercial: { daily: 0.45, hourly: normalise(COMMERCIAL), weekday: normalise([1.15, 1.15, 1.15, 1.15, 1.15, 0.65, 0.45]) },
  institutional: { daily: 0.32, hourly: normalise(INSTITUTIONAL), weekday: normalise([1.2, 1.2, 1.2, 1.2, 1.2, 0.55, 0.3]) },
  industrial: { daily: 0.38, hourly: normalise(INDUSTRIAL), weekday: normalise([1.1, 1.1, 1.1, 1.1, 1.1, 0.85, 0.6]) },
  park: { daily: 0.3, hourly: normalise(PARK), weekday: normalise([0.8, 0.75, 0.75, 0.8, 0.9, 1.4, 1.7]) },
};

export const HOUR = 3600;
export const DAY = 24 * HOUR;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Fraction of capacity per hour, before per-bin busyness and noise. */
export function profileRate(district: DistrictKind, time: number): number {
  const p = PROFILES[district];
  const hour = Math.floor((time % DAY) / HOUR);
  const day = Math.floor(time / DAY) % 7;
  return (p.daily / 24) * p.hourly[hour] * p.weekday[day];
}

export function clockParts(time: number) {
  const day = Math.floor(time / DAY);
  const secs = time - day * DAY;
  const hour = Math.floor(secs / HOUR);
  const minute = Math.floor((secs % HOUR) / 60);
  return { day, weekday: WEEKDAYS[day % 7], hour, minute, hourFloat: secs / HOUR };
}

export function formatClock(time: number) {
  const c = clockParts(time);
  return `${c.weekday} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}
