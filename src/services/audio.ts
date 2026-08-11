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

/** Volumen de la música. Bajo a propósito: acompaña, no compite con los SFX. */
const MUSIC_LEVEL = 0.13;

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
    musicGain?.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.6);
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

/* ────────────────────── música chiptune de fábrica ──────────────────────
 *
 * Secuenciador de 8 bits al estilo NES: pulso para la melodía, triangular
 * para el bajo y ruido para la percusión. Progresión Am–G–F–E, 4 compases
 * en bucle, tempo tranquilo y volumen bajo para que acompañe sin cansar.
 *
 * Se programa con "lookahead": un temporizador barato mira 150 ms por
 * delante y encola las notas en el reloj de WebAudio, que es el que da la
 * precisión rítmica. Así el ritmo no se descuadra aunque el navegador vaya
 * justo de frames.
 */

const BPM = 104;
const STEPS_PER_BAR = 16;
const BARS = 4;
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

// Notas en Hz. `null` = silencio.
const N: Record<string, number> = {
  E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
  B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.26,
};

/** Melodía: 4 compases de 16 pasos. */
const LEAD: (number | null)[] = [
  // Am
  N.A4, null, null, N.E4, null, N.A4, null, null, N.C5, null, N.B4, null, N.A4, null, null, null,
  // G
  N.G4, null, null, N.D4, null, N.G4, null, null, N.B4, null, N.A4, null, N.G4, null, null, null,
  // F
  N.F4, null, null, N.C4, null, N.F4, null, null, N.A4, null, N.G4, null, N.F4, null, null, null,
  // E
  N.E4, null, null, N.B3, null, N.E4, null, null, N.G4, null, N.F4, null, N.E4, null, N.D4, null,
];

/** Bajo: raíz del acorde en corcheas. */
const BASS_ROOT = [N.A3 / 2, N.G3 / 2, N.F3 / 2, N.E3 / 2];

function pulse(freq: number, at: number, dur: number, gain: number, duty: 'square' | 'triangle') {
  const c = ctx!;
  const osc = c.createOscillator();
  osc.type = duty;
  osc.frequency.setValueAtTime(freq, at);
  const g = c.createGain();
  // Envolvente corta y seca: el "click" característico del chip.
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.setValueAtTime(gain, at + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(musicGain!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

let sharedNoise: AudioBuffer | null = null;
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (sharedNoise) return sharedNoise;
  const len = Math.floor(c.sampleRate * 0.25);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  sharedNoise = buf;
  return buf;
}

function drum(at: number, kind: 'kick' | 'hat') {
  const c = ctx!;
  if (kind === 'kick') {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.11);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    osc.connect(g).connect(musicGain!);
    osc.start(at);
    osc.stop(at + 0.15);
    return;
  }
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.09, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
  src.connect(hp).connect(g).connect(musicGain!);
  src.start(at);
  src.stop(at + 0.06);
}

function startMusic(): void {
  const c = ensureContext();
  if (!c || !musicGain) return;

  const stepDur = 60 / BPM / 4; // semicorchea
  let step = 0;
  let nextTime = c.currentTime + 0.1;

  const scheduleStep = (i: number, at: number) => {
    const bar = Math.floor(i / STEPS_PER_BAR);
    const inBar = i % STEPS_PER_BAR;

    const lead = LEAD[i];
    if (lead) pulse(lead, at, stepDur * 1.7, 0.16, 'square');

    // Bajo en corcheas, con octava alta en el contratiempo.
    if (inBar % 4 === 0) {
      const root = BASS_ROOT[bar];
      const up = inBar === 8;
      pulse(up ? root * 1.5 : root, at, stepDur * 3.4, 0.3, 'triangle');
    }

    if (inBar === 0 || inBar === 8) drum(at, 'kick');
    if (inBar % 4 === 2) drum(at, 'hat');
  };

  const timer = window.setInterval(() => {
    if (!ctx || !musicGain) return;
    while (nextTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextTime);
      nextTime += stepDur;
      step = (step + 1) % TOTAL_STEPS;
    }
  }, 25);

  musicGain.gain.setTargetAtTime(musicEnabled ? MUSIC_LEVEL : 0, c.currentTime, 1.2);

  musicNodes = {
    stop: () => window.clearInterval(timer),
  };
}

export function stopMusic(): void {
  musicNodes?.stop();
  musicNodes = null;
}
