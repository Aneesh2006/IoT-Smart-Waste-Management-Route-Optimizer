/**
 * Tiny synthesised sound cues (Web Audio, no files). Browsers only allow audio
 * after a user gesture, so the context is created when sound is switched on.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function enableAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 1, slideTo?: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sounds = {
  /** Routes planned: a rising two-note chime. */
  plan() {
    tone(660, 0, 0.25, 'sine', 0.7);
    tone(990, 0.09, 0.35, 'sine', 0.6);
  },
  /** A bin spilled over: a soft low thud. */
  overflow() {
    tone(150, 0, 0.3, 'triangle', 0.9, 70);
  },
  /** Fire or chaos: a short two-tone siren. */
  alert() {
    for (let k = 0; k < 3; k++) {
      tone(880, k * 0.24, 0.12, 'square', 0.25);
      tone(660, k * 0.24 + 0.12, 0.12, 'square', 0.25);
    }
  },
  /** A truck tipped its load. */
  unload() {
    tone(220, 0, 0.18, 'sawtooth', 0.25, 110);
  },
  /** A phone joined the city. */
  join() {
    tone(523, 0, 0.15, 'sine', 0.6);
    tone(659, 0.08, 0.15, 'sine', 0.6);
    tone(784, 0.16, 0.3, 'sine', 0.6);
  },
};
