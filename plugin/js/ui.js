import {
  FACTORY,
  clone,
  loadLastId,
  loadLastState,
  loadUserPresets,
  normalize,
  recall,
  saveLastId,
  saveLastState,
  saveUserPresets
} from './presets.js';
import { bindMidi } from './engine.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEYS = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
const SOURCES = [['off', 'Off'], ['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['amp', 'Amp Env'], ['filter', 'Filter Env'], ['vel', 'Velocity'], ['wheel', 'Mod Wheel'], ['key', 'Key Track']];
const DESTS = [['off', 'Off'], ['pitch', 'Pitch'], ['cutoff', 'Cutoff'], ['res', 'Resonance'], ['pwm', 'Pulse Width'], ['fm', 'FM Index'], ['pan', 'Pan'], ['osc1', 'Osc 1 Level'], ['osc2', 'Osc 2 Level'], ['osc3', 'Osc 3 Level']];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function noteName(midi) {
  const n = ((midi % 12) + 12) % 12;
  return NAMES[n] + (Math.floor(midi / 12) - 1);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function mount(stage, engine) {
  const user = loadUserPresets();
  let currentId = loadLastId();
  if (currentId.startsWith('user:') && !user.some((preset) => preset.id === currentId)) currentId = 'factory:Init';
  let state = loadLastState() || recall(currentId, user);
  let editLayer = 'A';
  let octave = 4;
  let page = 'play';
  const widgets = [];
  const down = new Map();
  const order = [];
  const pointers = new Map();
  const heldKeys = new Map();
  let pitchValue = 0;
  let modValue = 0;
  let scope = null;
  let midiLive = false;
  let lfoVis = [0, 0];
  let oscVis = 0;
  let lastFrame = performance.now();
  let pushFrame = 0;
  let nameBtn;
  let menu;
  let statusNode;
  let voiceNode;
  let cpuNode;
  let midiDot;
  let scopeCanvas;
  let stepGrid;
  let playBtn;
  let gateSlots;
  let pitchCap;
  let modCap;
  let nameInput;
  let playhead = -1;

  const plugin = el('div', 'plugin layer-a');
  plugin.tabIndex = -1;
  stage.append(plugin);

  const header = el('header', 'top');
  const tabs = el('nav', 'tabs');
  const pages = el('div', 'pages');
  const footer = el('footer', 'bed');
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  modal.hidden = true;
  plugin.append(header, tabs, pages, footer, overlay, modal);

  header.append(brand(), presetBar(), meterBar());
  buildTabs();
  const play = buildPlay();
  const modPage = buildMod();
  const fxPage = buildFx();
  const seqPage = buildSeq();
  pages.append(play.page, modPage, fxPage.page, seqPage.page);
  buildBed();
  buildOverlay();
  buildModal();
  paintAll();
  showPage('play');
  requestAnimationFrame(frame);
  window.addEventListener('resize', fit);
  fit();

  function fit() {
    const scale = Math.min((window.innerWidth - 16) / 1280, (window.innerHeight - 16) / 820);
    plugin.style.transform = 'scale(' + Math.max(0.45, scale) + ')';
  }

  function brand() {
    const node = el('div', 'brand');
    node.innerHTML = `
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <rect x="1" y="1" width="34" height="34" rx="8" fill="#10141c" stroke="#e2a84a" stroke-width="1.2"/>
        <path d="M6 20 H10 L13 10 L18 28 L23 14 L26 20 H30" fill="none" stroke="#e2a84a" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div><strong>CONTINUUM</strong><em>MOSAIC</em><small>SUBTRACTIVE · FM</small></div>`;
    return node;
  }

  function presetBar() {
    const bar = el('div', 'presets');
    const prev = el('button', 'nav', '◀');
    const next = el('button', 'nav', '▶');
    nameBtn = el('button', 'preset-name', state.name);
    nameBtn.type = 'button';
    prev.type = 'button';
    next.type = 'button';
    const save = el('button', 'texty', 'Save');
    const load = el('button', 'texty', 'Load');
    save.type = 'button';
    load.type = 'button';
    menu = el('div', 'menu');
    menu.hidden = true;
    const file = el('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    prev.addEventListener('click', () => stepPreset(-1));
    next.addEventListener('click', () => stepPreset(1));
    nameBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; if (!menu.hidden) fillMenu(); });
    save.addEventListener('click', openSave);
    load.addEventListener('click', () => file.click());
    file.addEventListener('change', () => importFile(file));
    bar.append(prev, nameBtn, next, save, load, menu, file);
    document.addEventListener('pointerdown', (event) => {
      if (!menu.hidden && !menu.contains(event.target) && event.target !== nameBtn) menu.hidden = true;
    });
    return bar;
  }

  function meterBar() {
    const box = el('div', 'meters');
    scopeCanvas = el('canvas', 'scope');
    const vol = el('div', 'master-knob');
    addKnob(vol, { path: 'master', label: 'VOL', min: 0, max: 1, def: 0.78, format: (v) => Math.round(v * 100) });
    const voices = el('div', 'voicebox');
    voices.append(el('b', '', 'VOICES'));
    voiceNode = el('span', '', '0');
    voices.append(voiceNode);
    const cpu = el('div', 'cpubox');
    cpu.append(el('b', '', 'CPU'));
    cpuNode = el('div', 'meter');
    cpuNode.append(el('i'));
    cpu.append(cpuNode);
    midiDot = el('i', 'midi-dot');
    statusNode = el('div', 'status', 'Audio off');
    box.append(scopeCanvas, vol, voices, cpu, midiDot, statusNode);
    return box;
  }

  function buildTabs() {
    [['play', 'PLAY'], ['mod', 'MOD'], ['fx', 'FX'], ['seq', 'SEQ']].forEach(([id, label]) => {
      const button = el('button', '', label);
      button.type = 'button';
      button.dataset.page = id;
      button.addEventListener('click', () => showPage(id));
      tabs.append(button);
    });
    tabs.append(el('div', 'spacer'));
    const chip = el('span', 'chip', 'EDITING A');
    chip.id = 'layerChip';
    const edit = el('div', 'layer-edit');
    ['A', 'B'].forEach((id) => {
      const button = el('button', id === 'A' ? 'on' : '', 'LAYER ' + id);
      button.type = 'button';
      button.dataset.edit = id;
      button.addEventListener('click', () => {
        editLayer = id;
        plugin.classList.toggle('layer-b', id === 'B');
        paintAll();
      });
      edit.append(button);
    });
    tabs.append(chip, edit);
  }

  function showPage(id) {
    page = id;
    [...pages.children].forEach((node) => node.classList.toggle('on', node.dataset.page === id));
    [...tabs.querySelectorAll('[data-page]')].forEach((node) => node.classList.toggle('on', node.dataset.page === id));
  }

  function buildPlay() {
    const pageNode = el('div', 'page page-play');
    pageNode.dataset.page = 'play';
    const oscRow = el('div', 'row osc-row');
    const envRow = el('div', 'row env-row');
    for (let i = 0; i < 3; i++) oscRow.append(oscPanel(i));
    oscRow.append(filterPanel());
    envRow.append(envPanel('amp', 'AMP ENVELOPE'));
    envRow.append(envPanel('filt', 'FILTER ENVELOPE'));
    envRow.append(lfoPanel(0));
    envRow.append(lfoPanel(1));
    envRow.append(enginePanel());
    const voice = el('div', 'voice');
    const globals = el('div', 'group');
    addKnob(globals, { path: 'polyphony', label: 'POLY', min: 1, max: 8, step: 1, def: 8, format: (v) => String(Math.round(v)) });
    addKnob(globals, { path: 'glide', label: 'GLIDE', min: 0, max: 0.45, def: 0, format: (v) => v < 0.001 ? '0' : Math.round(v * 1000) + 'ms' });
    addKnob(globals, { path: 'unison', label: 'UNI', min: 1, max: 4, step: 1, def: 1, format: (v) => String(Math.round(v)) });
    addKnob(globals, { path: 'detune', label: 'DET', min: 0, max: 40, step: 1, def: 10, format: (v) => Math.round(v) + '¢' });
    addKnob(globals, { path: 'bendRange', label: 'BEND', min: 1, max: 12, step: 1, def: 2, format: (v) => '±' + Math.round(v) });
    const layerA = el('div', 'group');
    addSwitch(layerA, { path: 'layers.A.enabled', label: 'A', onToggle: (on) => { if (!on) releaseLayer('A'); } });
    addKnob(layerA, { path: 'layers.A.level', label: 'A LVL', min: 0, max: 1, def: 0.82, format: (v) => Math.round(v * 100) });
    const layerB = el('div', 'group');
    addSwitch(layerB, { path: 'layers.B.enabled', label: 'B', onToggle: (on) => { if (!on) releaseLayer('B'); } });
    addKnob(layerB, { path: 'layers.B.level', label: 'B LVL', min: 0, max: 1, def: 0.55, format: (v) => Math.round(v * 100) });
    voice.append(globals, layerA, layerB);
    pageNode.append(oscRow, envRow, voice);
    return { page: pageNode };
  }

  function oscPanel(index) {
    const panel = el('section', 'panel');
    const title = el('h3');
    title.append(document.createTextNode('OSC ' + (index + 1)), el('span', '', ''));
    const canvas = el('canvas', 'display');
    canvas.dataset.osc = String(index);
    panel.append(title, canvas);
    addSegments(panel, {
      path: 'layers.$.osc.' + index + '.wave',
      options: [['saw', 'SAW'], ['square', 'SQR'], ['triangle', 'TRI'], ['sine', 'SIN']]
    });
    const knobs = el('div', 'knobs');
    const p = 'layers.$.osc.' + index + '.';
    addKnob(knobs, { path: p + 'octave', label: 'OCT', min: -3, max: 3, step: 1, def: index === 1 ? -1 : 0, format: (v) => (v > 0 ? '+' : '') + Math.round(v) });
    addKnob(knobs, { path: p + 'semi', label: 'SEMI', min: -12, max: 12, step: 1, def: 0, format: (v) => (v > 0 ? '+' : '') + Math.round(v) });
    addKnob(knobs, { path: p + 'fine', label: 'FINE', min: -100, max: 100, step: 1, def: index === 1 ? 6 : 0, format: (v) => Math.round(v) + '' });
    addKnob(knobs, { path: p + 'level', label: 'LVL', min: 0, max: 1, def: index === 0 ? 0.78 : index === 1 ? 0.22 : 0, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: p + 'pwm', label: 'PWM', min: 0.05, max: 0.95, def: 0.5, format: (v) => Math.round(v * 100) });
    panel.append(knobs);
    return panel;
  }

  function filterPanel() {
    const panel = el('section', 'panel');
    panel.append(el('h3', '', 'FILTER'));
    panel.append(el('canvas', 'display filter'));
    addSegments(panel, {
      path: 'layers.$.filter.type',
      options: [['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP'], ['notch', 'NOTCH'], ['comb', 'COMB']]
    });
    const knobs = el('div', 'knobs');
    addKnob(knobs, { path: 'layers.$.filter.cutoff', label: 'CUT', min: 40, max: 14000, log: true, def: 1600, format: hz });
    addKnob(knobs, { path: 'layers.$.filter.res', label: 'RES', min: 0, max: 1, def: 0.18, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: 'layers.$.filter.env', label: 'ENV', min: -1, max: 1, def: 0.42, format: signed });
    addKnob(knobs, { path: 'layers.$.filter.lfo', label: 'LFO', min: 0, max: 1, def: 0, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: 'layers.$.filter.key', label: 'KEY', min: 0, max: 1, def: 0.15, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: 'layers.$.filter.comb', label: 'CMB', min: 0, max: 0.92, def: 0.55, format: (v) => Math.round(v * 100) });
    panel.append(knobs);
    return panel;
  }

  function envPanel(key, label) {
    const panel = el('section', 'panel env-panel');
    panel.append(el('h3', '', label));
    const canvas = el('canvas', 'display env');
    canvas.dataset.env = key;
    panel.append(canvas);
    const knobs = el('div', 'knobs');
    const base = 'layers.$.' + key + '.';
    addKnob(knobs, { path: base + 'a', label: 'A', min: 0.002, max: 4, log: true, def: 0.01, format: seconds });
    addKnob(knobs, { path: base + 'd', label: 'D', min: 0.005, max: 4, log: true, def: 0.24, format: seconds });
    addKnob(knobs, { path: base + 's', label: 'S', min: 0, max: 1, def: key === 'amp' ? 0.72 : 0.22, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: base + 'r', label: 'R', min: 0.005, max: 5, log: true, def: 0.32, format: seconds });
    panel.append(knobs);
    return panel;
  }

  function lfoPanel(index) {
    const panel = el('section', 'panel lfo-panel');
    panel.append(el('h3', '', 'LFO ' + (index + 1)));
    const canvas = el('canvas', 'display lfo');
    canvas.dataset.lfo = String(index);
    panel.append(canvas);
    addSegments(panel, {
      path: 'lfo.' + index + '.wave',
      options: [['sine', 'SIN'], ['triangle', 'TRI'], ['square', 'SQR'], ['saw', 'SAW'], ['sample', 'S&H']]
    });
    const knobs = el('div', 'knobs');
    addKnob(knobs, { path: 'lfo.' + index + '.rate', label: 'RATE', min: 0.05, max: 20, log: true, def: index === 0 ? 0.35 : 4.5, format: (v) => v < 1 ? v.toFixed(2) + 'Hz' : v.toFixed(1) + 'Hz' });
    panel.append(knobs);
    const row = el('div', 'segs');
    addSwitch(row, { path: 'lfo.' + index + '.retrig', label: 'RETRIG' });
    panel.append(row);
    return panel;
  }

  function enginePanel() {
    const panel = el('section', 'panel');
    panel.append(el('h3', '', 'ENGINE'));
    addSegments(panel, {
      path: 'layers.$.fmMode',
      options: [['off', 'OFF'], ['pd', 'PD'], ['fm', 'FM'], ['both', 'BOTH']]
    });
    addSegments(panel, {
      path: 'layers.$.pdCurve',
      options: [['bend', 'BEND'], ['pulse', 'PULSE'], ['sine', 'SINE']]
    });
    const knobs = el('div', 'knobs');
    addKnob(knobs, { path: 'layers.$.pdDepth', label: 'PD', min: 0, max: 1, def: 0.35, format: (v) => Math.round(v * 100) });
    addKnob(knobs, { path: 'layers.$.fmRatio', label: 'RATIO', min: 0.25, max: 12, log: true, def: 2, format: (v) => v.toFixed(2) + '×' });
    addKnob(knobs, { path: 'layers.$.fmIndex', label: 'INDEX', min: 0, max: 8, def: 1.4, format: (v) => v.toFixed(2) });
    addKnob(knobs, { path: 'layers.$.character', label: 'DRIFT', min: 0, max: 1, def: 0, format: (v) => Math.round(v * 100) });
    panel.append(knobs);
    return panel;
  }

  function buildMod() {
    const pageNode = el('div', 'page page-mod');
    pageNode.dataset.page = 'mod';
    const head = el('div', 'mod-head');
    [0, 1].forEach((index) => {
      const panel = el('section', 'panel');
      panel.append(el('h3', '', 'LFO ' + (index + 1) + ' · MATRIX SOURCE'));
      addSegments(panel, {
        path: 'lfo.' + index + '.wave',
        options: [['sine', 'SIN'], ['triangle', 'TRI'], ['square', 'SQR'], ['saw', 'SAW'], ['sample', 'S&H']]
      });
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'lfo.' + index + '.rate', label: 'RATE', min: 0.05, max: 20, log: true, def: index === 0 ? 0.35 : 4.5, format: (v) => v.toFixed(2) });
      panel.append(knobs);
      head.append(panel);
    });
    const matrix = el('div', 'matrix');
    const headRow = el('header');
    ['#', 'SOURCE', '', 'DESTINATION', 'AMOUNT', 'LAYER'].forEach((label) => headRow.append(el('span', '', label)));
    matrix.append(headRow);
    for (let i = 0; i < 8; i++) {
      const row = el('div', 'mod-row');
      row.append(el('span', '', String(i + 1)));
      addSelect(row, { path: 'mod.' + i + '.src', options: SOURCES });
      row.append(el('span', 'arrow', '→'));
      addSelect(row, { path: 'mod.' + i + '.dest', options: DESTS });
      const amount = el('div');
      addKnob(amount, { path: 'mod.' + i + '.amount', label: 'AMT', min: -1, max: 1, def: 0, format: signed });
      row.append(amount);
      addSelect(row, { path: 'mod.' + i + '.target', options: [['A', 'A'], ['B', 'B'], ['both', 'A + B']] });
      matrix.append(row);
    }
    const note = el('p', 'note', 'The matrix is the old patch bay. Pitch, filter, pulse width, FM and oscillator levels route from either LFO, either envelope, velocity, the mod wheel or key track, to layer A, layer B, or both. Filter ENV and LFO knobs on the Play page are the direct routes that used to be patched by default.');
    matrix.append(note);
    pageNode.append(head, matrix);
    return pageNode;
  }

  function buildFx() {
    const pageNode = el('div', 'page page-fx');
    pageNode.dataset.page = 'fx';
    pageNode.append(fxCard('DRIVE', 'Waveshaper after the voice, in the role of the old acid drive.', (card) => {
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.drive', label: 'DRIVE', min: 0, max: 1, def: 0, format: (v) => Math.round(v * 100) });
      card.append(knobs);
    }));
    pageNode.append(fxCard('PHASER', 'Four swept all-pass stages.', (card) => {
      const top = el('div', 'fx-top');
      addSwitch(top, { path: 'fx.phaserOn', label: 'ON', liveLabel: true });
      card.append(top);
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.phaserWet', label: 'MIX', min: 0, max: 1, def: 0.28, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.phaserRate', label: 'RATE', min: 0, max: 1, def: 0.22, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.phaserDepth', label: 'DPTH', min: 0, max: 1, def: 0.45, format: (v) => Math.round(v * 100) });
      card.append(knobs);
    }));
    pageNode.append(fxCard('DELAY', 'The shared delay, with optional tempo sync.', (card) => {
      const sync = el('div', 'segs');
      addSelect(sync, { path: 'fx.delaySync', options: [['free', 'Free'], ['1/4', '1/4'], ['1/8', '1/8'], ['1/8d', '1/8.'], ['1/16', '1/16']] });
      card.append(sync);
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.delayTime', label: 'TIME', min: 0.02, max: 1.2, log: true, def: 0.32, format: (v) => Math.round(v * 1000) + 'ms' });
      addKnob(knobs, { path: 'fx.delayFb', label: 'FB', min: 0, max: 0.85, def: 0.32, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.delayWet', label: 'WET', min: 0, max: 1, def: 0, format: (v) => Math.round(v * 100) });
      card.append(knobs);
    }));
    pageNode.append(fxCard('MULTIBAND', 'Three filtered echoes with different times.', (card) => {
      const top = el('div', 'fx-top');
      addSwitch(top, { path: 'fx.multiOn', label: 'ON', liveLabel: true });
      card.append(top);
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.multiTime', label: 'TIME', min: 0.08, max: 1.1, def: 0.31, format: (v) => Math.round(v * 1000) });
      addKnob(knobs, { path: 'fx.multiFb', label: 'FB', min: 0, max: 0.8, def: 0.34, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.multiWet', label: 'WET', min: 0, max: 1, def: 0, format: (v) => Math.round(v * 100) });
      card.append(knobs);
    }));
    pageNode.append(fxCard('REVERB', 'Stereo impulse generated in the browser.', (card) => {
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.reverbWet', label: 'WET', min: 0, max: 1, def: 0.12, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.reverbDecay', label: 'DECAY', min: 0.4, max: 6, def: 2.1, format: (v) => v.toFixed(1) + 's' });
      card.append(knobs);
    }));
    pageNode.append(fxCard('SHIMMER', 'Quiet harmonic air under the instrument.', (card) => {
      const top = el('div', 'fx-top');
      addSwitch(top, { path: 'fx.shimmerOn', label: 'ON', liveLabel: true });
      card.append(top);
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.shimmerLevel', label: 'LVL', min: 0, max: 1, def: 0.12, format: (v) => Math.round(v * 100) });
      addKnob(knobs, { path: 'fx.shimmerPitch', label: 'PITCH', min: 70, max: 600, log: true, def: 196, format: hz });
      addKnob(knobs, { path: 'fx.shimmerMotion', label: 'MOVE', min: 0, max: 1, def: 0.28, format: (v) => Math.round(v * 100) });
      card.append(knobs);
    }));
    pageNode.append(fxCard('COMPRESSOR', 'Insert dynamics before the output limiter.', (card) => {
      const top = el('div', 'fx-top');
      addSwitch(top, { path: 'fx.compOn', label: 'ON', liveLabel: true });
      card.append(top);
      const knobs = el('div', 'knobs');
      addKnob(knobs, { path: 'fx.compThreshold', label: 'THR', min: -40, max: 0, step: 1, def: -18, format: (v) => Math.round(v) });
      addKnob(knobs, { path: 'fx.compRatio', label: 'RATIO', min: 1, max: 12, def: 3, format: (v) => v.toFixed(1) });
      addKnob(knobs, { path: 'fx.compAttack', label: 'ATK', min: 0.001, max: 0.1, log: true, def: 0.01, format: (v) => Math.round(v * 1000) + 'ms' });
      addKnob(knobs, { path: 'fx.compRelease', label: 'REL', min: 0.02, max: 0.6, def: 0.18, format: (v) => Math.round(v * 1000) });
      card.append(knobs);
    }));
    const about = el('section', 'panel');
    about.append(el('h3', '', 'SIGNAL'));
    about.append(el('p', 'note', 'Each note is a voice in the audio worklet: three oscillators, multimode filter, two envelopes. Layers A and B are the two engines and can sound together. A safety limiter sits after the effects.'));
    pageNode.append(about);
    return { page: pageNode };
  }

  function fxCard(title, copy, build) {
    const card = el('section', 'panel fx-card');
    card.append(el('h3', '', title));
    card.append(el('p', '', copy));
    build(card);
    return card;
  }

  function buildSeq() {
    const pageNode = el('div', 'page page-seq');
    pageNode.dataset.page = 'seq';
    const transport = el('div', 'transport');
    playBtn = el('button', 'play', 'PLAY');
    playBtn.type = 'button';
    playBtn.addEventListener('click', () => sequencer.toggle());
    const stop = el('button', 'texty', 'Stop');
    stop.type = 'button';
    stop.addEventListener('click', () => sequencer.stop());
    const clear = el('button', 'texty', 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      state.seq.steps.forEach((step) => { step.on = false; });
      schedule();
      syncSteps();
    });
    transport.append(playBtn, stop, clear);
    const bpm = el('div');
    addKnob(bpm, { path: 'seq.bpm', label: 'BPM', min: 60, max: 180, step: 1, def: 120, format: (v) => String(Math.round(v)) });
    const swing = el('div');
    addKnob(swing, { path: 'seq.swing', label: 'SWING', min: 0, max: 0.55, def: 0, format: (v) => Math.round(v * 100) });
    transport.append(bpm, swing);
    addSelect(transport, { path: 'seq.division', options: [['1', '1/4'], ['0.5', '1/8'], ['0.25', '1/16'], ['0.1667', '1/16T']], numeric: true });
    addSelect(transport, { path: 'seq.length', options: [['8', '8 steps'], ['16', '16 steps']], numeric: true });
    addSelect(transport, { path: 'seq.target', options: [['A', 'Layer A'], ['B', 'Layer B'], ['both', 'A + B']] });
    stepGrid = el('div', 'steps');
    for (let i = 0; i < 16; i++) stepGrid.append(stepColumn(i));
    const gates = el('div', 'gate-row');
    addSwitch(gates, { path: 'seq.gateOn', label: 'RHYTHM GATE' });
    const depth = el('div');
    addKnob(depth, { path: 'seq.gateDepth', label: 'DEPTH', min: 0, max: 1, def: 0.85, format: (v) => Math.round(v * 100) });
    gateSlots = el('div', 'slots');
    for (let i = 0; i < 16; i++) {
      const button = el('button', 'mini', String(i + 1));
      button.type = 'button';
      button.addEventListener('click', () => {
        state.seq.gates[i] = !state.seq.gates[i];
        schedule();
        syncGates();
      });
      gateSlots.append(button);
    }
    gates.append(depth, gateSlots);
    pageNode.append(transport, stepGrid, gates);
    return { page: pageNode };
  }

  function stepColumn(index) {
    const col = el('div', 'step');
    const lane = el('div', 'lane');
    const bar = el('i', 'bar');
    const name = el('em', 'nm', 'C4');
    lane.append(bar, name);
    const drag = (event) => {
      const rect = lane.getBoundingClientRect();
      const ratio = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
      state.seq.steps[index].note = clamp(Math.round(36 + ratio * 48), 36, 84);
      state.seq.steps[index].on = true;
      schedule();
      syncStep(index);
    };
    lane.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      lane.setPointerCapture(event.pointerId);
      drag(event);
    });
    lane.addEventListener('pointermove', (event) => {
      if (lane.hasPointerCapture(event.pointerId)) drag(event);
    });
    const gate = el('button', 'mini gate', String(index + 1));
    gate.type = 'button';
    gate.addEventListener('click', () => {
      state.seq.steps[index].on = !state.seq.steps[index].on;
      schedule();
      syncStep(index);
    });
    const accent = el('button', 'mini', 'ACC');
    accent.type = 'button';
    accent.addEventListener('click', () => {
      state.seq.steps[index].accent = !state.seq.steps[index].accent;
      schedule();
      syncStep(index);
    });
    const slide = el('button', 'mini', 'SLD');
    slide.type = 'button';
    slide.addEventListener('click', () => {
      state.seq.steps[index].slide = !state.seq.steps[index].slide;
      schedule();
      syncStep(index);
    });
    col.append(lane, gate, accent, slide);
    return col;
  }

  function syncStep(index) {
    const col = stepGrid.children[index];
    const step = state.seq.steps[index];
    const ratio = clamp((step.note - 36) / 48, 0, 1);
    col.querySelector('.bar').style.height = Math.max(4, ratio * 100) + '%';
    col.querySelector('.nm').textContent = noteName(step.note);
    col.classList.toggle('off', !step.on);
    col.classList.toggle('dim', index >= state.seq.length);
    col.children[1].classList.toggle('on', !!step.on);
    col.children[2].classList.toggle('on', !!step.accent);
    col.children[3].classList.toggle('on', !!step.slide);
  }

  function syncSteps() {
    for (let i = 0; i < 16; i++) syncStep(i);
    markPlayhead(playhead);
  }

  function syncGates() {
    [...gateSlots.children].forEach((button, i) => button.classList.toggle('on', state.seq.gates[i] !== false));
  }

  function markPlayhead(index) {
    [...stepGrid.children].forEach((col, i) => col.classList.toggle('now', i === index));
  }

  const sequencer = {
    playing: false,
    timer: 0,
    step: 0,
    next: 0,
    toggle() {
      if (this.playing) this.stop();
      else this.start();
    },
    start() {
      onGesture(() => {
        this.playing = true;
        this.step = 0;
        this.next = engine.ctx.currentTime + 0.06;
        clearInterval(this.timer);
        this.timer = setInterval(() => this.pump(), 20);
        playBtn.classList.add('on');
        playBtn.textContent = 'PLAY';
      });
    },
    stop() {
      this.playing = false;
      playhead = -1;
      clearInterval(this.timer);
      if (engine.ready) {
        engine.noteOff('seq-A');
        engine.noteOff('seq-B');
        engine.setGate(1);
      }
      if (playBtn) {
        playBtn.classList.remove('on');
        markPlayhead(-1);
      }
    },
    pump() {
      if (!this.playing || !engine.ctx) return;
      const seq = state.seq;
      const beat = 60 / seq.bpm;
      const base = beat * Number(seq.division || 0.25);
      const swing = clamp(seq.swing || 0, 0, 0.55);
      let guard = 0;
      while (this.next < engine.ctx.currentTime + 0.12 && guard++ < 8) {
        const interval = this.step % 2 === 0 ? base * (1 + swing) : base * (1 - swing);
        this.fire(this.step, this.next, Math.max(0.03, interval));
        this.next += Math.max(0.03, interval);
        this.step = (this.step + 1) % seq.length;
      }
    },
    fire(index, time, interval) {
      playhead = index;
      markPlayhead(index);
      const seq = state.seq;
      if (seq.gateOn) {
        const open = seq.gates[index] !== false;
        engine.setGate(open ? 1 : 1 - (seq.gateDepth || 0), time);
      } else engine.setGate(1, time);
      const step = seq.steps[index];
      const targets = seq.target === 'both' ? ['A', 'B'] : [seq.target];
      if (!step || !step.on) {
        engine.noteOff('seq-A', time);
        engine.noteOff('seq-B', time);
        return;
      }
      const next = seq.steps[(index + 1) % seq.length];
      const slide = !!(step.slide && next && next.on);
      const vel = clamp((step.vel || 100) + (step.accent ? 24 : 0), 1, 127);
      const glide = slide ? Math.max(0.05, state.glide || 0.08) : 0;
      ['A', 'B'].forEach((id) => {
        const voiceId = 'seq-' + id;
        if (!targets.includes(id) || !state.layers[id].enabled) {
          engine.noteOff(voiceId, time);
          return;
        }
        engine.noteOn(voiceId, step.note, vel, { layer: id, time, glide, legato: slide });
        if (!slide) engine.noteOff(voiceId, time + interval * 0.9);
      });
    }
  };

  function buildBed() {
    const main = el('div', 'bed-main');
    const oct = el('div', 'oct');
    const up = el('button', '', '▲');
    const downBtn = el('button', '', '▼');
    const label = el('b', '', 'C4');
    label.id = 'octLabel';
    up.type = 'button';
    downBtn.type = 'button';
    up.addEventListener('click', () => setOctave(octave + 1));
    downBtn.addEventListener('click', () => setOctave(octave - 1));
    oct.append(up, label, downBtn);
    const pitch = el('div', 'wheel pitch');
    pitchCap = el('div', 'wheel-cap');
    pitch.append(pitchCap, el('span', '', 'PITCH'));
    wireWheel(pitch, 'pitch');
    const mod = el('div', 'wheel mod');
    modCap = el('div', 'wheel-cap');
    mod.append(modCap, el('span', '', 'MOD'));
    wireWheel(mod, 'mod');
    const keys = el('div', 'keys');
    keys.id = 'keys';
    main.append(oct, pitch, mod, keys);
    footer.append(main, el('div', 'hint', 'A W S E D F T G Y H U J K play · Z/X octave · Space sequencer · Esc panic · Shift fine-drag · double-click resets a knob'));
    buildKeys();
    placeWheels();
  }

  function wireWheel(node, kind) {
    let drag = null;
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      onGesture();
      node.setPointerCapture(event.pointerId);
      drag = event.clientY;
      move(event);
    });
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    function move(event) {
      if (!node.hasPointerCapture(event.pointerId)) return;
      const rect = node.getBoundingClientRect();
      const ratio = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
      if (kind === 'pitch') setPitch(ratio * 2 - 1);
      else setMod(ratio);
      drag = event.clientY;
    }
    function release(event) {
      if (kind !== 'pitch') return;
      const spring = () => {
        pitchValue *= 0.72;
        if (Math.abs(pitchValue) < 0.01) pitchValue = 0;
        if (engine.ready) engine.bend(pitchValue);
        placeWheels();
        if (pitchValue !== 0) requestAnimationFrame(spring);
      };
      requestAnimationFrame(spring);
    }
  }

  function placeWheels() {
    if (!pitchCap) return;
    pitchCap.style.top = (8 + (1 - (pitchValue + 1) / 2) * 68) + '%';
    modCap.style.top = (8 + (1 - modValue) * 68) + '%';
  }

  function setPitch(value) {
    pitchValue = clamp(value, -1, 1);
    placeWheels();
    if (engine.ready) engine.bend(pitchValue);
  }

  function setMod(value) {
    modValue = clamp(value, 0, 1);
    placeWheels();
    if (engine.ready) engine.mod(modValue);
  }

  function buildKeys() {
    const host = plugin.querySelector('#keys');
    host.replaceChildren();
    const base = 12 * (octave + 1);
    const whites = [];
    for (let midi = base; midi <= base + 24; midi++) {
      if ([0, 2, 4, 5, 7, 9, 11].includes(midi % 12)) whites.push(midi);
    }
    const whiteW = 100 / whites.length;
    whites.forEach((midi, index) => {
      const key = el('button', 'white');
      key.type = 'button';
      key.tabIndex = -1;
      key.dataset.note = String(midi);
      key.style.left = (index * whiteW) + '%';
      key.style.width = (whiteW - 0.35) + '%';
      if (midi % 12 === 0) key.append(el('span', 'key-label', noteName(midi)));
      host.append(key);
    });
    const blackOffset = { 1: 0.64, 3: 1.7, 6: 3.64, 8: 4.72, 10: 5.76 };
    for (let midi = base; midi < base + 24; midi++) {
      const semi = midi % 12;
      if (blackOffset[semi] == null) continue;
      const octaveIndex = Math.floor((midi - base) / 12);
      const key = el('button', 'black');
      key.type = 'button';
      key.tabIndex = -1;
      key.dataset.note = String(midi);
      key.style.left = ((octaveIndex * 7 + blackOffset[semi]) * whiteW - whiteW * 0.3) + '%';
      key.style.width = (whiteW * 0.6) + '%';
      host.append(key);
    }
    host.onpointerdown = (event) => {
      if (event.button !== 0) return;
      host.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, null);
      const start = () => glideTo(event);
      if (!engine.ready) onGesture(start);
      else start();
    };
    host.onpointermove = glideTo;
    host.onpointerup = endPointer;
    host.onpointercancel = endPointer;
    plugin.querySelector('#octLabel').textContent = 'C' + octave;
    for (const midi of down.keys()) paintKey(midi, true);
  }

  function glideTo(event) {
    if (!pointers.has(event.pointerId)) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const key = hit && hit.closest ? hit.closest('[data-note]') : null;
    const note = key ? Number(key.dataset.note) : null;
    const prev = pointers.get(event.pointerId);
    if (prev === note) return;
    if (prev != null) endNote(prev);
    if (note != null) beginNote(note, 108);
    pointers.set(event.pointerId, note);
  }

  function endPointer(event) {
    const prev = pointers.get(event.pointerId);
    if (prev != null) endNote(prev);
    pointers.delete(event.pointerId);
  }

  function setOctave(value) {
    octave = clamp(value, 1, 7);
    buildKeys();
  }

  function beginNote(midi, vel) {
    const existing = down.get(midi);
    if (existing) {
      existing.count++;
      paintKey(midi, true);
      return;
    }
    let legato = false;
    while (order.length >= state.polyphony) {
      legato = state.polyphony === 1 && state.glide > 0;
      const old = order.shift();
      down.delete(old);
      sendOff(old);
      paintKey(old, false);
    }
    down.set(midi, { count: 1 });
    order.push(midi);
    sendOn(midi, vel, legato ? state.glide : 0, legato);
    paintKey(midi, true);
  }

  function endNote(midi) {
    const existing = down.get(midi);
    if (!existing) return;
    existing.count--;
    if (existing.count > 0) return;
    down.delete(midi);
    const at = order.indexOf(midi);
    if (at >= 0) order.splice(at, 1);
    sendOff(midi);
    paintKey(midi, false);
  }

  function sendOn(midi, vel, glide, legato) {
    if (!engine.ready) return;
    ['A', 'B'].forEach((id) => {
      if (!state.layers[id].enabled) return;
      engine.noteOn('key-' + midi + id, midi, vel, { layer: id, glide, legato });
    });
  }

  function sendOff(midi) {
    if (!engine.ready) return;
    engine.noteOff('key-' + midi + 'A');
    engine.noteOff('key-' + midi + 'B');
  }

  function releaseLayer(id) {
    for (const midi of down.keys()) engine.noteOff('key-' + midi + id);
    engine.noteOff('seq-' + id);
  }

  function paintKey(midi, on) {
    const key = plugin.querySelector('[data-note="' + midi + '"]');
    if (key) key.classList.toggle('on', on);
  }

  function buildOverlay() {
    overlay.innerHTML = '';
    const card = el('div', 'overlay-card');
    card.append(el('strong', '', 'CONTINUUM'));
    card.append(el('em', '', 'MOSAIC'));
    card.append(el('p', '', 'Click or press a key to start audio'));
    const button = el('button', '', 'START');
    button.type = 'button';
    card.append(button);
    const err = el('div', 'boot-error');
    err.id = 'bootError';
    card.append(err);
    overlay.append(card);
    overlay.addEventListener('click', () => onGesture());
  }

  function buildModal() {
    const dialog = el('form', 'dialog');
    dialog.append(el('h3', '', 'Save preset'));
    nameInput = el('input');
    nameInput.maxLength = 48;
    nameInput.required = true;
    nameInput.autocomplete = 'off';
    const actions = el('div', 'actions');
    const ok = el('button', '', 'Save');
    ok.type = 'submit';
    const cancel = el('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { modal.hidden = true; });
    actions.append(cancel, ok);
    dialog.append(nameInput, actions);
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      storePreset(name);
      modal.hidden = true;
    });
    modal.append(dialog);
  }

  function openSave() {
    nameInput.value = state.name || 'My preset';
    modal.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  function storePreset(name) {
    const id = 'user:' + Date.now();
    state.name = name;
    user.push({ id, name, state: clone(state) });
    saveUserPresets(user);
    currentId = id;
    saveLastId(id);
    nameBtn.textContent = name;
    schedule();
  }

  function fillMenu() {
    menu.replaceChildren();
    menu.append(el('div', 'group', 'FACTORY'));
    FACTORY.forEach((preset) => menu.append(menuItem('factory:' + preset.name, preset.name, false)));
    menu.append(el('div', 'group', 'USER'));
    if (!user.length) menu.append(el('div', 'note', 'No saved presets yet.'));
    user.forEach((preset) => menu.append(menuItem(preset.id, preset.name, true)));
    const foot = el('div', 'group', 'FILE');
    menu.append(foot);
    const exp = el('button', '', 'Export current JSON');
    exp.type = 'button';
    exp.addEventListener('click', exportPreset);
    menu.append(exp);
  }

  function menuItem(id, name, removable) {
    const button = el('button', id === currentId ? 'on' : '');
    button.type = 'button';
    const label = el('span', '', name);
    button.append(label);
    if (removable) {
      const kill = el('span', 'kill', '✕');
      kill.addEventListener('click', (event) => {
        event.stopPropagation();
        const at = user.findIndex((preset) => preset.id === id);
        if (at >= 0) user.splice(at, 1);
        saveUserPresets(user);
        if (currentId === id) loadPreset('factory:Init');
        fillMenu();
      });
      button.append(kill);
    } else button.append(el('span', 'tag', 'FACTORY'));
    button.addEventListener('click', () => {
      loadPreset(id);
      menu.hidden = true;
    });
    return button;
  }

  function catalog() {
    return [
      ...FACTORY.map((preset) => ({ id: 'factory:' + preset.name, name: preset.name })),
      ...user.map((preset) => ({ id: preset.id, name: preset.name }))
    ];
  }

  function stepPreset(dir) {
    const list = catalog();
    let index = list.findIndex((preset) => preset.id === currentId);
    if (index < 0) index = 0;
    index = (index + dir + list.length) % list.length;
    loadPreset(list[index].id);
  }

  function loadPreset(id) {
    state = recall(id, user);
    currentId = id;
    saveLastId(id);
    schedule();
    paintAll();
  }

  function exportPreset() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'continuum-mosaic-' + (state.name || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    document.body.append(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1500);
    menu.hidden = true;
  }

  function importFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    file.text().then((text) => {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        data.forEach((preset, index) => {
          if (!preset || typeof preset !== 'object') return;
          const name = preset.name || 'Imported ' + (index + 1);
          const body = preset.state && preset.state.layers ? preset.state : preset;
          user.push({ id: 'user:' + Date.now() + '-' + index, name, state: normalize(body) });
        });
        saveUserPresets(user);
        statusNode.textContent = 'Imported ' + data.length;
        return;
      }
      const body = data.state && data.state.layers ? data.state : data;
      if (!body.layers) throw new Error('Not a Continuum preset');
      state = normalize(body);
      state.name = data.name || body.name || 'Imported';
      const id = 'user:' + Date.now();
      user.push({ id, name: state.name, state: clone(state) });
      saveUserPresets(user);
      currentId = id;
      saveLastId(id);
      schedule();
      paintAll();
      statusNode.textContent = 'Imported';
    }).catch((err) => {
      statusNode.textContent = err.message || 'Import failed';
    });
  }

  function pathOf(path) {
    return path.replace('$.', editLayer + '.');
  }

  function getPath(path) {
    return pathOf(path).split('.').reduce((node, key) => node[key], state);
  }

  function setPath(path, value) {
    const parts = pathOf(path).split('.');
    let node = state;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
    const numeric = typeof node[parts[parts.length - 1]] === 'number';
    node[parts[parts.length - 1]] = numeric && typeof value === 'string' ? Number(value) : value;
  }

  function schedule() {
    saveLastState(state);
    if (pushFrame) return;
    pushFrame = requestAnimationFrame(() => {
      pushFrame = 0;
      engine.setState(state);
    });
  }

  function addKnob(parent, spec) {
    const node = el('div', 'knob');
    node.tabIndex = 0;
    node.innerHTML = `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="track" cx="24" cy="24" r="16"></circle>
        <circle class="arc" cx="24" cy="24" r="16"></circle>
        <circle class="cap" cx="24" cy="24" r="10.5"></circle>
        <line class="needle" x1="24" y1="24" x2="24" y2="9"></line>
      </svg>
      <div class="kv"></div><div class="kl"></div>`;
    parent.append(node);
    const arc = node.querySelector('.arc');
    const track = node.querySelector('.track');
    const needle = node.querySelector('.needle');
    const value = node.querySelector('.kv');
    node.querySelector('.kl').textContent = spec.label;
    const sweep = 2 * Math.PI * 16 * 0.75;
    const gap = 2 * Math.PI * 16;
    track.style.strokeDasharray = sweep + ' ' + gap;
    track.setAttribute('transform', 'rotate(135 24 24)');
    arc.style.strokeDasharray = sweep + ' ' + gap;
    arc.setAttribute('transform', 'rotate(135 24 24)');
    const norm = (v) => {
      if (spec.log) return (Math.log(v) - Math.log(spec.min)) / (Math.log(spec.max) - Math.log(spec.min));
      return (v - spec.min) / (spec.max - spec.min);
    };
    const from = (n) => {
      const t = clamp(n, 0, 1);
      let next = spec.log ? Math.exp(Math.log(spec.min) + t * (Math.log(spec.max) - Math.log(spec.min))) : spec.min + t * (spec.max - spec.min);
      if (spec.step) next = Math.round(next / spec.step) * spec.step;
      return clamp(next, spec.min, spec.max);
    };
    const paint = () => {
      const raw = Number(getPath(spec.path));
      const current = Number.isFinite(raw) ? raw : spec.def;
      const n = clamp(norm(current), 0, 1);
      arc.style.strokeDashoffset = String(sweep * (1 - n));
      needle.setAttribute('transform', 'rotate(' + (-135 + n * 270) + ' 24 24)');
      value.textContent = spec.format ? spec.format(current) : String(current);
      node.setAttribute('aria-valuenow', String(current));
      node.setAttribute('aria-label', spec.label);
    };
    let drag = null;
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      node.setPointerCapture(event.pointerId);
      drag = { y: event.clientY, n: norm(Number(getPath(spec.path))) };
    });
    node.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const span = event.shiftKey ? 860 : 150;
      apply(from(drag.n + (drag.y - event.clientY) / span));
    });
    const end = () => { drag = null; };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('wheel', (event) => {
      event.preventDefault();
      const dir = event.deltaY > 0 ? -1 : 1;
      apply(from(norm(Number(getPath(spec.path))) + dir * (event.shiftKey ? 0.004 : 0.02)));
    }, { passive: false });
    node.addEventListener('dblclick', () => apply(spec.def));
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      const dir = event.key === 'ArrowUp' ? 1 : -1;
      apply(from(norm(Number(getPath(spec.path))) + dir * (event.shiftKey ? 0.005 : 0.025)));
    });
    function apply(next) {
      setPath(spec.path, next);
      schedule();
      widgets.forEach((widget) => { if (widget.path === spec.path) widget.paint(); });
      if (spec.path.startsWith('seq.')) syncSteps();
    }
    widgets.push({ path: spec.path, paint });
    paint();
    return node;
  }

  function addSegments(parent, spec) {
    const row = el('div', 'segs');
    spec.options.forEach(([value, label]) => {
      const button = el('button', '', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        setPath(spec.path, value);
        schedule();
        paintAll();
      });
      row.append(button);
    });
    parent.append(row);
    widgets.push({
      path: spec.path,
      paint() {
        const current = getPath(spec.path);
        [...row.children].forEach((button, index) => button.classList.toggle('on', spec.options[index][0] === current));
      }
    });
  }

  function addSwitch(parent, spec) {
    const button = el('button', 'switch', spec.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const next = !getPath(spec.path);
      setPath(spec.path, next);
      if (spec.onToggle) spec.onToggle(next);
      schedule();
      paintAll();
    });
    parent.append(button);
    widgets.push({
      path: spec.path,
      paint() {
        const on = !!getPath(spec.path);
        button.classList.toggle('on', on);
        if (spec.liveLabel) button.textContent = on ? 'ON' : 'OFF';
      }
    });
  }

  function addSelect(parent, spec) {
    const select = el('select', 'slim');
    spec.options.forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      select.append(option);
    });
    select.addEventListener('change', () => {
      setPath(spec.path, spec.numeric ? Number(select.value) : select.value);
      schedule();
      if (String(spec.path).startsWith('seq.')) syncSteps();
    });
    parent.append(select);
    widgets.push({
      path: spec.path,
      paint() {
        const current = getPath(spec.path);
        const asText = spec.numeric ? matchNumeric(spec.options, current) : String(current);
        select.value = asText;
      }
    });
  }

  function matchNumeric(options, value) {
    let best = options[0][0];
    let score = Infinity;
    options.forEach(([option]) => {
      const delta = Math.abs(Number(option) - Number(value));
      if (delta < score) {
        score = delta;
        best = option;
      }
    });
    return best;
  }

  function paintAll() {
    widgets.forEach((widget) => widget.paint());
    nameBtn.textContent = state.name || 'Init';
    plugin.classList.toggle('layer-b', editLayer === 'B');
    const chip = plugin.querySelector('#layerChip');
    if (chip) chip.textContent = 'EDITING ' + editLayer;
    [...tabs.querySelectorAll('[data-edit]')].forEach((button) => button.classList.toggle('on', button.dataset.edit === editLayer));
    if (stepGrid) {
      syncSteps();
      syncGates();
    }
  }

  function onGesture(after) {
    const pending = engine.ensure(state).then(() => {
      if (!engine.ctx || engine.ctx.state === 'suspended') {
        overlay.hidden = false;
        statusNode.textContent = 'Click START to enable audio';
        const box = plugin.querySelector('#bootError');
        if (box) box.textContent = 'The browser blocked audio. Click START.';
        return;
      }
      overlay.hidden = true;
      statusNode.textContent = 'Audio on';
      if (!midiLive) {
        midiLive = true;
        bindMidi({
          status(text) {
            midiDot.title = text || '';
            const connected = !!text && text !== 'No MIDI' && text !== 'MIDI blocked';
            midiDot.classList.toggle('live', connected);
          },
          message: onMidi
        });
      }
      engine.setState(state);
      if (after) after();
    }).catch((err) => {
      const box = plugin.querySelector('#bootError');
      if (box) box.textContent = err && err.message ? err.message : 'Audio failed to start';
      overlay.hidden = false;
      statusNode.textContent = 'Audio error';
    });
    return pending;
  }

  function onMidi(data) {
    const status = data[0] & 0xf0;
    const d1 = data[1];
    const d2 = data[2] || 0;
    if (status === 0x90 && d2 > 0) beginNote(d1, d2);
    else if (status === 0x80 || (status === 0x90 && d2 === 0)) endNote(d1);
    else if (status === 0xe0) setPitch((((d2 << 7) | d1) - 8192) / 8192);
    else if (status === 0xb0 && d1 === 1) setMod(d2 / 127);
    else if (status === 0xb0 && d1 === 64) engine.sustain(d2 >= 64);
  }

  window.addEventListener('keydown', (event) => {
    if (isTyping(event)) return;
    if (event.code === 'Space') {
      const tag = event.target && event.target.tagName;
      if (tag === 'BUTTON' || (event.target.closest && event.target.closest('.knob'))) return;
      event.preventDefault();
      sequencer.toggle();
      return;
    }
    if (event.code === 'Escape') {
      engine.panic();
      down.clear();
      order.length = 0;
      heldKeys.clear();
      plugin.querySelectorAll('.white.on, .black.on').forEach((key) => key.classList.remove('on'));
      return;
    }
    if (event.code === 'KeyZ' && !event.repeat) { setOctave(octave - 1); return; }
    if (event.code === 'KeyX' && !event.repeat) { setOctave(octave + 1); return; }
    const index = KEYS.indexOf(event.code);
    if (index < 0 || event.repeat || heldKeys.has(event.code)) return;
    event.preventDefault();
    const midi = 12 * (octave + 1) + index;
    heldKeys.set(event.code, midi);
    const play = () => {
      if (heldKeys.get(event.code) !== midi) return;
      beginNote(midi, 104);
    };
    if (!engine.ready) onGesture(play);
    else play();
  });

  window.addEventListener('keyup', (event) => {
    const midi = heldKeys.get(event.code);
    if (midi == null) return;
    heldKeys.delete(event.code);
    endNote(midi);
  });

  engine.onMeter = (meter) => {
    voiceNode.textContent = String(meter.voices);
    cpuNode.firstChild.style.width = Math.round(clamp(meter.cpu, 0, 1) * 100) + '%';
    scope = meter.scope;
  };

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    oscVis += dt * 0.45;
    lfoVis[0] += dt * (state.lfo[0].rate || 0);
    lfoVis[1] += dt * (state.lfo[1].rate || 0);
    if (page === 'play') {
      plugin.querySelectorAll('canvas.display[data-osc]').forEach((canvas) => {
        const index = Number(canvas.dataset.osc);
        const osc = state.layers[editLayer].osc[index];
        if (osc) drawWave(canvas, osc, oscVis);
      });
      const filter = plugin.querySelector('canvas.filter');
      if (filter) drawFilter(filter, state.layers[editLayer].filter);
      plugin.querySelectorAll('canvas.env').forEach((canvas) => drawEnv(canvas, state.layers[editLayer][canvas.dataset.env]));
      plugin.querySelectorAll('canvas.lfo').forEach((canvas) => {
        const index = Number(canvas.dataset.lfo);
        drawLfo(canvas, state.lfo[index].wave, lfoVis[index]);
      });
    }
    if (scopeCanvas && scope) drawScope(scopeCanvas, scope);
    requestAnimationFrame(frame);
  }

  function prep(canvas) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.floor(width * dpr);
    const bh = Math.floor(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, width, height };
  }

  function accent() {
    return getComputedStyle(plugin).getPropertyValue('--accent').trim() || '#e2a84a';
  }

  function drawWave(canvas, osc, phase) {
    const view = prep(canvas);
    if (!view || !osc) return;
    const { g, width, height } = view;
    g.clearRect(0, 0, width, height);
    g.strokeStyle = accent();
    g.lineWidth = 1.4;
    g.beginPath();
    for (let x = 0; x <= width; x++) {
      const t = (x / width * 2 + phase) % 1;
      let y;
      if (osc.wave === 'square') y = t < (osc.pwm || 0.5) ? 1 : -1;
      else if (osc.wave === 'triangle') y = t < 0.5 ? t * 4 - 1 : 3 - t * 4;
      else if (osc.wave === 'sine') y = Math.sin(t * Math.PI * 2);
      else y = 2 * ((t + 0.5) % 1) - 1;
      const py = height / 2 - y * height * 0.36;
      if (x === 0) g.moveTo(x, py);
      else g.lineTo(x, py);
    }
    g.stroke();
  }

  function drawFilter(canvas, filter) {
    const view = prep(canvas);
    if (!view) return;
    const { g, width, height } = view;
    g.clearRect(0, 0, width, height);
    g.strokeStyle = '#243044';
    g.beginPath();
    g.moveTo(0, height / 2);
    g.lineTo(width, height / 2);
    g.stroke();
    const q = 0.7 + filter.res * filter.res * 16;
    g.strokeStyle = accent();
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= width; x++) {
      const f = 30 * Math.pow(14000 / 30, x / width);
      const mag = filterMag(filter.type, f, filter.cutoff, q, filter.comb || 0);
      const db = 20 * Math.log10(Math.max(mag, 0.001));
      const y = height * 0.55 - db / 36 * height * 0.45;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  function drawEnv(canvas, env) {
    const view = prep(canvas);
    if (!view) return;
    const { g, width, height } = view;
    g.clearRect(0, 0, width, height);
    const hold = 0.45;
    const total = env.a + env.d + hold + env.r;
    const xAt = (time) => (time / total) * (width - 8) + 4;
    const yAt = (level) => height - 6 - level * (height - 14);
    g.beginPath();
    g.moveTo(4, yAt(0));
    g.lineTo(xAt(env.a), yAt(1));
    g.lineTo(xAt(env.a + env.d), yAt(env.s));
    g.lineTo(xAt(env.a + env.d + hold), yAt(env.s));
    g.lineTo(xAt(total), yAt(0));
    g.strokeStyle = accent();
    g.lineWidth = 1.5;
    g.stroke();
  }

  function drawLfo(canvas, wave, phase) {
    const view = prep(canvas);
    if (!view) return;
    const { g, width, height } = view;
    g.clearRect(0, 0, width, height);
    g.strokeStyle = '#6ee0d2';
    g.lineWidth = 1.4;
    g.beginPath();
    const p = phase % 1;
    for (let x = 0; x <= width; x++) {
      const t = (x / width + p) % 1;
      let y = Math.sin(t * Math.PI * 2);
      if (wave === 'square') y = t < 0.5 ? 1 : -1;
      else if (wave === 'saw') y = 2 * t - 1;
      else if (wave === 'triangle') y = t < 0.5 ? t * 4 - 1 : 3 - t * 4;
      else if (wave === 'sample') y = (Math.floor((t + p) * 8) % 2 === 0) ? 0.7 : -0.7;
      const py = height / 2 - y * height * 0.34;
      if (x === 0) g.moveTo(x, py);
      else g.lineTo(x, py);
    }
    g.stroke();
  }

  function drawScope(canvas, data) {
    const view = prep(canvas);
    if (!view) return;
    const { g, width, height } = view;
    g.clearRect(0, 0, width, height);
    g.strokeStyle = '#e2a84a';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width;
      const y = height / 2 - data[i] * height * 0.45;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function isTyping(event) {
  const target = event.target;
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function hz(value) {
  if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 1 : 2) + 'k';
  return String(Math.round(value));
}

function seconds(value) {
  if (value >= 1) return value.toFixed(2) + 's';
  return Math.round(value * 1000) + 'ms';
}

function signed(value) {
  const text = value.toFixed(2);
  return value > 0 ? '+' + text : text;
}

function filterMag(type, f, cutoff, q, comb) {
  const w = f / Math.max(30, cutoff);
  const r = w * w;
  const denom = Math.sqrt((1 - r) * (1 - r) + Math.pow(w / q, 2)) || 1;
  if (type === 'highpass') return r / denom;
  if (type === 'bandpass') return (w / q) / denom;
  if (type === 'notch') return Math.abs(1 - r) / denom;
  if (type === 'comb') return Math.abs((1 - comb) / (1 - comb * Math.cos(Math.PI * Math.min(w, 8))));
  return 1 / denom;
}
