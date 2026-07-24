// Scoubidou3D entry point: wire the Three.js scene to the control panel and
// load an opening sample so there's something to orbit immediately.

import './styles.css';
import { StrandScene } from './scene/StrandScene';
import { Panel } from './ui/panel';
import { makeSample } from './model/samples';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panelRoot = document.getElementById('panel') as HTMLElement;

const view = new StrandScene(canvas);
view.setScene(makeSample('two-crossing'));

const panel = new Panel(panelRoot, view);

// Dev-only handle for automated UI tests (stripped from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __scoubidou?: unknown }).__scoubidou = { view, panel };
}
