// Scoubidou3D entry point: wire the Three.js scene to the control panel. The
// app opens on a clean, empty scene — StrandScene already starts on one — so
// nothing is drawn until you load a file or pick a sample yourself.

import './styles.css';
import { StrandScene } from './scene/StrandScene';
import { Panel } from './ui/panel';
import { SAMPLES, makeSample } from './model/samples';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panelRoot = document.getElementById('panel') as HTMLElement;

// `?sample=<key>` opens a named built-in, so the project site can link a card
// straight at the scene it is showing a picture of. An unknown key is ignored
// rather than erroring — a stale bookmark should still land you in a working
// app, just on the empty scene rather than a guessed one.
const requested = new URLSearchParams(window.location.search).get('sample');
const opening = requested && Object.prototype.hasOwnProperty.call(SAMPLES, requested)
  ? requested
  : null;

const view = new StrandScene(canvas);
if (opening) view.setScene(makeSample(opening));

const panel = new Panel(panelRoot, view, opening ?? 'empty');

// Dev-only handle for automated UI tests (stripped from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __scoubidou?: unknown }).__scoubidou = { view, panel };
}
