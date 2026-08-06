// Scoubidou3D entry point: wire the Three.js scene to the control panel and
// load an opening sample so there's something to orbit immediately.

import './styles.css';
import { StrandScene } from './scene/StrandScene';
import { Panel } from './ui/panel';
import { SAMPLES, makeSample } from './model/samples';
import { boxStitchMN } from './model/boxmn';
import { columnTurnRad, twoFanColumn } from './model/twofan';
import { swirlStitch } from './model/swirl';
import { swirlWorked } from './model/swirlWorked';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panelRoot = document.getElementById('panel') as HTMLElement;

// `?sample=<key>` opens a named built-in instead of the default, so the project
// site can link a card straight at the scene it is showing a picture of. An
// unknown key is ignored rather than erroring — a stale bookmark should still
// land you in a working app.
const DEFAULT_SAMPLE = 'two-crossing';
// A page that carries the studio rather than linking to it has no query string
// to set, so it names its opening sample on `window` instead. Same rule either
// way: an unknown key is ignored.
const requested =
  new URLSearchParams(window.location.search).get('sample') ??
  (window as unknown as { __scoubidouSample?: string }).__scoubidouSample ??
  null;
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

// A page that CARRIES the studio rather than linking to it — see artifacts/ —
// builds its own scenes and hands them over. This is the whole of that seam: the
// panel, and the three families' builders. The studio itself never reads it, so
// a page that ignores it behaves exactly as the app does.
//
// The three are not equally finished, and the seam does not pretend otherwise.
// A box takes any number of rounds and a twist any number of levels, both
// solved. `swirlStitch` is the block and ONE continuation, because what decides
// where a swirl's segment stops above that is still unknown; `swirlWorked` is
// the single scene that was carried further, by hand.
(window as unknown as { __scoubidouStudio?: unknown }).__scoubidouStudio = {
  panel,
  box: boxStitchMN,
  twist: twoFanColumn,
  twistTurn: columnTurnRad,
  swirl: swirlStitch,
  swirlWorked,
};
