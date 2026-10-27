/** Web Audio graph: worklet voices, effects, meters, MIDI-facing note API. */

const SYNC = { '1/4': 1, '1/8': 0.5, '1/8d': 0.75, '1/16': 0.25 };

function curve(amount) {
  const n = 256;
  const data = new Float32Array(n);
  const k = 1 + Math.max(0, amount) * 22;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    data[i] = Math.tanh(k * x) / norm;
  }
  return data;
}

function impulse(ctx, seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, 1.6) * Math.exp(-2.4 * t);
      const early = i < ctx.sampleRate * 0.03 ? 0.4 : 1;
      data[i] = (Math.random() * 2 - 1) * env * early * 0.55;
    }
  }
  return buffer;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.starting = null;
    this.state = null;
    this.onMeter = null;
    this.midiInputs = [];
    this.onMidi = null;
    this.reverbSeconds = 0;
    this.driveAmount = -1;
  }

  ensure(state) {
    if (this.ready) return Promise.resolve();
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.ctx.resume();
    }
    if (!this.starting) this.starting = this.boot(state);
    return this.starting;
  }

  async boot(state) {
    const ctx = this.ctx;
    const url = new URL('./voice-processor.js', import.meta.url);
    await ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(ctx, 'mosaic-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    this.node.port.onmessage = (event) => {
      if (event.data && event.data.type === 'meter' && this.onMeter) this.onMeter(event.data);
    };
    this.buildFx();
    this.node.connect(this.gate);
    this.ready = true;
    if (state) this.setState(state);
    if (ctx.state === 'suspended') await ctx.resume();
  }

  buildFx() {
    const ctx = this.ctx;
    this.gate = ctx.createGain();
    this.drive = ctx.createWaveShaper();
    this.drive.oversample = '2x';
    this.drive.curve = curve(0);
    this.driveDry = ctx.createGain();
    this.driveWet = ctx.createGain();
    this.driveSum = ctx.createGain();
    this.gate.connect(this.driveDry);
    this.gate.connect(this.drive);
    this.drive.connect(this.driveWet);
    this.driveDry.connect(this.driveSum);
    this.driveWet.connect(this.driveSum);

    this.phaserDry = ctx.createGain();
    this.phaserWet = ctx.createGain();
    this.phaserSum = ctx.createGain();
    this.phaseStages = [];
    let previous = this.driveSum;
    this.driveSum.connect(this.phaserDry);
    for (let i = 0; i < 4; i++) {
      const stage = ctx.createBiquadFilter();
      stage.type = 'allpass';
      stage.frequency.value = 1600;
      stage.Q.value = 0.7;
      previous.connect(stage);
      previous = stage;
      this.phaseStages.push(stage);
    }
    previous.connect(this.phaserWet);
    this.phaserDry.connect(this.phaserSum);
    this.phaserWet.connect(this.phaserSum);
    this.phaseLfo = ctx.createOscillator();
    this.phaseLfo.frequency.value = 0.2;
    this.phaseDepth = ctx.createGain();
    this.phaseDepth.gain.value = 400;
    this.phaseLfo.connect(this.phaseDepth);
    this.phaseStages.forEach((stage, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 1 - i * 0.12;
      this.phaseDepth.connect(gain);
      gain.connect(stage.frequency);
    });
    this.phaseLfo.start();

    this.delay = ctx.createDelay(2);
    this.delayFb = ctx.createGain();
    this.delayDamp = ctx.createBiquadFilter();
    this.delayDamp.type = 'lowpass';
    this.delayDamp.frequency.value = 4200;
    this.delayWet = ctx.createGain();
    this.delayDry = ctx.createGain();
    this.fxSum = ctx.createGain();
    this.phaserSum.connect(this.delayDry);
    this.phaserSum.connect(this.delay);
    this.delay.connect(this.delayDamp);
    this.delayDamp.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayDamp.connect(this.delayWet);
    this.delayDry.connect(this.fxSum);
    this.delayWet.connect(this.fxSum);

    this.multiWet = ctx.createGain();
    this.multi = [];
    for (const [type, hz, scale] of [['lowpass', 380, 1.35], ['bandpass', 1400, 1], ['highpass', 3200, 0.72]]) {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = hz;
      if (type === 'bandpass') filter.Q.value = 0.7;
      const delay = ctx.createDelay(2.5);
      const fb = ctx.createGain();
      const level = ctx.createGain();
      level.gain.value = 0.34;
      this.phaserSum.connect(filter);
      filter.connect(delay);
      delay.connect(level);
      level.connect(this.multiWet);
      delay.connect(fb);
      fb.connect(delay);
      this.multi.push({ delay, fb, scale });
    }
    this.multiWet.connect(this.fxSum);

    this.reverb = ctx.createConvolver();
    this.reverbWet = ctx.createGain();
    this.fxSum.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.fxSum);

    this.shimmer = ctx.createGain();
    this.shimmerFilter = ctx.createBiquadFilter();
    this.shimmerFilter.type = 'lowpass';
    this.shimmerFilter.frequency.value = 2200;
    this.shimmerOsc = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? 'sine' : 'triangle';
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.shimmerFilter);
      osc.start();
      this.shimmerOsc.push({ osc, gain });
    }
    this.shimmerFilter.connect(this.shimmer);
    this.shimmer.connect(this.fxSum);
    this.shimmerLfo = ctx.createOscillator();
    this.shimmerLfo.frequency.value = 0.12;
    this.shimmerDepth = ctx.createGain();
    this.shimmerLfo.connect(this.shimmerDepth);
    this.shimmerDepth.connect(this.shimmer.gain);
    this.shimmerLfo.start();

    this.comp = ctx.createDynamicsCompressor();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.fxSum.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  setState(state) {
    this.state = state;
    if (!this.ready) return;
    this.node.port.postMessage({ type: 'state', state });
    this.applyFx();
  }

  applyFx() {
    const ctx = this.ctx;
    const fx = this.state.fx;
    const now = ctx.currentTime;
    const set = (param, value) => param.setTargetAtTime(value, now, 0.03);
    const drive = Math.max(0, Math.min(1, fx.drive || 0));
    if (Math.abs(drive - this.driveAmount) > 0.02) {
      this.drive.curve = curve(drive);
      this.driveAmount = drive;
    }
    set(this.driveWet.gain, drive > 0.001 ? 1 : 0);
    set(this.driveDry.gain, drive > 0.001 ? 1 - drive * 0.85 : 1);

    const phaser = fx.phaserOn ? fx.phaserWet : 0;
    set(this.phaserWet.gain, phaser);
    set(this.phaserDry.gain, 1 - phaser * 0.35);
    set(this.phaseLfo.frequency, 0.05 + (fx.phaserRate || 0) * 4);
    set(this.phaseDepth.gain, 120 + (fx.phaserDepth || 0) * 900);

    const bpm = this.state.seq && this.state.seq.bpm ? this.state.seq.bpm : 120;
    let delayTime = fx.delayTime || 0.3;
    if (fx.delaySync && fx.delaySync !== 'free' && SYNC[fx.delaySync]) {
      delayTime = (60 / bpm) * SYNC[fx.delaySync];
    }
    set(this.delay.delayTime, Math.min(1.8, Math.max(0.01, delayTime)));
    set(this.delayFb.gain, Math.min(0.85, Math.max(0, fx.delayFb || 0)));
    set(this.delayWet.gain, Math.max(0, fx.delayWet || 0));
    set(this.delayDry.gain, 1);

    const multi = fx.multiOn ? fx.multiWet : 0;
    set(this.multiWet.gain, Math.max(0, multi || 0));
    this.multi.forEach((band) => {
      set(band.delay.delayTime, Math.min(2.2, Math.max(0.02, (fx.multiTime || 0.3) * band.scale)));
      set(band.fb.gain, Math.min(0.8, Math.max(0, fx.multiFb || 0)));
    });

    set(this.reverbWet.gain, Math.max(0, fx.reverbWet || 0));
    const decay = Math.min(6, Math.max(0.4, fx.reverbDecay || 2));
    if (Math.abs(decay - this.reverbSeconds) > 0.25) {
      this.reverb.buffer = impulse(ctx, decay);
      this.reverbSeconds = decay;
    }

    const air = fx.shimmerOn ? fx.shimmerLevel : 0;
    const pitch = fx.shimmerPitch || 196;
    this.shimmerOsc.forEach((entry, i) => {
      set(entry.osc.frequency, pitch * [1, 1.5, 2.01][i]);
      set(entry.gain.gain, (air || 0) * [0.08, 0.035, 0.02][i]);
    });
    set(this.shimmerLfo.frequency, 0.05 + (fx.shimmerMotion || 0) * 0.7);
    set(this.shimmerDepth.gain, fx.shimmerOn ? (air || 0) * 0.15 : 0);

    if (fx.compOn) {
      set(this.comp.threshold, fx.compThreshold);
      set(this.comp.ratio, Math.max(1, fx.compRatio));
      set(this.comp.attack, Math.max(0.001, fx.compAttack));
      set(this.comp.release, Math.max(0.02, fx.compRelease));
    } else {
      set(this.comp.threshold, 0);
      set(this.comp.ratio, 1);
      set(this.comp.attack, 0.01);
      set(this.comp.release, 0.1);
    }
    set(this.master.gain, Math.max(0, this.state.master) * 0.72);
  }

  noteOn(id, note, vel = 100, opts = {}) {
    if (!this.node) return;
    this.node.port.postMessage({
      type: 'on',
      id,
      note,
      vel,
      layer: opts.layer || 'A',
      glide: opts.glide || 0,
      legato: !!opts.legato,
      time: opts.time || this.ctx.currentTime
    });
  }

  noteOff(id, time) {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'off', id, time: time || this.ctx.currentTime });
  }

  bend(value) {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'bend', value, time: this.ctx.currentTime });
  }

  mod(value) {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'mod', value, time: this.ctx.currentTime });
  }

  sustain(on) {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'sustain', on: !!on, time: this.ctx.currentTime });
  }

  panic() {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'panic' });
    if (this.gate) this.gate.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
  }

  setGate(value, time) {
    if (!this.gate) return;
    const t = time || this.ctx.currentTime;
    this.gate.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), t, 0.004);
  }
}

export function bindMidi(handlers) {
  if (!navigator.requestMIDIAccess) {
    handlers.status('No MIDI');
    return;
  }
  navigator.requestMIDIAccess({ sysex: false }).then((access) => {
    const attach = () => {
      const inputs = [...access.inputs.values()];
      inputs.forEach((input) => {
        input.onmidimessage = (event) => handlers.message(event.data);
      });
      handlers.status(inputs.length ? inputs.map((input) => input.name).join(', ') : 'No MIDI');
    };
    attach();
    access.onstatechange = attach;
  }).catch(() => handlers.status('MIDI blocked'));
}
