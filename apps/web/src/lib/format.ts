const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const fmtInt = (n: number) => inr.format(Math.round(n));
export const fmtInr = (n: number) => `₹${inr.format(Math.round(n))}`;
export const fmtKm = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
export const fmtPct = (f: number, digits = 0) => `${(f * 100).toFixed(digits)}%`;

export function fmtHours(h: number | null) {
  if (h === null) return '> 3 days';
  if (h <= 0) return 'now';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function fmtAgo(seconds: number) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (h < 48) return `${h.toFixed(1)} h ago`;
  return `${(h / 24).toFixed(1)} days ago`;
}
