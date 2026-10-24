import { Color } from 'three';

const NIGHT = new Color('#060a16');
const DUSK = new Color('#f08a5d');
const DAY = new Color('#9dc0e0');
const SUN_DAY = new Color('#fff4e0');
const SUN_DUSK = new Color('#ffb36b');
const MOON = new Color('#7f9cff');

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Lighting {
  /** 0 at night, 1 at noon. */
  daylight: number;
  /** 1 when lights should be fully on. */
  night: number;
  sky: Color;
  sunColor: Color;
  /** Unit vector toward the sun (or moon at night). */
  sunDir: [number, number, number];
}

/** Lighting for an hour of the day (fractional, 0–24). Allocation-free with `out`. */
export function lightingAt(hour: number, out?: Lighting): Lighting {
  const res = out ?? { daylight: 0, night: 1, sky: new Color(), sunColor: new Color(), sunDir: [0, 1, 0] };
  const angle = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.sin(angle);
  const daylight = smooth(-0.12, 0.35, elevation);
  const dusk = 1 - smooth(0, 0.45, Math.abs(elevation - 0.05));
  res.daylight = daylight;
  res.night = 1 - smooth(-0.15, 0.12, elevation);
  res.sky.copy(NIGHT).lerp(DAY, daylight).lerp(DUSK, dusk * 0.35);
  res.sunColor.copy(SUN_DAY).lerp(SUN_DUSK, dusk).lerp(MOON, res.night);
  const az = angle;
  const el = Math.max(0.25, elevation);
  res.sunDir = [Math.cos(az) * 0.8, el, 0.45];
  return res;
}
