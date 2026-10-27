/** Factory presets and the saved-state shape for Continuum Mosaic. */

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function osc(wave, octave, semi, fine, level, pwm = 0.5) {
  return { wave, octave, semi, fine, level, pwm };
}

function env(a, d, s, r) {
  return { a, d, s, r };
}

function layer(partial) {
  const base = {
    enabled: true,
    level: 0.82,
    character: 0,
    fmMode: 'off',
    pdDepth: 0.35,
    pdCurve: 'bend',
    fmRatio: 2,
    fmIndex: 1.4,
    osc: [
      osc('saw', 0, 0, 0, 0.78, 0.5),
      osc('square', -1, 0, 6, 0.22, 0.5),
      osc('sine', 0, 0, 0, 0, 0.5)
    ],
    filter: { type: 'lowpass', cutoff: 1600, res: 0.18, comb: 0.55, env: 0.42, lfo: 0, key: 0.15 },
    amp: env(0.01, 0.24, 0.72, 0.32),
    filt: env(0.008, 0.28, 0.22, 0.3)
  };
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    osc: partial.osc || base.osc,
    filter: { ...base.filter, ...(partial.filter || {}) },
    amp: { ...base.amp, ...(partial.amp || {}) },
    filt: { ...base.filt, ...(partial.filt || {}) }
  };
}

function steps(n = 16) {
  const list = [];
  for (let i = 0; i < 16; i++) {
    list.push({ on: false, note: 60, vel: 100, accent: false, slide: false });
  }
  return list.slice(0, 16).map((step, i) => ({ ...step, ...(n[i] || {}) }));
}

export function defaultState() {
  return {
    name: 'Init',
    master: 0.78,
    bendRange: 2,
    polyphony: 8,
    glide: 0,
    unison: 1,
    detune: 10,
    lfo: [
      { wave: 'sine', rate: 0.35, retrig: false },
      { wave: 'triangle', rate: 4.5, retrig: false }
    ],
    mod: [
      { src: 'wheel', dest: 'cutoff', amount: 0.35, target: 'both' },
      { src: 'vel', dest: 'cutoff', amount: 0.18, target: 'both' },
      { src: 'lfo2', dest: 'pitch', amount: 0, target: 'both' },
      { src: 'lfo1', dest: 'pwm', amount: 0, target: 'A' },
      { src: 'amp', dest: 'fm', amount: 0, target: 'both' },
      { src: 'lfo2', dest: 'cutoff', amount: 0, target: 'both' },
      { src: 'key', dest: 'cutoff', amount: 0, target: 'both' },
      { src: 'filter', dest: 'pitch', amount: 0, target: 'A' }
    ],
    layers: {
      A: layer(),
      B: layer({
        enabled: false,
        level: 0.55,
        osc: [
          osc('triangle', 0, 0, -4, 0.6, 0.5),
          osc('sine', -1, 0, 0, 0.28, 0.5),
          osc('saw', 1, 0, 8, 0, 0.5)
        ],
        filter: { cutoff: 2200, res: 0.12, env: 0.2 },
        amp: env(0.18, 0.4, 0.8, 0.7)
      })
    },
    fx: {
      drive: 0,
      phaserOn: false,
      phaserWet: 0.28,
      phaserRate: 0.22,
      phaserDepth: 0.45,
      delaySync: 'free',
      delayTime: 0.32,
      delayFb: 0.32,
      delayWet: 0,
      multiOn: false,
      multiTime: 0.31,
      multiFb: 0.34,
      multiWet: 0,
      reverbWet: 0.12,
      reverbDecay: 2.1,
      shimmerOn: false,
      shimmerLevel: 0.12,
      shimmerPitch: 196,
      shimmerMotion: 0.28,
      compOn: false,
      compThreshold: -18,
      compRatio: 3,
      compAttack: 0.01,
      compRelease: 0.18
    },
    seq: {
      bpm: 120,
      swing: 0,
      length: 16,
      division: 0.25,
      target: 'A',
      gateOn: false,
      gateDepth: 0.85,
      gates: Array.from({ length: 16 }, () => true),
      steps: steps()
    }
  };
}

function acidSteps() {
  const notes = [0, 0, 12, 12, 0, 3, 7, 7, 0, 0, 12, 10, 7, 3, 1, 0];
  const on = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1];
  const accent = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const slide = [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  return notes.map((n, i) => ({
    on: !!on[i],
    note: 36 + n,
    vel: accent[i] ? 120 : 88,
    accent: !!accent[i],
    slide: !!slide[i]
  }));
}

function preset(name, edit) {
  const state = defaultState();
  state.name = name;
  edit(state);
  return state;
}

