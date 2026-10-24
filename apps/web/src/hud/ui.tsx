import type { ReactNode } from 'react';

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`glass rounded-2xl ${className}`}>{children}</div>;
}

export function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-white/5 px-4 py-3 first:border-t-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow" title={hint}>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/5">
      <div className="text-[10.5px] text-slate-400">{label}</div>
      <div className="tabular font-mono text-[15px] font-semibold leading-tight" style={{ color: accent }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/10">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1 rounded-md font-mono transition ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${
              active ? 'bg-neon/90 text-ink shadow-[0_0_14px_rgb(94_234_212/0.45)]' : 'text-slate-300 hover:bg-white/5'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function IconButton({
  onClick,
  title,
  children,
  active,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid size-8 place-items-center rounded-lg ring-1 transition ${
        active ? 'bg-neon/15 text-neon ring-neon/40' : 'bg-white/[0.04] text-slate-200 ring-white/10 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

export function Bar({ value, color, className = 'h-1.5' }: { value: number; color: string; className?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}
