// Undo and redo, recorded off the scene's own JSON.
//
// The rule, and the whole of it: a scene whose JSON does not look like the one
// last recorded is a new recording. Nothing else counts.
//
// That single test is what makes this hold together in an app where edits arrive
// from three unrelated places — the dock cards, the layer rows, and gestures on
// the canvas. None of them has to declare what it changed, and none of them has
// to describe an inverse: they change the scene, the scene is serialised, and if
// the text moved there is a state to step back to. An edit that lands on the
// state it started from — arming a weave pick and cancelling it, picking a
// handle up and dropping it back, straightening a strand that was already
// straight — writes the same text and so records nothing, which is right,
// because there is nothing there to undo.
//
// The camera is the exception the rule makes for itself rather than one written
// in. Orbit, Pan, zoom, Fit and Top change no strand, no mask and no level, so
// they write the same JSON and record nothing. Which is also why undo never
// moves the camera back: where you are looking from was never an edit, and
// stepping back through the work should not throw away the angle you found to
// watch it from.
//
// What is stored is the SNAPSHOT (`sceneToFile`), not the text. The text is the
// identity — it is what "look alike" is tested on — but restoring re-parses
// nothing: `sceneFromSnapshot` copies the record straight back, so a step puts
// the scene back exactly as it was rather than as a file reader would tidy it.

import { Scene3D } from './types';
import { SceneFile, sceneFromSnapshot, sceneToFile } from './sceneIO';

/**
 * A state worth recording: the scene, and which entry of the sample browser it
 * came from. The source travels with the scene because undoing past a load
 * should put the dropdown back too — otherwise the browser goes on highlighting
 * a sample you have stepped out of.
 */
export interface SceneState {
  scene: Scene3D;
  source: string;
}

/** A state, and the name of the edit that reaching it involved. */
export interface HistoryStep extends SceneState {
  label: string;
}

interface Recording {
  file: SceneFile;
  /** The scene as compact JSON — the identity this whole module turns on. */
  json: string;
  label: string;
  source: string;
}

/** How far back you can step. Deep enough that a working session never hits it,
 *  and shallow enough that a 40-strand scene's snapshots stay small change. */
const DEPTH = 80;

export class History {
  private recordings: Recording[] = [];
  /** Where in `recordings` we are standing. -1 only before the first reset. */
  private at = -1;
  /**
   * The tag of the run currently on top of the stack, if the top was recorded as
   * part of one. Cleared by anything else, so a slider dragged, left, and come
   * back to gets a step of its own the second time.
   */
  private openTag: string | null = null;

  constructor(private depth = DEPTH) {}

  /** Throw the history away and start again from this state — a fresh scene has
   *  nothing before it to step back to. */
  reset(state: SceneState, label = 'the scene as it opened'): void {
    this.recordings = [];
    this.at = -1;
    this.openTag = null;
    this.record(state, label);
  }

  /**
   * Record a state, if it is one.
   *
   * @param label what the edit was called, for the arrows' tooltips and the toast
   * @param tag groups a RUN of edits from one control into a single step — a
   *   width slider being dragged, say. A record whose
   *   tag matches the run already on top replaces it instead of stacking on it,
   *   so the drag is one undo rather than one per pixel.
   * @returns whether anything was recorded
   */
  record(state: SceneState, label: string, tag?: string): boolean {
    const file = sceneToFile(state.scene);
    const json = JSON.stringify(file);
    const top = this.at >= 0 ? this.recordings[this.at] : null;
    if (top && top.json === json) {
      // Looks alike: the same scene reached by another route, so there is no step
      // here. The source may still have moved (loading the sample you are already
      // on), and the dropdown should follow that.
      top.source = state.source;
      return false;
    }
    // Recording from here forgets the redo tail: you have taken a different
    // branch, and there is no way back onto the one you left.
    this.recordings.length = this.at + 1;
    const entry: Recording = { file, json, label, source: state.source };
    const key = tag ?? null;
    if (key !== null && key === this.openTag && this.at >= 0) {
      this.recordings[this.at] = entry;
    } else {
      this.recordings.push(entry);
      this.at = this.recordings.length - 1;
      if (this.recordings.length > this.depth) {
        this.recordings.shift();
        this.at--;
      }
    }
    this.openTag = key;
    return true;
  }

  canUndo(): boolean {
    return this.at > 0;
  }

  canRedo(): boolean {
    return this.at >= 0 && this.at < this.recordings.length - 1;
  }

  /** The edit stepping back would take off — the one that MADE the state you are
   *  standing on, which is what "Undo …" has to name. */
  undoLabel(): string | null {
    return this.canUndo() ? this.recordings[this.at].label : null;
  }

  /** The edit stepping forward would put back. */
  redoLabel(): string | null {
    return this.canRedo() ? this.recordings[this.at + 1].label : null;
  }

  undo(): HistoryStep | null {
    if (!this.canUndo()) return null;
    const undone = this.recordings[this.at].label;
    this.at--;
    this.openTag = null;
    return { ...this.stateAt(this.at), label: undone };
  }

  redo(): HistoryStep | null {
    if (!this.canRedo()) return null;
    this.at++;
    this.openTag = null;
    return { ...this.stateAt(this.at), label: this.recordings[this.at].label };
  }

  /** How many recordings are held, and where in them we stand. For tests, and
   *  for anything that wants to say "12 of 40" without reaching inside. */
  size(): number {
    return this.recordings.length;
  }

  position(): number {
    return this.at;
  }

  private stateAt(i: number): SceneState {
    const r = this.recordings[i];
    return { scene: sceneFromSnapshot(r.file), source: r.source };
  }
}
