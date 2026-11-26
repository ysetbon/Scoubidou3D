// The functions a level can be asked to run on itself.
//
// The studio's Functions view (panel.ts `functionsList`) draws one section per
// storey and, in each, one row per entry of `LEVEL_FUNCTIONS` below. That list
// is the whole of what the view knows: a function is a name, a line saying what
// it does, and a `run` that takes a scene and a level and hands back the scene
// it would leave. Nothing in the panel is written for Stretch in particular.
//
// TO ADD ONE: write it as a pure function of `(scene, level)` that returns a NEW
// scene — never edits the one it was given, so the panel can throw the result
// away, play it as a motion, or record it as one undo step — wrap it in a
// `LevelFunction`, and add it to the list. It gets a row on every level.
//
// A function works on ONE level because that is what a level is: the strands of
// one storey are woven with each other and with nothing else (levels.ts), so a
// storey is the largest piece of a scene something can be done to without
// reaching through a level break.

import { levelAt } from './levels';
import { stretchLevel } from './stretch';
import { Scene3D } from './types';

/** What the view passes down from the canvas's own settings. */
export interface LevelFunctionContext {
  /** RenderParams.thirdControlPoint — whether a locked centre shapes a curve. */
  thirdEnabled: boolean;
  /** RenderParams.widthScale — how wide the ribbons are drawn. */
  widthScale: number;
  /** How many in-between scenes to hand back for the motion; 0 for none. */
  frames: number;
}

export interface LevelFunctionOutcome {
  /** The scene afterwards. The one passed in is never touched. */
  scene: Scene3D;
  /** In-between scenes, first to last, when the function can show its work. */
  frames: Scene3D[];
  /** False when the function found nothing to do; `scene` is then the input. */
  changed: boolean;
  /** One line for the row and the toast: what happened, in numbers. */
  summary: string;
  /** True when the line is a caveat rather than a result. */
  warn: boolean;
}

export interface LevelFunction {
  /** Stable id: the row's focus slot and the key its last result is kept under. */
  key: string;
  /** The button. */
  label: string;
  /** What the history calls it: "Undo stretch level 2". */
  verb: string;
  /** One line under the name, saying what pressing it does. */
  note: string;
  /** The longer version, for the tooltip. */
  title: string;
  /** Which mark the panel draws on the button (panel.ts `FUNCTION_ICONS`). */
  icon: 'stretch';
  run(scene: Scene3D, level: number, ctx: LevelFunctionContext): LevelFunctionOutcome;
}

/** How many strands rest on a storey — what a function there would work on. */
export function strandsOnLevel(scene: Scene3D, level: number): number {
  let n = 0;
  scene.strands.forEach((s, i) => {
    if (!s.isMask && levelAt(scene, i) === level) n++;
  });
  return n;
}

const px = (v: number): string => `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)} px`;
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * STRETCH — pull the level's knot tight. See stretch.ts for what that means and
 * how it is found; this is only the sentence it is reported in.
 */
const STRETCH: LevelFunction = {
  key: 'stretch',
  label: 'Stretch',
  verb: 'stretch',
  note: 'Pull the knot tight: strands straighten, folds close up, arms sit a gap apart.',
  title:
    'Pull this level tight. Every strand that can be straight becomes straight, each fold ' +
    'closes up to the strand it wraps, side-by-side arms settle one gap apart, and the slack ' +
    'comes out through the loose ends. The crossings stay exactly as drawn.',
  icon: 'stretch',
  run(scene, level, ctx) {
    const { scene: out, report, frames } = stretchLevel(scene, level, {
      thirdEnabled: ctx.thirdEnabled,
      widthScale: ctx.widthScale,
      frames: ctx.frames,
    });
    if (!report.changed) {
      const summary =
        report.movable === 0
          ? 'Nothing here is free to move — every end is held by another level.'
          : report.overlapBefore > 0.05
            ? `As tight as it goes: ${px(report.overlapBefore)} of overlap is held by what pins it.`
            : 'Already fully stretched.';
      return { scene, frames: [], changed: false, summary, warn: false };
    }
    const parts: string[] = [`${count(report.crossings, 'crossing')} kept`];
    if (report.straightened) parts.push(`${count(report.straightened, 'strand')} straightened`);
    if (report.bent) parts.push(`${count(report.bent, 'bend')} it needs`);
    if (report.slack > 0.5) parts.push(`${px(report.slack)} of slack pulled out`);
    else if (report.slack < -0.5) parts.push(`opened ${px(-report.slack)} to clear itself`);
    let summary = `Stretched: ${parts.join(', ')}.`;
    let warn = false;
    if (report.overlapAfter > 0.05) {
      summary += ` ${px(report.overlapAfter)} of overlap is left, held by what pins this level.`;
      warn = true;
    } else if (report.cutShort) {
      summary += ' Stopped early on a big level — press again to carry on.';
      warn = true;
    }
    return { scene: out, frames, changed: true, summary, warn };
  },
};

/** Every function a level offers, in the order the rows are drawn. */
export const LEVEL_FUNCTIONS: LevelFunction[] = [STRETCH];
