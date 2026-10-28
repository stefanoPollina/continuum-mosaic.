# Continuum Mosaic — plugin test

This folder is a separate test. It does not replace the instrument at the repository root.

Open `plugin/index.html` (or serve the repository and visit `/plugin/`). Audio starts after a click or key press.

## Playing

- On-screen keyboard, click and drag for glissando
- Computer keys `A W S E D F T G Y H U J K`, octave with `Z` / `X`
- Web MIDI notes, pitch bend, mod wheel, and sustain when the browser allows it
- `Space` starts and stops the sequencer, `Esc` releases hanging notes
- Knobs drag vertically, Shift or the wheel for fine changes, double-click to reset

## Presets

Factory presets are in the header browser. Save stores a preset in this browser. The preset name opens the list, including JSON export. Load imports a JSON file and adds it to the saved list. The last edit is restored on the next visit.

## Layout

- **Play** — three oscillators, multimode filter, amp and filter envelopes, two LFOs, FM / phase distortion
- **Mod** — eight-slot modulation matrix aimed at layer A, layer B, or both
- **FX** — drive, phaser, delay, multiband delay, reverb, shimmer, compressor
- **Seq** — 16-step pattern with accent, slide, swing, and a rhythmic gate

Layers A and B are the two synthesis engines and can sound together.
