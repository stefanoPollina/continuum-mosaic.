import { Engine } from './engine.js';
import { mount } from './ui.js';

const engine = new Engine();
const stage = document.getElementById('stage');

try {
  mount(stage, engine);
} catch (err) {
  stage.textContent = err && err.stack ? err.stack : String(err);
}

window.addEventListener('error', (event) => {
  const node = document.getElementById('bootError');
  if (node) node.textContent = event.message || 'Script error';
});

window.addEventListener('unhandledrejection', (event) => {
  const node = document.getElementById('bootError');
  const reason = event.reason;
  const message = reason && reason.message ? reason.message : String(reason || 'Unhandled error');
  if (node) node.textContent = message;
});
