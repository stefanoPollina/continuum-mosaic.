'use strict';

/**
 * Polyphonic AudioWorklet voice for Continuum Mosaic.
 * Two layers stand in for the old engines A and B. Each voice has three
 * oscillators, a multimode filter (lowpass, highpass, bandpass, notch, comb),
 * amp and filter envelopes, FM / phase distortion, and a modulation matrix
 * in place of the modular patch bay.
 *
 * The render loop does not allocate.
 */

const MAX_VOICES = 20;
const TAU = Math.PI * 2;
const ENV_OCTAVES = 6;

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

function wrap01(x) {
  x -= Math.floor(x);
  return x < 0 ? x + 1 : x;
}

function mtof(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function resonanceQ(res) {
  const r = clamp(res, 0, 1);
  return 0.7 + r * r * 16;
}

function blep(t, dt) {
  if (dt <= 1e-6) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function oscSample(type, phase, dt, pwm) {
  if (type === 'sine') return Math.sin(TAU * phase);
  if (type === 'saw') return (2 * phase - 1) - blep(phase, dt);
  if (type === 'square') {
    const pw = pwm < 0.05 ? 0.05 : pwm > 0.95 ? 0.95 : pwm;
    let y = phase < pw ? 1 : -1;
    y += blep(phase, dt);
    let p2 = phase - pw;
    if (p2 < 0) p2 += 1;
    y -= blep(p2, dt);
    return y;
  }
  return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
}

function warpPhase(phase, depth, curve) {
  if (depth < 0.001) return phase;
  if (curve === 'sine') return wrap01(phase + depth * 0.45 * Math.sin(TAU * phase));
  if (curve === 'pulse') {
    const b = 0.5 - depth * 0.42;
    if (phase < b) return (phase / b) * 0.5;
    return 0.5 + ((phase - b) / (1 - b)) * 0.5;
  }
  return Math.pow(clamp(phase, 0, 1), 1 + depth * 4);
}

function lfoSample(wave, phase, hold) {
  if (wave === 'sine') return Math.sin(TAU * phase);
  if (wave === 'square') return phase < 0.5 ? 1 : -1;
  if (wave === 'saw') return 2 * phase - 1;
  if (wave === 'sample') return hold;
  if (phase < 0.25) return phase * 4;
  if (phase < 0.75) return 1 - (phase - 0.25) * 4;
  return -1 + (phase - 0.75) * 4;
}

function envCoef(seconds, sr) {
  const tau = Math.max(0.0004, seconds / 2.3);
  return 1 - Math.exp(-1 / (tau * sr));
}

function makeVoice() {
  const voice = {
    active: false,
    id: '',
    layer: 0,
    note: 60,
    vel: 0.8,
    gate: false,
    sustainHold: false,
    fading: false,
    hasPend: false,
    pendNote: 60,
    pendVel: 0.8,
    pendLayer: 0,
    pendGlide: 0,
    age: 0,
    freq: 440,
    target: 440,
    glide: 0,
    fc: 1000,
    amp: 0,
    fenv: 0,
    ampStage: 'idle',
    filtStage: 'idle',
    phase: new Float64Array(3),
    uni: new Float64Array(4),
    fmPhase: Math.random(),
    lfo: new Float64Array(2),
    sh: new Float64Array(2),
    drift: 0,
    driftPhase: Math.random() * 7,
    ic1: 0,
    ic2: 0,
    comb: new Float32Array(4096),
    combPos: 0,
    combDamp: 0,
    lastType: '',
    fg: 0,
    fa1: 0,
    fa2: 0,
    fa3: 0,
    fk: 1,
    ftick: 0
  };
  voice.lfo[0] = Math.random();
  voice.lfo[1] = Math.random();
  voice.sh[0] = Math.random() * 2 - 1;
  voice.sh[1] = Math.random() * 2 - 1;
  return voice;
}

function sourceValue(name, voice, l1, l2, wheel) {
  if (name === 'lfo1') return l1;
  if (name === 'lfo2') return l2;
  if (name === 'amp') return voice.amp;
  if (name === 'filter') return voice.fenv;
  if (name === 'vel') return voice.vel * 2 - 1;
  if (name === 'wheel') return wheel * 2 - 1;
  if (name === 'key') return (voice.note - 60) / 48;
  return 0;
}

class MosaicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = new Array(MAX_VOICES);
    for (let i = 0; i < MAX_VOICES; i++) this.voices[i] = makeVoice();
    this.ev = new Array(96);
    this.evCount = 0;
    this.due = new Array(96);
    this.state = null;
    this.bend = 0;
    this.bendTarget = 0;
    this.wheel = 0;
    this.wheelTarget = 0;
    this.sustain = false;
    this.dcInL = 0;
    this.dcOutL = 0;
    this.dcInR = 0;
    this.dcOutR = 0;
    this.scope = new Float32Array(160);
    this.scopePos = 0;
    this.scopeCopy = new Float32Array(160);
    this.blocks = 0;
    this.cpuMs = 0;
    this.cpuAudio = 0;
    this.activeCount = 0;
    this.envStage = 'idle';
    this.envValue = 0;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'state') {
      this.state = msg.state;
      return;
    }
    if (msg.type === 'panic') {
      this.evCount = 0;
      for (let i = 0; i < MAX_VOICES; i++) this.silence(this.voices[i]);
      this.bendTarget = 0;
      this.wheelTarget = 0;
      return;
    }
    if (this.evCount >= this.ev.length) this.evCount = this.ev.length - 1;
    this.ev[this.evCount++] = msg;
  }

  silence(voice) {
    voice.active = false;
    voice.gate = false;
    voice.fading = false;
    voice.hasPend = false;
    voice.sustainHold = false;
    voice.amp = 0;
    voice.fenv = 0;
    voice.ampStage = 'idle';
    voice.filtStage = 'idle';
    voice.id = '';
    voice.ic1 = 0;
    voice.ic2 = 0;
    voice.combDamp = 0;
  }

  findVoice(id) {
    for (let i = 0; i < MAX_VOICES; i++) {
      const voice = this.voices[i];
      if (voice.active && voice.id === id) return voice;
    }
    return null;
  }

  alloc() {
    let oldest = this.voices[0];
    let quiet = null;
    for (let i = 0; i < MAX_VOICES; i++) {
      const voice = this.voices[i];
      if (!voice.active) return voice;
      if (voice.age >= oldest.age) oldest = voice;
      if (voice.ampStage === 'release' || voice.ampStage === 'idle') {
        if (!quiet || voice.amp < quiet.amp) quiet = voice;
      }
    }
    return quiet || oldest;
  }

  arm(voice, note, vel, layer, glide, legato) {
    const prev = voice.freq;
    const was = voice.active && prev > 20;
    voice.active = true;
    voice.note = note;
    voice.vel = clamp(vel, 0.02, 1);
    voice.layer = layer;
    voice.gate = true;
    voice.sustainHold = false;
    voice.fading = false;
    voice.hasPend = false;
    voice.age = 0;
    voice.target = mtof(note);
    if ((legato || glide > 0) && was) {
      voice.freq = prev;
      voice.glide = glide;
    } else {
      voice.freq = voice.target;
      voice.glide = 0;
    }
    if (!legato) {
      voice.ampStage = 'attack';
      voice.filtStage = 'attack';
      voice.ic1 = 0;
      voice.ic2 = 0;
      voice.ftick = 0;
      const layerState = this.layerState(layer);
      voice.fc = layerState ? layerState.filter.cutoff : 1000;
      const lfos = this.state && this.state.lfo;
      if (lfos && lfos[0] && lfos[0].retrig) voice.lfo[0] = 0;
      if (lfos && lfos[1] && lfos[1].retrig) voice.lfo[1] = 0;
    }
  }

  queueRetrigger(voice, msg, layer) {
    voice.fading = true;
    voice.hasPend = true;
    voice.pendNote = msg.note | 0;
    voice.pendVel = (msg.vel || 100) / 127;
    voice.pendLayer = layer;
    voice.pendGlide = msg.glide || 0;
    voice.gate = true;
    voice.id = msg.id;
  }

  layerState(index) {
    if (!this.state || !this.state.layers) return null;
    return index === 1 ? this.state.layers.B : this.state.layers.A;
  }

  applyEvent(msg) {
    if (msg.type === 'bend') {
      this.bendTarget = clamp(msg.value || 0, -1, 1);
      return;
    }
    if (msg.type === 'mod') {
      this.wheelTarget = clamp(msg.value || 0, 0, 1);
      return;
    }
    if (msg.type === 'sustain') {
      this.sustain = !!msg.on;
      if (!this.sustain) {
        for (let i = 0; i < MAX_VOICES; i++) {
          const voice = this.voices[i];
          if (voice.sustainHold) {
            voice.sustainHold = false;
            voice.gate = false;
          }
        }
      }
      return;
    }
    if (msg.type === 'off') {
      const voice = this.findVoice(msg.id);
      if (!voice) return;
      if (voice.fading) voice.hasPend = false;
      if (this.sustain) voice.sustainHold = true;
      else voice.gate = false;
      return;
    }
    if (msg.type !== 'on') return;
    const layer = msg.layer === 'B' ? 1 : 0;
    const legato = !!msg.legato;
    let voice = this.findVoice(msg.id);
    if (!voice) {
      voice = this.alloc();
      if (voice.active && voice.amp > 0.03 && !legato) {
        this.queueRetrigger(voice, msg, layer);
        return;
      }
      voice.id = msg.id;
      this.arm(voice, msg.note | 0, (msg.vel || 100) / 127, layer, msg.glide || 0, false);
      return;
    }
    if (legato) {
      voice.id = msg.id;
      this.arm(voice, msg.note | 0, (msg.vel || 100) / 127, layer, msg.glide || 0, true);
      return;
    }
    if (voice.amp > 0.03) {
      this.queueRetrigger(voice, msg, layer);
      return;
    }
    voice.id = msg.id;
    this.arm(voice, msg.note | 0, (msg.vel || 100) / 127, layer, msg.glide || 0, false);
  }

  stepEnv(stage, value, p, gate, sr) {
    if (!gate && stage !== 'release' && stage !== 'idle') stage = 'release';
    if (stage === 'attack') {
      value += (1 - value) * envCoef(p.a, sr);
      if (value >= 0.999) {
        value = 1;
        stage = 'decay';
      }
    } else if (stage === 'decay') {
      value += (p.s - value) * envCoef(p.d, sr);
      if (Math.abs(value - p.s) < 0.002) {
        value = p.s;
        stage = 'sustain';
      }
    } else if (stage === 'sustain') {
      value += (p.s - value) * 0.02;
    } else if (stage === 'release') {
      value += (0 - value) * envCoef(p.r, sr);
      if (value < 0.0006) {
        value = 0;
        stage = 'idle';
      }
    }
    this.envStage = stage;
    this.envValue = value;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const Lch = out[0];
    const Rch = out[1] || Lch;
    const frames = Lch.length;
    const sr = sampleRate;
    const now = currentTime;
    const end = now + frames / sr;
    let mark = 0;
    if (globalThis.performance && performance.now) mark = performance.now();

    let dueCount = 0;
    let keep = 0;
    for (let i = 0; i < this.evCount; i++) {
      const ev = this.ev[i];
      if (!ev.time || ev.time <= end) this.due[dueCount++] = ev;
      else this.ev[keep++] = ev;
    }
    this.evCount = keep;
    for (let i = 1; i < dueCount; i++) {
      const item = this.due[i];
      let j = i - 1;
      while (j >= 0 && (this.due[j].time || 0) > (item.time || 0)) {
        this.due[j + 1] = this.due[j];
        j--;
      }
      this.due[j + 1] = item;
    }

    const state = this.state;
    let ei = 0;

    for (let i = 0; i < frames; i++) {
      const t = now + i / sr;
      while (ei < dueCount && (this.due[ei].time || 0) <= t) this.applyEvent(this.due[ei++]);
      this.bend += (this.bendTarget - this.bend) * 0.02;
      this.wheel += (this.wheelTarget - this.wheel) * 0.01;
      let busL = 0;
      let busR = 0;

      if (state && state.layers) {
        const bendMul = Math.pow(2, (this.bend * (state.bendRange || 2)) / 12);
        const lfos = state.lfo;
        const lfo0 = lfos && lfos[0] ? lfos[0] : null;
        const lfo1 = lfos && lfos[1] ? lfos[1] : null;
        const wave0 = lfo0 && lfo0.wave ? lfo0.wave : 'sine';
        const wave1 = lfo1 && lfo1.wave ? lfo1.wave : 'triangle';
        const rate0 = lfo0 && lfo0.rate ? lfo0.rate : 0.2;
        const rate1 = lfo1 && lfo1.rate ? lfo1.rate : 3;
        const unison = state.unison > 1 ? (state.unison > 4 ? 4 : state.unison | 0) : 1;
        const detune = state.detune || 0;
        const mods = state.mod;
        const modCount = mods ? mods.length : 0;

        for (let vi = 0; vi < MAX_VOICES; vi++) {
          const voice = this.voices[vi];
          if (!voice.active) continue;
          const layer = voice.layer === 1 ? state.layers.B : state.layers.A;
          if (!layer) {
            this.silence(voice);
            continue;
          }
          if (layer.enabled === false) voice.gate = false;
          voice.age++;

          if (voice.fading) {
            const fade = Math.exp(-1 / (0.0035 * sr));
            voice.amp *= fade;
            voice.fenv *= fade;
            if (voice.amp < 0.0008) {
              voice.fading = false;
              if (voice.hasPend) {
                this.arm(voice, voice.pendNote, voice.pendVel, voice.pendLayer, voice.pendGlide, false);
              } else if (!voice.gate) {
                this.silence(voice);
                continue;
              }
            }
          } else {
            this.stepEnv(voice.ampStage, voice.amp, layer.amp, voice.gate, sr);
            voice.ampStage = this.envStage;
            voice.amp = this.envValue;
            this.stepEnv(voice.filtStage, voice.fenv, layer.filt, voice.gate, sr);
            voice.filtStage = this.envStage;
            voice.fenv = this.envValue;
            if (voice.ampStage === 'idle') {
              this.silence(voice);
              continue;
            }
          }

          const prev0 = voice.lfo[0];
          voice.lfo[0] = wrap01(prev0 + rate0 / sr);
          if (voice.lfo[0] < prev0) voice.sh[0] = Math.random() * 2 - 1;
          const prev1 = voice.lfo[1];
          voice.lfo[1] = wrap01(prev1 + rate1 / sr);
          if (voice.lfo[1] < prev1) voice.sh[1] = Math.random() * 2 - 1;
          const l1 = lfoSample(wave0, voice.lfo[0], voice.sh[0]);
          const l2 = lfoSample(wave1, voice.lfo[1], voice.sh[1]);

          let pitchAdd = 0;
          let cutOct = 0;
          let resAdd = 0;
          let pwmAdd = 0;
          let fmAdd = 0;
          let panAdd = 0;
          let lev0 = 0;
          let lev1 = 0;
          let lev2 = 0;
          const layerName = voice.layer === 1 ? 'B' : 'A';
          for (let s = 0; s < modCount; s++) {
            const slot = mods[s];
            if (!slot || !slot.amount) continue;
            if (slot.target !== 'both' && slot.target !== layerName) continue;
            const a = slot.amount * sourceValue(slot.src, voice, l1, l2, this.wheel);
            const dest = slot.dest;
            if (dest === 'pitch') pitchAdd += a * 12;
            else if (dest === 'cutoff') cutOct += a * 4;
            else if (dest === 'res') resAdd += a;
            else if (dest === 'pwm') pwmAdd += a * 0.48;
            else if (dest === 'fm') fmAdd += a * 5;
            else if (dest === 'pan') panAdd += a;
            else if (dest === 'osc1') lev0 += a;
            else if (dest === 'osc2') lev1 += a;
            else if (dest === 'osc3') lev2 += a;
          }

          if (voice.glide > 0.0005) {
            const coef = 1 - Math.exp(-1 / (voice.glide * sr));
            voice.freq += (voice.target - voice.freq) * coef;
          } else voice.freq = voice.target;

          const character = layer.character || 0;
          voice.driftPhase += (0.15 + character) / sr;
          if (character > 0) {
            voice.drift += (Math.random() * 2 - 1) * character * 0.00002;
            voice.drift *= 0.9992;
          } else voice.drift = 0;
          const driftMul = 1 + Math.sin(voice.driftPhase * TAU) * character * 0.004 + voice.drift;
          const base = Math.max(20, voice.freq * Math.pow(2, pitchAdd / 12) * bendMul * driftMul);

          const filter = layer.filter;
          let oct = (filter.env || 0) * ENV_OCTAVES * voice.fenv;
          oct += (filter.lfo || 0) * 2.5 * l1;
          oct += ((voice.note - 60) / 12) * (filter.key || 0);
          oct += cutOct;
          const fcTarget = clamp((filter.cutoff || 1000) * Math.pow(2, oct), 28, sr * 0.45);
          voice.fc += (fcTarget - voice.fc) * 0.05;

          if (voice.lastType !== filter.type) {
            voice.comb.fill(0);
            voice.combDamp = 0;
            voice.ic1 = 0;
            voice.ic2 = 0;
            voice.lastType = filter.type;
            voice.ftick = 0;
          }

          const fmMode = layer.fmMode || 'off';
          const doFm = fmMode === 'fm' || fmMode === 'both';
          const doPd = fmMode === 'pd' || fmMode === 'both';
          let mod = 0;
          if (doFm) {
            const ratio = layer.fmRatio || 2;
            const index = (layer.fmIndex || 0) + fmAdd;
            voice.fmPhase = wrap01(voice.fmPhase + (base * ratio) / sr);
            mod = Math.sin(TAU * voice.fmPhase) * (index > 0 ? index : 0);
          }
          const pdDepth = doPd ? (layer.pdDepth || 0) : 0;
          const pdCurve = layer.pdCurve || 'bend';

          const oscs = layer.osc;
          let mix = 0;
          for (let oi = 0; oi < 3; oi++) {
            const osc = oscs[oi];
            const baseLevel = osc.level || 0;
            let level = baseLevel * (1 + (oi === 0 ? lev0 : oi === 1 ? lev1 : lev2));
            if (level < 0) level = 0;
            else if (level > 1.6) level = 1.6;
            if (level < 0.0008) continue;
            const semi = (osc.octave || 0) * 12 + (osc.semi || 0) + (osc.fine || 0) / 100;
            const freq = clamp(base * Math.pow(2, semi / 12), 15, sr * 0.45);
            const pwm = clamp((osc.pwm == null ? 0.5 : osc.pwm) + pwmAdd, 0.05, 0.95);
            const copies = oi === 0 ? unison : 1;
            const wave = osc.wave || 'saw';
            let sum = 0;
            for (let u = 0; u < copies; u++) {
              let spread = 0;
              if (copies === 2) spread = u === 0 ? -detune : detune;
              else if (copies === 3) spread = (u - 1) * detune;
              else if (copies === 4) spread = (u - 1.5) * detune * 0.7;
              const uf = freq * Math.pow(2, spread / 1200);
              let inc = uf / sr;
              if (oi === 0 && doFm) inc += mod * inc;
              if (inc > 0.45) inc = 0.45;
              else if (inc < -0.45) inc = -0.45;
              const uniVoice = oi === 0 && u > 0;
              const store = uniVoice ? voice.uni : voice.phase;
              const idx = uniVoice ? u - 1 : oi;
              const phase = store[idx];
              const read = oi === 0 && pdDepth > 0 ? warpPhase(phase, pdDepth, pdCurve) : phase;
              const adt = inc < 0 ? -inc : inc;
              sum += oscSample(wave, read, adt < 1e-5 ? 1e-5 : adt, pwm);
              store[idx] = wrap01(phase + inc);
            }
            mix += (sum / copies) * level;
          }
          mix *= 0.5;

          const q = resonanceQ((filter.res || 0) + resAdd);
          let shaped = mix;
          if (filter.type === 'comb') {
            const size = 4096;
            let d = sr / clamp(voice.fc, 30, 8000);
            if (d > size - 3) d = size - 3;
            if (d < 2) d = 2;
            let rp = voice.combPos - d;
            if (rp < 0) rp += size;
            const i0 = rp | 0;
            const frac = rp - i0;
            const i1 = i0 + 1 >= size ? 0 : i0 + 1;
            const delayed = voice.comb[i0] * (1 - frac) + voice.comb[i1] * frac;
            const fb = filter.comb > 0.92 ? 0.92 : filter.comb > 0 ? filter.comb : 0;
            voice.combDamp += (delayed - voice.combDamp) * 0.35;
            voice.comb[voice.combPos] = mix + voice.combDamp * fb;
            voice.combPos++;
            if (voice.combPos >= size) voice.combPos = 0;
            shaped = delayed;
          } else {
            voice.ftick--;
            if (voice.ftick <= 0) {
              const g = Math.tan(Math.PI * clamp(voice.fc, 20, sr * 0.45) / sr);
              const k = 1 / q;
              const a1 = 1 / (1 + g * (g + k));
              const a2 = g * a1;
              voice.fg = g;
              voice.fk = k;
              voice.fa1 = a1;
              voice.fa2 = a2;
              voice.fa3 = g * a2;
              voice.ftick = 8;
            }
            const v0 = mix;
            const v3 = v0 - voice.ic2;
            const v1 = voice.fa1 * voice.ic1 + voice.fa2 * v3;
            const v2 = voice.ic2 + voice.fa2 * voice.ic1 + voice.fa3 * v3;
            voice.ic1 = 2 * v1 - voice.ic1;
            voice.ic2 = 2 * v2 - voice.ic2;
            if (!Number.isFinite(voice.ic1) || voice.ic1 > 6 || voice.ic1 < -6) {
              voice.ic1 = 0;
              voice.ic2 = 0;
            }
            const type = filter.type;
            if (type === 'highpass') shaped = v0 - voice.fk * v1 - v2;
            else if (type === 'bandpass') shaped = v1;
            else if (type === 'notch') shaped = v0 - voice.fk * v1;
            else shaped = v2;
            shaped *= 1 / Math.sqrt(1 + q * 0.22);
          }

          if (!Number.isFinite(shaped)) shaped = 0;
          const level = layer.level == null ? 0.8 : layer.level;
          const amp = voice.amp * (0.25 + 0.75 * voice.vel) * level;
          shaped = Math.tanh(shaped * amp * 1.35);
          const pan = clamp((voice.note - 60) / 72 * 0.4 + panAdd, -1, 1);
          const angle = (pan + 1) * 0.25 * Math.PI;
          busL += shaped * Math.cos(angle);
          busR += shaped * Math.sin(angle);
        }
      }

      busL *= 0.72;
      busR *= 0.72;
      const dcL = busL - this.dcInL + 0.995 * this.dcOutL;
      this.dcInL = busL;
      this.dcOutL = dcL;
      const dcR = busR - this.dcInR + 0.995 * this.dcOutR;
      this.dcInR = busR;
      this.dcOutR = dcR;
      Lch[i] = dcL === dcL ? dcL : 0;
      if (Rch !== Lch) Rch[i] = dcR === dcR ? dcR : 0;
      this.scope[this.scopePos++] = (Lch[i] + (Rch === Lch ? Lch[i] : Rch[i])) * 0.5;
      if (this.scopePos >= 160) this.scopePos = 0;
    }

    let alive = 0;
    for (let i = 0; i < MAX_VOICES; i++) if (this.voices[i].active) alive++;
    this.activeCount = alive;
    this.blocks++;
    if (mark && performance.now) {
      this.cpuMs += performance.now() - mark;
      this.cpuAudio += (frames / sr) * 1000;
    }
    if (this.blocks % 48 === 0) {
      let cpu = alive / MAX_VOICES * 0.45;
      if (this.cpuAudio > 1) {
        const measured = this.cpuMs / this.cpuAudio;
        if (measured > 0) cpu = measured > 1 ? 1 : measured;
      }
      const n = 160;
      const pos = this.scopePos;
      const copy = this.scopeCopy;
      for (let i = 0; i < n; i++) copy[i] = this.scope[(pos + i) % n];
      this.port.postMessage({ type: 'meter', voices: alive, cpu, scope: copy });
      this.cpuMs = 0;
      this.cpuAudio = 0;
    }
    return true;
  }
}

globalThis.MosaicProcessor = MosaicProcessor;
if (typeof registerProcessor === 'function') registerProcessor('mosaic-voice', MosaicProcessor);
