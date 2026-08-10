/**
 * AUDIO PROCEDURAL — sin archivos externos.
 *
 * Todos los sonidos se sintetizan con WebAudio: cero peso de descarga, cero
 * problemas de licencias y control total del "game feel". Si más adelante se
 * quieren samples reales, basta sustituir `playSfx` manteniendo la interfaz.
 */

type SfxName =
  | 'coin'
  | 'pickup'
  | 'spend'
  | 'levelup'
  | 'mission'
  | 'factory'
  | 'error'
  | 'click'
  | 'machine';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicNodes: { stop: () => void } | null = null;
let muted = false;
let musicEnabled = true;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Debe llamarse desde un gesto del usuario (política de autoplay). */
export function unlockAudio(): void {
  ensureContext();
  if (musicEnabled && !musicNodes) startMusic();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master && ctx) {
    master.gain.setTargetAtTime(value ? 0 : 0.55, ctx.currentTime, 0.05);
  }
}

export function setMusicEnabled(value: boolean): void {
  musicEnabled = value;
  if (!ctx) return;
  if (value) {
    if (!musicNodes) startMusic();
    musicGain?.gain.setTargetAtTime(0.16, ctx.currentTime, 0.6);
  } else {
    musicGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }
}

function env(
  node: AudioNode,
  gain: GainNode,
  start: number,
  attack: number,
  decay: number,
  peak: number,
) {
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  node.connect(gain);
}

function tone(
  freq: number,
  type: OscillatorType,
  at: number,
  dur: number,
  peak: number,
  glideTo?: number,
) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  env(osc, g, at, Math.min(0.02, dur * 0.2), dur, peak);
  g.connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.06);
}

function noise(at: number, dur: number, peak: number, freq = 1400, q = 1) {
  const c = ctx!;
  const len = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, Math.max(1, len), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(at);
  src.stop(at + dur);
}

export function playSfx(name: SfxName, volume = 1): void {
  const c = ensureContext();
  if (!c || muted) return;
  const t = c.currentTime + 0.005;
  const v = volume;

  switch (name) {
    case 'coin':
      tone(880, 'square', t, 0.07, 0.16 * v);
      tone(1320, 'square', t + 0.055, 0.1, 0.14 * v);
      break;
    case 'pickup':
      tone(520, 'triangle', t, 0.09, 0.16 * v, 880);
      noise(t, 0.05, 0.06 * v, 2600, 2);
      break;
    case 'spend':
      tone(420, 'sawtooth', t, 0.12, 0.1 * v, 180);
      break;
    case 'levelup':
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 'triangle', t + i * 0.075, 0.2, 0.14 * v),
      );
      noise(t + 0.28, 0.3, 0.05 * v, 3200, 1.4);
      break;
    case 'mission':
      tone(784, 'sine', t, 0.16, 0.14 * v);
      tone(1175, 'sine', t + 0.1, 0.24, 0.12 * v);
      break;
    case 'factory':
      tone(110, 'sawtooth', t, 0.9, 0.16 * v, 440);
      tone(220, 'square', t + 0.12, 0.7, 0.09 * v, 660);
      noise(t, 0.8, 0.08 * v, 700, 0.7);
      break;
    case 'error':
      tone(180, 'square', t, 0.14, 0.13 * v, 110);
      break;
    case 'click':
      tone(1200, 'square', t, 0.035, 0.07 * v);
      break;
    case 'machine':
      noise(t, 0.18, 0.09 * v, 480, 1.2);
      tone(90, 'square', t, 0.16, 0.08 * v);
      break;
  }
}

/* ─────────────────────── música ambiente industrial ─────────────────────── */

function startMusic(): void {
  const c = ensureContext();
  if (!c || !musicGain) return;

  const drone = c.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.value = 55;
  const droneFilter = c.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 220;
  droneFilter.Q.value = 3;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.22;
  drone.connect(droneFilter).connect(droneGain).connect(musicGain);

  const pad = c.createOscillator();
  pad.type = 'triangle';
  pad.frequency.value = 110;
  const padGain = c.createGain();
  padGain.gain.value = 0.08;
  pad.connect(padGain).connect(musicGain);

  // LFO lento: da la sensación de maquinaria respirando.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(droneFilter.frequency);

  drone.start();
  pad.start();
  lfo.start();

  // Golpes rítmicos ocasionales de maquinaria.
  const clank = window.setInterval(() => {
    if (!ctx || muted || !musicEnabled) return;
    if (Math.random() < 0.45) noise(ctx.currentTime, 0.12, 0.03, 300 + Math.random() * 400, 1.6);
  }, 2400);

  musicGain.gain.setTargetAtTime(musicEnabled ? 0.16 : 0, c.currentTime, 1.2);

  musicNodes = {
    stop: () => {
      window.clearInterval(clank);
      drone.stop();
      pad.stop();
      lfo.stop();
    },
  };
}

export function stopMusic(): void {
  musicNodes?.stop();
  musicNodes = null;
}
