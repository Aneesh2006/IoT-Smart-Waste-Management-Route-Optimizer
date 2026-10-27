import { BookOpen, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../state/store.ts';
import { IconButton, Panel } from './ui.tsx';

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 text-[15px] font-bold text-neon first:mt-0">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{children}</p>;
}

function Try({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-300">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-neon" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

const K = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-100 ring-1 ring-white/15">{children}</kbd>
);

export function GuideModal() {
  const open = useApp((s) => s.guideOpen);
  const costs = useApp((s) => s.sim.config.costs);
  if (!open) return null;
  const close = () => useApp.getState().setGuideOpen(false);
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={close}>
      <Panel className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden">
        <div className="flex min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 py-4">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <BookOpen size={12} /> Guide
              </div>
              <h2 className="text-xl font-bold">How BinSight works</h2>
            </div>
            <IconButton onClick={close} title="Close (Esc)">
              <X size={15} />
            </IconButton>
          </div>
          <div className="scroll-thin min-h-0 overflow-y-auto px-6 py-4">
            <H>Getting started</H>
            <P>
              This is a digital twin of a small city’s waste network: a seeded street grid, smart bins on the kerb, and a fleet of compactor trucks. Press play, pick a
              speed, and watch the bins fill. At 06:00 and 15:00 a shift starts: the chosen policy decides which bins to empty and the route optimizer decides how.
            </P>
            <Try
              items={[
                <>Click any bin pillar to inspect it, or a truck to follow it with the camera.</>,
                <>
                  Press <K>V</K> for data view: the buildings turn to glass so only bins and routes remain.
                </>,
                <>
                  Press <K>N</K> to skip to the next shift and see the plan land on the map.
                </>,
              ]}
            />

            <H>Reading the scene</H>
            <P>
              Each glowing pillar is a bin; its height is the fill level and its colour runs green → yellow → red. A red beam means the bin is overflowing onto the
              pavement. The ring at its foot marks wet (green) or dry (blue) waste. Dashed ribbons are each truck’s planned route; a grey pillar has a dead sensor. Windows
              light up after dusk, street lamps come on, and the sun moves with the clock.
            </P>

            <H>Policies: who decides which bins</H>
            <P>
              <b>Fixed schedule</b> is how most cities work today: every bin, every morning, no sensors. <b>Threshold</b> empties whatever reads above a set level.{' '}
              <b>Predictive</b> learns each bin’s daily rhythm from its own readings (open a bin to see the learned bars) and collects it if it would overflow before the
              next crew arrives. <b>Dynamic</b> is Predictive plus an hourly re-plan that sends idle trucks to bins about to spill.
            </P>

            <H>The four ≠ on screen</H>
            <Try
              items={[
                <>
                  <b>Collected ≠ efficient.</b> The wasted-visits meter counts pickups of bins under {Math.round(costs.wastedBelow * 100)}% full. Fixed schedules burn a lot of
                  diesel on near-empty bins.
                </>,
                <>
                  <b>Full ≠ urgent.</b> A 60% market bin at 5 pm overflows before a 90% bin in a quiet lane. Threshold policies get this wrong; Predictive doesn’t.
                </>,
                <>
                  <b>Short ≠ optimal.</b> In the Algorithm lab every heuristic is scored against the exact Held–Karp optimum. Nearest neighbour is often 10–20% worse.
                </>,
                <>
                  <b>Forecast ≠ reality.</b> Predictive is only as good as its history. Trigger a festival and watch Dynamic recover what Predictive misses.
                </>,
              ]}
            />

            <H>Things worth trying</H>
            <Try
              items={[
                <>
                  Press <K>C</K> to compare all four policies over the same seeded week. Every row runs from cold on a copy of this city; the live simulation is untouched.
                </>,
                <>In Compare, pick “Festival night on Wednesday”. Predictive and Dynamic part ways: the hourly re-plan is worth several hundred bin-hours of litter.</>,
                <>Switch to Fixed, skip to 06:00, then hit Monsoon flooding. Every truck that was driving re-routes around the water; open a truck to see its new distance.</>,
                <>Break a truck mid-shift under Dynamic, then again under Predictive. Only one of them sends someone for the orphaned bins.</>,
                <>Kill the sensors and open one of the grey bins. The planner now sees a frozen reading, so every policy has to collect it blind.</>,
                <>
                  Open the Algorithm lab (<K>L</K>), press Run all, then watch 2-opt untangle a random tour and the ants lay pheromone. Raise the bin count past 12 and the
                  exact solver bows out, which is the whole reason heuristics exist.
                </>,
                <>Change the seed (dice button) for a new city. The same seed always rebuilds the same city and replays the same waste, so results are reproducible.</>,
              ]}
            />

            <H>More views</H>
            <Try
              items={[
                <>
                  <b>Cloud X-Ray</b> (<K>X</K>): every batch of readings flies through the ingest function, MongoDB Atlas and Ably with each hop timed, plus what the pipeline would
                  cost for a real city.
                </>,
                <>
                  <b>Heatmap</b> (<K>G</K>): where bins are full now, where they overflowed longest, or where waste is made. <b>Replay</b> (<K>R</K>) plays the last day back as a
                  time-lapse.
                </>,
                <>
                  <b>Impact</b> (<K>I</K>): where the waste goes (compost, recycling, landfill), what each truck did all day, and a capacity planner that tests bigger bins
                  before anyone buys them.
                </>,
                <>
                  <b>Bin inspector</b>: the Inside tab shows the sensor hardware, the Wire tab the exact message it sends. <b>Truck inspector</b> opens the crew app
                  (/driver).
                </>,
                <>
                  <b>Search</b> (<K>/</K>): jump to any bin or truck by name. <b>Results report</b> prints a PDF for the submission. <b>Present</b> (<K>P</K>) runs the
                  scripted demo.
                </>,
              ]}
            />

            <H>Live in the cloud</H>
            <P>
              Switch to <b>Live</b> once it is deployed on Vercel: the cloud replays the city as requests come in and reports every bin to the ingest function, and every
              pillar you see has travelled a Vercel function → MongoDB Atlas → Ably → back to the browser. Phones join at <b>/bin</b> by scanning the QR code; operators
              sign in with the operator password to start the fleet, change speed, pause ingest or reset the city.
            </P>

            <H>Assumptions</H>
            <P>
              Diesel ₹{costs.dieselInrPerL}/L at {costs.fuelLPerKm} L/km, {costs.co2KgPerL} kg CO₂ per litre, crew ₹{costs.crewInrPerHour}/h, {costs.serviceSeconds} s to empty a
              bin and {Math.round(costs.unloadSeconds / 60)} min to tip at the transfer station. Waste generation follows per-district daily and weekly curves with noise. These
              are teaching numbers, set in one file, not measurements.
            </P>

            <H>Keys</H>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] text-slate-300">
              <span>
                <K>Space</K> play / pause
              </span>
              <span>
                <K>1</K>–<K>5</K> speed
              </span>
              <span>
                <K>N</K> next shift
              </span>
              <span>
                <K>V</K> data view
              </span>
              <span>
                <K>C</K> compare policies
              </span>
              <span>
                <K>L</K> algorithm lab
              </span>
              <span>
                <K>X</K> cloud X-Ray
              </span>
              <span>
                <K>G</K> heatmap
              </span>
              <span>
                <K>R</K> replay
              </span>
              <span>
                <K>I</K> impact
              </span>
              <span>
                <K>P</K> present (→ / ← / Esc)
              </span>
              <span>
                <K>/</K> or <K>Ctrl K</K> search anything
              </span>
              <span>
                <K>?</K> this guide
              </span>
              <span>
                <K>Esc</K> close / deselect
              </span>
            </div>
            <div className="h-4" />
          </div>
        </div>
      </Panel>
    </div>
  );
}
