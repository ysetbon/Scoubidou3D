// Scoubidou3D entry point: wire the Three.js scene to the control panel and
// load an opening sample so there's something to orbit immediately.

import './styles.css';
import { StrandScene } from './scene/StrandScene';
import { Panel } from './ui/panel';
import { SAMPLES, makeSample } from './model/samples';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panelRoot = document.getElementById('panel') as HTMLElement;

// `?sample=<key>` opens a named built-in instead of the default, so the project
// site can link a card straight at the scene it is showing a picture of. An
// unknown key is ignored rather than erroring — a stale bookmark should still
// land you in a working app.
// The six-member version rather than the two bare laces: bare laces have no
// joint and so no FOLD, which means the opening screen could not show the
// storey turn at all. The turn is the part most likely to regress, so it is
// what the app opens on.
//
// NOT `box-and-strand`, which is the same scene plus a seventh strand and comes
// with planes already declared. It is the best demonstration of the plane work
// and the worst thing to open on: an opening screen should show what the app
// does by default, and a scene that arrives placed cannot. It is one pick away
// in the dock, and `?sample=box-and-strand` links straight at it.
const DEFAULT_SAMPLE = 'two-crossing-arms';
const requested = new URLSearchParams(window.location.search).get('sample');
const opening = requested && Object.prototype.hasOwnProperty.call(SAMPLES, requested)
  ? requested
  : DEFAULT_SAMPLE;

const view = new StrandScene(canvas);
view.setScene(makeSample(opening));

const panel = new Panel(panelRoot, view, opening);

// Dev-only handle for automated UI tests (stripped from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __scoubidou?: unknown }).__scoubidou = { view, panel };
}