export const FACTORY = [
  preset('Init', () => {}),
  preset('Continuum Pad', (s) => {
    s.unison = 2;
    s.detune = 14;
    s.polyphony = 8;
    s.lfo[0].rate = 0.12;
    s.lfo[0].wave = 'sine';
    s.layers.A.level = 0.7;
    s.layers.A.osc = [
      osc('saw', 0, 0, -6, 0.62),
      osc('saw', 0, 0, 8, 0.48),
      osc('triangle', -1, 0, 0, 0.16)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 1800, res: 0.14, comb: 0.4, env: 0.22, lfo: 0.28, key: 0.25 };
    s.layers.A.amp = env(0.7, 0.8, 0.86, 1.5);
    s.layers.A.filt = env(0.4, 0.9, 0.45, 1.2);
    s.layers.B.enabled = true;
    s.layers.B.level = 0.42;
    s.layers.B.osc = [
      osc('triangle', 0, 0, 3, 0.55),
      osc('sine', -1, 0, 0, 0.34),
      osc('sine', 1, 0, 0, 0.08)
    ];
    s.layers.B.filter = { type: 'lowpass', cutoff: 2400, res: 0.1, comb: 0.3, env: 0.12, lfo: 0.16, key: 0.2 };
    s.layers.B.amp = env(1.05, 0.7, 0.9, 1.8);
    s.layers.B.filt = env(0.6, 1, 0.4, 1.4);
    s.fx.reverbWet = 0.38;
    s.fx.reverbDecay = 4.4;
    s.fx.delaySync = '1/8';
    s.fx.delayWet = 0.1;
    s.fx.delayFb = 0.22;
  }),
  preset('Acid Line', (s) => {
    s.polyphony = 1;
    s.glide = 0.07;
    s.layers.A.level = 0.9;
    s.layers.A.osc = [
      osc('saw', 0, 0, 0, 0.9),
      osc('square', 0, 0, 0, 0, 0.5),
      osc('sine', -1, 0, 0, 0.12)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 240, res: 0.82, comb: 0.5, env: 0.86, lfo: 0, key: 0.05 };
    s.layers.A.amp = env(0.004, 0.16, 0, 0.06);
    s.layers.A.filt = env(0.004, 0.2, 0.05, 0.08);
    s.layers.B.enabled = false;
    s.fx.drive = 0.46;
    s.fx.reverbWet = 0.06;
    s.fx.delaySync = '1/8';
    s.fx.delayWet = 0.16;
    s.fx.delayFb = 0.28;
    s.mod[1].amount = 0.28;
    s.seq.bpm = 132;
    s.seq.division = 0.25;
    s.seq.swing = 0.08;
    s.seq.target = 'A';
    s.seq.steps = acidSteps();
  }),
  preset('Supersaw Lead', (s) => {
    s.unison = 4;
    s.detune = 18;
    s.polyphony = 6;
    s.layers.A.osc = [
      osc('saw', 0, 0, 0, 0.8),
      osc('saw', 0, 0, 7, 0.34),
      osc('square', -1, 0, 0, 0.12, 0.4)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 1400, res: 0.22, comb: 0.4, env: 0.58, lfo: 0.08, key: 0.35 };
    s.layers.A.amp = env(0.006, 0.22, 0.62, 0.22);
    s.layers.A.filt = env(0.004, 0.26, 0.18, 0.2);
    s.layers.B.enabled = false;
    s.fx.delaySync = '1/8d';
    s.fx.delayWet = 0.2;
    s.fx.delayFb = 0.3;
    s.fx.reverbWet = 0.16;
    s.fx.phaserOn = true;
    s.fx.phaserWet = 0.16;
    s.fx.phaserRate = 0.18;
  }),
  preset('Glass FM', (s) => {
    s.polyphony = 8;
    s.layers.A.fmMode = 'fm';
    s.layers.A.fmRatio = 2.0;
    s.layers.A.fmIndex = 2.3;
    s.layers.A.osc = [
      osc('sine', 0, 0, 0, 0.75),
      osc('sine', 1, 0, 0, 0.08),
      osc('sine', 0, 7, 0, 0)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 6400, res: 0.08, comb: 0.2, env: 0.15, lfo: 0, key: 0.4 };
    s.layers.A.amp = env(0.004, 0.45, 0, 0.28);
    s.layers.A.filt = env(0.004, 0.3, 0, 0.2);
    s.mod[4].amount = 0.35;
    s.layers.B.enabled = false;
    s.fx.reverbWet = 0.34;
    s.fx.reverbDecay = 3.4;
  }),
  preset('PWM Keys', (s) => {
    s.layers.A.osc = [
      osc('square', 0, 0, 0, 0.72, 0.32),
      osc('square', -1, 0, 4, 0.22, 0.55),
      osc('sine', -1, 0, 0, 0.16)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 2200, res: 0.16, comb: 0.3, env: 0.34, lfo: 0, key: 0.45 };
    s.layers.A.amp = env(0.004, 0.38, 0.35, 0.32);
    s.layers.A.filt = env(0.004, 0.22, 0.1, 0.25);
    s.lfo[1].wave = 'triangle';
    s.lfo[1].rate = 5.2;
    s.mod[3] = { src: 'lfo2', dest: 'pwm', amount: 0.72, target: 'A' };
    s.layers.B.enabled = false;
    s.fx.reverbWet = 0.2;
    s.fx.phaserOn = true;
    s.fx.phaserWet = 0.12;
    s.fx.phaserRate = 0.15;
  }),
  preset('Dual Strings', (s) => {
    s.unison = 2;
    s.detune = 11;
    s.lfo[0].rate = 0.18;
    s.lfo[0].wave = 'sine';
    s.mod[2] = { src: 'lfo1', dest: 'pitch', amount: 0.025, target: 'both' };
    s.layers.A.osc = [
      osc('saw', 0, 0, -5, 0.55),
      osc('saw', 0, 0, 6, 0.42),
      osc('triangle', -1, 0, 0, 0.12)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 1500, res: 0.1, comb: 0.3, env: 0.16, lfo: 0.12, key: 0.3 };
    s.layers.A.amp = env(0.42, 0.5, 0.9, 1.1);
    s.layers.A.filt = env(0.3, 0.6, 0.5, 0.8);
    s.layers.A.level = 0.68;
    s.layers.B.enabled = true;
    s.layers.B.level = 0.4;
    s.layers.B.osc = [
      osc('triangle', 0, 0, 2, 0.6),
      osc('saw', 1, 0, -3, 0.18),
      osc('sine', -1, 0, 0, 0.2)
    ];
    s.layers.B.amp = env(0.75, 0.6, 0.92, 1.4);
    s.layers.B.filter = { type: 'lowpass', cutoff: 2600, res: 0.08, comb: 0.2, env: 0.1, lfo: 0.08, key: 0.2 };
    s.fx.reverbWet = 0.42;
    s.fx.reverbDecay = 3.8;
  }),
  preset('Comb Drift', (s) => {
    s.layers.A.character = 0.45;
    s.layers.A.osc = [
      osc('triangle', 0, 0, 0, 0.7),
      osc('sine', -1, 0, 0, 0.4),
      osc('saw', 0, 0, 4, 0.12)
    ];
    s.layers.A.filter = { type: 'comb', cutoff: 180, res: 0.2, comb: 0.78, env: 0.15, lfo: 0.2, key: 0.55 };
    s.layers.A.amp = env(0.12, 0.4, 0.75, 0.7);
    s.layers.A.filt = env(0.2, 0.5, 0.4, 0.6);
    s.lfo[0].rate = 0.08;
    s.layers.B.enabled = false;
    s.fx.delayTime = 0.42;
    s.fx.delayWet = 0.22;
    s.fx.delayFb = 0.38;
    s.fx.reverbWet = 0.28;
    s.fx.reverbDecay = 3.2;
  }),
  preset('Soft Bell', (s) => {
    s.layers.A.fmMode = 'both';
    s.layers.A.fmRatio = 3.5;
    s.layers.A.fmIndex = 1.55;
    s.layers.A.pdDepth = 0.22;
    s.layers.A.pdCurve = 'sine';
    s.layers.A.osc = [
      osc('sine', 0, 0, 0, 0.7),
      osc('sine', 0, 7, 0, 0.12),
      osc('triangle', 1, 0, 0, 0.08)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 5200, res: 0.1, comb: 0.2, env: 0.2, lfo: 0, key: 0.5 };
    s.layers.A.amp = env(0.003, 0.85, 0, 0.55);
    s.layers.A.filt = env(0.003, 0.4, 0, 0.3);
    s.layers.B.enabled = false;
    s.fx.reverbWet = 0.4;
    s.fx.reverbDecay = 4.2;
  }),
  preset('Night Air', (s) => {
    s.unison = 2;
    s.detune = 9;
    s.layers.A.character = 0.35;
    s.layers.A.level = 0.62;
    s.layers.A.osc = [
      osc('saw', 0, 0, -7, 0.4),
      osc('triangle', 0, 0, 5, 0.34),
      osc('sine', -2, 0, 0, 0.22)
    ];
    s.layers.A.filter = { type: 'lowpass', cutoff: 780, res: 0.2, comb: 0.4, env: 0.18, lfo: 0.22, key: 0.1 };
    s.layers.A.amp = env(1.2, 1.1, 0.8, 2.2);
    s.layers.A.filt = env(0.8, 1.2, 0.4, 1.6);
    s.layers.B.enabled = true;
    s.layers.B.level = 0.36;
    s.layers.B.character = 0.5;
    s.layers.B.osc = [
      osc('sine', 0, 0, 0, 0.45),
      osc('triangle', 1, 0, -6, 0.2),
      osc('sine', -1, 0, 0, 0.3)
    ];
    s.layers.B.amp = env(1.6, 0.8, 0.85, 2.4);
    s.layers.B.filter = { type: 'bandpass', cutoff: 640, res: 0.35, comb: 0.3, env: 0.1, lfo: 0.18, key: 0 };
    s.lfo[0].rate = 0.07;
    s.fx.reverbWet = 0.48;
    s.fx.reverbDecay = 5.2;
    s.fx.shimmerOn = true;
    s.fx.shimmerLevel = 0.16;
    s.fx.shimmerPitch = 146;
    s.fx.shimmerMotion = 0.45;
    s.fx.delaySync = '1/4';
    s.fx.delayWet = 0.12;
    s.fx.delayFb = 0.3;
  })
];

