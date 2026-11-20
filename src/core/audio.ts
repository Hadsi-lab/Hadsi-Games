import type { NoiseOpts, Sfx, SfxName, ToneOpts } from './types';
import { getSettings } from './settings';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ensure(): AudioContext | null {
  if (!ac) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ac = new Ctor();
    master = ac.createGain();
    master.connect(ac.destination);
  }
  return ac;
}

/** Audio can only start after a user gesture. */
export function unlockAudio(): void {
  const a = ensure();
  if (a && a.state === 'suspended') void a.resume();
}

['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true }),
);

function ready(): AudioContext | null {
  const s = getSettings();
  if (!s.sound || s.volume <= 0) return null;
  const a = ensure();
  if (!a || a.state !== 'running' || !master) return null;
  master.gain.value = s.volume * 0.5;
  return a;
}

function tone({ freq, to, duration = 0.1, type = 'square', volume = 0.3, delay = 0 }: ToneOpts) {
  const a = ready();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise({ duration = 0.3, volume = 0.4, filter = 1200, delay = 0 }: NoiseOpts = {}) {
  const a = ready();
  if (!a || !master) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(filter, t0);
  lp.frequency.exponentialRampToValueAtTime(80, t0 + duration);
  const gain = a.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(lp).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

const presets: Record<SfxName, () => void> = {
  blip: () => tone({ freq: 660, duration: 0.05, volume: 0.15 }),
  select: () => tone({ freq: 520, to: 880, duration: 0.08, volume: 0.2 }),
  eat: () => tone({ freq: 440, to: 880, duration: 0.08, volume: 0.25 }),
  hit: () => tone({ freq: 220, to: 110, duration: 0.08, type: 'square', volume: 0.25 }),
  bounce: () => tone({ freq: 300, duration: 0.04, type: 'square', volume: 0.2 }),
  brick: () => tone({ freq: 760 + Math.random() * 120, duration: 0.05, type: 'square', volume: 0.18 }),
  shoot: () => tone({ freq: 900, to: 200, duration: 0.12, type: 'sawtooth', volume: 0.15 }),
  explode: () => noise({ duration: 0.45, volume: 0.5, filter: 1800 }),
  line: () => {
    tone({ freq: 523, duration: 0.08, volume: 0.2 });
    tone({ freq: 784, duration: 0.12, volume: 0.2, delay: 0.07 });
  },
  powerup: () => {
    [440, 554, 659, 880].forEach((f, i) => tone({ freq: f, duration: 0.07, volume: 0.18, type: 'triangle', delay: i * 0.05 }));
  },
  lose: () => tone({ freq: 400, to: 60, duration: 0.6, type: 'sawtooth', volume: 0.25 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.16, volume: 0.2, type: 'triangle', delay: i * 0.12 }));
  },
  levelup: () => {
    [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.1, volume: 0.18, delay: i * 0.08 }));
  },
  start: () => tone({ freq: 330, to: 990, duration: 0.18, type: 'triangle', volume: 0.25 }),
  pause: () => tone({ freq: 440, to: 220, duration: 0.1, type: 'triangle', volume: 0.2 }),
};

export const sfx: Sfx = {
  play: (name) => presets[name]?.(),
  tone,
  noise,
};
