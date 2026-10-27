import { Smartphone, Trophy } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { fillCss } from '../lib/colors.ts';
import { LiveWorld } from '../live/LiveWorld.ts';
import { useApp } from '../state/store.ts';
import { Section } from './ui.tsx';

/** QR code that turns a phone into a smart bin, plus the phones already in the city. */
export function JoinCard() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const [svg, setSvg] = useState('');
  const url = `${window.location.origin}/bin`;
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#e2e8f0', light: '#00000000' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [url]);

  if (!(sim instanceof LiveWorld)) return null;
  const phones = [...sim.phones.values()].sort((a, b) => b.score - a.score || b.r - a.r);

  return (
    <Section title="Join the city" right={<span className="font-mono text-[10px] text-slate-500">{phones.length} phones</span>}>
      <div className="flex gap-3">
        <div className="size-28 shrink-0 rounded-xl bg-white/[0.04] p-1.5 ring-1 ring-white/10" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="text-[11.5px] leading-snug text-slate-400">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-200">
            <Smartphone size={13} /> Your phone is a smart bin
          </div>
          Scan to join. Throw trash, sort it wet or dry, and watch your bin fill on this screen through the cloud.
          {local && <div className="mt-1 text-amber">Phones can't reach localhost: open the deployed Vercel URL on this screen first.</div>}
        </div>
      </div>
      {phones.length > 0 && (
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[10.5px] text-slate-500">
            <Trophy size={11} /> Best sorters
          </div>
          {phones.slice(0, 6).map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="w-5 text-center">{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{p.nick}</span>
              <span className="font-mono text-[10.5px] text-slate-400">{p.score} pts</span>
              <span className="w-9 text-right font-mono text-[10.5px]" style={{ color: fillCss(p.r) }}>
                {Math.round(p.r * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