const STORAGE = 'continuum-mosaic-presets-v1';
const LAST = 'continuum-mosaic-last-preset';
const LAST_STATE = 'continuum-mosaic-last-state-v2';

export function loadUserPresets() {
  try {
    const raw = localStorage.getItem(STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

export function saveUserPresets(list) {
  localStorage.setItem(STORAGE, JSON.stringify(list));
}

export function loadLastId() {
  try {
    return localStorage.getItem(LAST) || 'factory:Init';
  } catch (err) {
    return 'factory:Init';
  }
}

export function saveLastId(id) {
  try {
    localStorage.setItem(LAST, id);
  } catch (err) {
    /* private mode */
  }
}

export function loadLastState() {
  try {
    const raw = localStorage.getItem(LAST_STATE);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

export function saveLastState(value) {
  try {
    localStorage.setItem(LAST_STATE, JSON.stringify(value));
  } catch (err) {
    /* private mode */
  }
}

function fill(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const key of Object.keys(base)) {
    const value = extra[key];
    if (value == null) continue;
    if (Array.isArray(base[key]) && Array.isArray(value)) base[key] = value;
    else if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) && typeof value === 'object') fill(base[key], value);
    else base[key] = value;
  }
  return base;
}

function repair(state) {
  const base = defaultState();
  state.lfo = [0, 1].map((i) => ({ ...base.lfo[i], ...(state.lfo && state.lfo[i] || {}) }));
  state.mod = Array.from({ length: 8 }, (_, i) => ({ ...base.mod[i], ...(state.mod && state.mod[i] || {}) }));
  ['A', 'B'].forEach((id) => {
    const layer = state.layers[id] || {};
    const fallback = base.layers[id];
    const oscs = layer.osc || [];
    state.layers[id] = {
      ...fallback,
      ...layer,
      osc: [0, 1, 2].map((i) => ({ ...fallback.osc[i], ...(oscs[i] || {}) })),
      filter: { ...fallback.filter, ...(layer.filter || {}) },
      amp: { ...fallback.amp, ...(layer.amp || {}) },
      filt: { ...fallback.filt, ...(layer.filt || {}) }
    };
  });
  const stepsIn = state.seq.steps || [];
  const gatesIn = state.seq.gates || [];
  state.seq.steps = Array.from({ length: 16 }, (_, i) => ({ ...base.seq.steps[i], ...(stepsIn[i] || {}) }));
  state.seq.gates = Array.from({ length: 16 }, (_, i) => gatesIn[i] !== false);
  state.seq.length = state.seq.length === 8 ? 8 : 16;
  return state;
}

export function normalize(partial) {
  const next = repair(fill(defaultState(), partial || {}));
  if (partial && partial.name) next.name = partial.name;
  return next;
}

export function recall(id, userPresets) {
  if (id.startsWith('factory:')) {
    const name = id.slice(8);
    const found = FACTORY.find((preset) => preset.name === name) || FACTORY[0];
    return normalize(clone(found));
  }
  const found = userPresets.find((preset) => preset.id === id);
  if (!found) return normalize(clone(FACTORY[0]));
  const next = normalize(clone(found.state));
  next.name = found.name || next.name;
  return next;
}
