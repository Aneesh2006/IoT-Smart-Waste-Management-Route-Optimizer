import { topics, type BinSite, type BinState, type Telemetry } from '@binsight/core';
import { fillCss } from '../lib/colors.ts';
import { Section } from './ui.tsx';

/** Physical bin height the ultrasonic sensor measures down into, by capacity. */
const heightCm = (capacityL: number) => (capacityL >= 1000 ? 130 : capacityL >= 600 ? 110 : 95);

/** An annotated cut-away of the smart bin, with each sensor's live value. */
export function BinAnatomy({ site, st }: { site: BinSite; st: BinState }) {
  const H = heightCm(site.capacityL);
  const fill = Math.min(1, Math.max(0, st.reading));
  const distance = Math.round(H * (1 - fill));
  const color = fillCss(st.reading);
  const parts = [
    { y: 34, label: 'Ultrasonic sensor', detail: `JSN-SR04T · echo ${distance} cm → ${Math.round(fill * 100)}% full`, color: '#5eead4' },
    { y: 64, label: 'ESP32 + NB-IoT radio', detail: 'samples every 15 min · MQTT over TLS', color: '#a3e635' },
    { y: 94, label: 'Gas sensor', detail: `MQ-135 · ${Math.round(st.gas)} ppm${st.gas > 400 ? ' (rotting)' : ''}`, color: '#fbbf24' },
    { y: 124, label: 'Temperature', detail: `DS18B20 · ${st.temperature.toFixed(1)} °C${st.temperature > 60 ? ' FIRE' : ''}`, color: st.temperature > 60 ? '#f97316' : '#60a5fa' },
    { y: 154, label: 'Battery + solar lid', detail: `${Math.round(st.battery)}% · ${st.sensorOk ? 'online' : 'offline'}`, color: st.sensorOk ? '#94a3b8' : '#f87171' },
  ];
  return (
    <Section title="Inside the smart bin">
      <svg viewBox="0 0 300 190" className="w-full">
        {/* the bin */}
        <path d="M18 26h76l-7 150a6 6 0 0 1-6 5H31a6 6 0 0 1-6-5z" fill="rgba(255,255,255,0.04)" stroke="rgba(226,232,240,0.45)" strokeWidth="1.5" />
        <clipPath id="bin-cut">
          <path d="M18 26h76l-7 150a6 6 0 0 1-6 5H31a6 6 0 0 1-6-5z" />
        </clipPath>
        <rect x="0" y={181 - fill * 152} width="120" height="200" fill={color} opacity="0.7" clipPath="url(#bin-cut)" />
        <rect x="12" y="18" width="88" height="8" rx="3" fill="rgba(226,232,240,0.6)" />
        {/* sonar ping */}
        <line x1="56" y1="30" x2="56" y2={181 - fill * 152} stroke="#5eead4" strokeWidth="1.5" strokeDasharray="3 3" />
        <text x="60" y={(30 + 181 - fill * 152) / 2} className="fill-teal-200 font-mono text-[9px]">
          {distance} cm
        </text>
        {/* components */}
        <rect x="48" y="27" width="16" height="6" rx="1.5" fill="#5eead4" />
        <rect x="72" y="58" width="14" height="10" rx="2" fill="#a3e635" />
        <circle cx="30" cy="94" r="5" fill="#fbbf24" />
        <circle cx="80" cy="124" r="4" fill={parts[3].color} />
        <rect x="34" y="150" width="22" height="9" rx="2" fill={parts[4].color} />
        {parts.map((p, i) => {
          const anchors = [
            [64, 30],
            [86, 63],
            [35, 94],
            [84, 124],
            [56, 154],
          ][i];
          return (
            <g key={p.label}>
              <path d={`M${anchors[0]},${anchors[1]} L112,${p.y} L122,${p.y}`} stroke={p.color} strokeOpacity="0.6" fill="none" />
              <circle cx={anchors[0]} cy={anchors[1]} r="1.8" fill={p.color} />
              <text x="126" y={p.y - 2} className="fill-slate-100 text-[10.5px] font-semibold">
                {p.label}
              </text>
              <text x="126" y={p.y + 10} className="fill-slate-400 text-[9px]">
                {p.detail}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10.5px] leading-snug text-slate-500">
        Fill = 1 − echo distance ÷ bin height ({H} cm). A reference design for the build; in Sandbox the readings come from the simulator, in Live from the device over MQTT.
      </p>
    </Section>
  );
}

/** The exact topic and JSON this bin publishes to AWS IoT Core. */
export function BinMqtt({ site, st, city }: { site: BinSite; st: BinState; city: string }) {
  const payload: Telemetry = {
    id: String(site.id),
    kind: 'fleet',
    r: Math.round(st.reading * 1000) / 1000,
    ok: st.sensorOk,
    temp: Math.round(st.temperature * 10) / 10,
    gas: Math.round(st.gas),
    bat: Math.round(st.battery),
    tDevice: Date.now(),
    simT: st.readingAt,
  };
  const json = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  return (
    <Section title="On the wire">
      <div className="space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Topic</span>
          <code className="truncate font-mono text-teal-200">{topics.telemetry(city, String(site.id))}</code>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Protocol</span>
          <span className="font-mono text-slate-300">MQTT 3.1.1 · QoS 0 · TLS 1.2</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Size</span>
          <span className="font-mono text-slate-300">{bytes} bytes (billed as 1 message)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">IoT rule</span>
          <span className="font-mono text-slate-300">adds city, binId, tRule → SQS</span>
        </div>
      </div>
      <pre className="scroll-thin mt-2 max-h-48 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-slate-200 ring-1 ring-white/10">{json}</pre>
    </Section>
  );
}
