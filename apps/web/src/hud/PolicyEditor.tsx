import { customPolicyCode, installCustomPolicy, type ValidationReport } from '@binsight/core';
import { AlertTriangle, CheckCircle2, Code2, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../state/store.ts';
import type { CompareRequest } from '../workers/compare.worker.ts';
import { IconButton, Panel } from './ui.tsx';

const TEMPLATE = `// The body of select(ctx): return the ids of the bins to collect this shift.
//
// ctx.bins          unassigned bins: { id, reading (0–1.3), sensorOk, overflowing, battery, gas, temperature }
// ctx.sites[id]     { label, district, stream ('wet' | 'dry'), capacityL }
// ctx.forecast(id, t)  predicted fill at sim time t (seconds), from the bin's learned rhythm
// ctx.distance(a, b)   road distance between two bins, metres
// ctx.time, ctx.shift (0 morning, 1 evening), ctx.nextShiftStart, ctx.shiftHours

const nextVisit = ctx.nextShiftStart + 3 * 3600;
return ctx.bins
  .filter((b) => !b.sensorOk || b.reading > 0.85 || ctx.forecast(b.id, nextVisit) > 1)
  .map((b) => b.id);
`;

const EXAMPLES: { name: string; code: string }[] = [
  { name: 'Template', code: TEMPLATE },
  {
    name: 'Markets first',
    code: `// Markets every shift; everything else only when nearly full.
return ctx.bins
  .filter((b) => ctx.sites[b.id].district === 'market' ? b.reading > 0.3 : b.reading > 0.8)
  .map((b) => b.id);
`,
  },
  {
    name: 'Wet waste rots',
    code: `// Wet bins go at 60% (they smell and attract animals), dry bins can wait to 90%.
return ctx.bins
  .filter((b) => b.reading > (ctx.sites[b.id].stream === 'wet' ? 0.6 : 0.9))
  .map((b) => b.id);
`,
  },
  {
    name: 'Lazy (bad on purpose)',
    code: `// Only collect bins that are already overflowing. Watch the litter meter.
return ctx.bins.filter((b) => b.overflowing).map((b) => b.id);
`,
  },
];

export function PolicyEditor() {
  const open = useApp((s) => s.editorOpen);
  if (!open) return null;
  return <Editor />;
}

function Editor() {
  const { setEditorOpen, setPolicy, bump } = useApp.getState();
  const [code, setCode] = useState(customPolicyCode() ?? TEMPLATE);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = () => {
    setBusy(true);
    // The test run happens in a worker with a time limit, so a policy that never returns can't freeze the city.
    const worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    const done = (r: ValidationReport) => {
      window.clearTimeout(timer);
      worker.terminate();
      setReport(r);
      setBusy(false);
      if (r.ok && installCustomPolicy(code).ok) {
        setPolicy('custom');
        bump();
      }
    };
    const timer = window.setTimeout(() => done({ ok: false, errors: ['Still running after 10 s: does it loop forever?'], warnings: [] }), 10_000);
    worker.onmessage = (e: MessageEvent<{ type: string; report: ValidationReport }>) => {
      if (e.data.type === 'validated') done(e.data.report);
    };
    worker.onerror = (e) => done({ ok: false, errors: [e.message], warnings: [] });
    worker.postMessage({ validate: code } satisfies CompareRequest);
  };

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
      <Panel className="flex max-h-full w-full max-w-[880px] flex-col overflow-hidden">
        <div className="flex min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-3.5">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <Code2 size={12} /> Policy editor
              </div>
              <h2 className="text-lg font-bold">Write your own collection policy</h2>
              <p className="mt-0.5 text-[12px] text-slate-400">
                Validate runs it for three days on a hidden 48-bin city. Once it passes it joins the policy list and the Compare table.
              </p>
            </div>
            <IconButton onClick={() => setEditorOpen(false)} title="Close (Esc)">
              <X size={15} />
            </IconButton>
          </div>
          <div className="flex flex-wrap gap-1.5 px-5 pt-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                onClick={() => {
                  setCode(ex.code);
                  setReport(null);
                }}
                className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-white/10 hover:bg-white/10"
              >
                {ex.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 px-5 py-3">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              style={{ fontVariantLigatures: 'none' }}
              className="scroll-thin h-[300px] w-full resize-none rounded-xl bg-black/50 p-3 font-mono text-[12.5px] leading-relaxed text-slate-100 ring-1 ring-white/10 outline-none focus:ring-neon/50"
            />
            <p className="mt-1.5 text-[10.5px] text-slate-500">
              The code runs in this tab with full access to the page, like anything pasted into the browser console, so only use code you trust. It is never uploaded and
              disappears when the tab closes.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-3 border-t border-white/5 px-5 py-3">
            <button
              onClick={validate}
              disabled={busy}
              className="rounded-xl bg-gradient-to-r from-teal-400 to-lime-400 px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-60"
            >
              {busy ? 'Testing…' : 'Validate & activate'}
            </button>
            <div className="min-w-0 flex-1 text-[12px]">
              {report?.errors.map((e) => (
                <div key={e} className="flex items-start gap-1.5 text-rose-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {e}
                </div>
              ))}
              {report?.ok && (
                <div className="flex items-start gap-1.5 text-emerald-300">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> Active. It runs from the next shift, and Compare now has a Custom row.
                </div>
              )}
              {report?.warnings.map((w) => (
                <div key={w} className="mt-1 flex items-start gap-1.5 text-amber">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
              {report?.custom && report.baseline && (
                <table className="mt-2 text-[11.5px]">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="pr-4 text-left font-normal">Test city, 3 days</th>
                      <th className="pr-4 text-right font-normal">Distance</th>
                      <th className="pr-4 text-right font-normal">Pickups</th>
                      <th className="pr-4 text-right font-normal">Wasted</th>
                      <th className="text-right font-normal">Litter</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {[
                      ['Your policy', report.custom],
                      ['Predictive', report.baseline],
                    ].map(([name, row]) => {
                      const r = row as NonNullable<ValidationReport['custom']>;
                      return (
                        <tr key={name as string}>
                          <td className="pr-4 font-sans text-slate-300">{name as string}</td>
                          <td className="pr-4 text-right">{km(r.metrics.distanceM)}</td>
                          <td className="pr-4 text-right">{r.metrics.visits}</td>
                          <td className="pr-4 text-right">{r.metrics.wastedVisits}</td>
                          <td className="text-right">{r.metrics.overflowBinHours.toFixed(0)} bin-h</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
