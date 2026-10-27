import fs from 'node:fs';
import vm from 'node:vm';
import { FACTORY, defaultState } from '../js/presets.js';

const context = vm.createContext({
  sampleRate: 48000,
  currentTime: 0,
  currentFrame: 0,
  performance,
  console,
  Math,
  AudioWorkletProcessor: class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  },
  registerProcessor() {}
});
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL('../js/voice-processor.js', import.meta.url), 'utf8'), context);

const Processor = context.MosaicProcessor;
if (!Processor) throw new Error('processor did not register');

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function finite(buffer) {
  for (let i = 0; i < buffer.length; i++) if (!Number.isFinite(buffer[i])) return false;
  return true;
}

function render(proc, blocks) {
  let energy = 0;
  let peak = 0;
  let first = null;
  for (let b = 0; b < blocks; b++) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    proc.process([], [[left, right]]);
    if (!finite(left) || !finite(right)) throw new Error('non-finite sample at block ' + b);
    const power = rms(left);
    energy += power;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]));
    if (first == null) first = left.slice(0, 8);
    context.currentTime += 128 / 48000;
  }
  return { energy: energy / blocks, peak, first };
}

function boot(state) {
  context.currentTime = 0;
  const proc = new Processor();
  proc.port.onmessage({ data: { type: 'state', state } });
  return proc;
}

const init = defaultState();
const quiet = render(boot(init), 30);
if (quiet.peak > 0.0001) throw new Error('idle voice made sound ' + quiet.peak);

const proc = boot(init);
proc.port.onmessage({ data: { type: 'on', id: 'n1', note: 60, vel: 110, layer: 'A', time: 0 } });
const attack = render(proc, 1);
if (Math.max(...attack.first) > 0.05) throw new Error('note onset clicked ' + attack.first.join(','));
const tone = render(proc, 80);
if (tone.energy < 0.01) throw new Error('note was too quiet ' + tone.energy);
if (tone.peak > 1.2) throw new Error('note peaked hot ' + tone.peak);
proc.port.onmessage({ data: { type: 'off', id: 'n1', time: context.currentTime } });
const tail = render(proc, 500);
if (tail.energy > 0.02) throw new Error('release did not settle ' + tail.energy);

const acid = FACTORY.find((preset) => preset.name === 'Acid Line');
const acidProc = boot(acid);
acidProc.port.onmessage({ data: { type: 'on', id: 'a', note: 40, vel: 120, layer: 'A', time: 0 } });
const acidTone = render(acidProc, 120);
if (acidTone.energy < 0.008) throw new Error('acid preset quiet ' + acidTone.energy);
if (acidTone.peak > 1.25) throw new Error('acid preset clipped ' + acidTone.peak);

const glass = FACTORY.find((preset) => preset.name === 'Glass FM');
const glassProc = boot(glass);
glassProc.port.onmessage({ data: { type: 'on', id: 'g', note: 76, vel: 90, layer: 'A', time: 0 } });
const glassTone = render(glassProc, 100);
if (glassTone.energy < 0.004) throw new Error('fm preset quiet ' + glassTone.energy);

const comb = defaultState();
comb.layers.A.filter.type = 'comb';
comb.layers.A.filter.comb = 0.9;
comb.layers.A.filter.cutoff = 220;
const combProc = boot(comb);
combProc.port.onmessage({ data: { type: 'on', id: 'c', note: 48, vel: 100, layer: 'A', time: 0 } });
render(combProc, 60);

const poly = boot(defaultState());
for (let n = 0; n < 10; n++) {
  poly.port.onmessage({ data: { type: 'on', id: 'p' + n, note: 48 + n, vel: 100, layer: 'A', time: context.currentTime } });
}
const chord = render(poly, 40);
if (chord.peak > 1.35) throw new Error('chord peaked ' + chord.peak);
if (poly.activeCount < 8) throw new Error('voices missing ' + poly.activeCount);

console.log('dsp ok', { tone: tone.energy.toFixed(3), acid: acidTone.energy.toFixed(3), glass: glassTone.energy.toFixed(3), chord: chord.peak.toFixed(3), voices: poly.activeCount });
