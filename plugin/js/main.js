import { Engine } from './engine.js';
import { mount } from './ui.js';

const engine = new Engine();
const stage = document.getElementById('stage');
const bootNote = document.getElementById('bootNote');

try {
  mount(stage, engine);
  if (bootNote) bootNote.remove();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  if (bootNote) bootNote.textContent = message;
  else stage.textContent = message;
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
