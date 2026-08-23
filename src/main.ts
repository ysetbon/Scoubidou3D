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
// what the app opens on — plus a seventh strand belonging to no lace, which is
// the case the plane work is judged against: `3_1` crosses `1_3` exactly once,
// and putting one exactly over the other is a statement about that one passage.
const DEFAULT_SAMPLE = 'arms-and-a-third';
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
