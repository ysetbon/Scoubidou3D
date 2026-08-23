// Checks the undo history against the one rule it is built on:
//   npm run check:history
// A scene whose JSON does not look like the last one recorded is a new
// recording; one that looks alike is not. Everything below is that rule seen
// from a different side — a run coalescing, a branch forgetting its tail, a
// state coming back exactly as it went in.
//
// The camera's part of the rule is checked by what is ABSENT: the snapshot is
// the scene file, and no orbit, zoom or Fit can reach it. See the last case.

import { History, SceneState } from '../src/model/history';
import { sceneToJson } from '../src/model/sceneIO';
import { makeSample } from '../src/model/samples';
import { addLevelBreak, isStacked, removeStrandAt } from '../src/model/levels';
import { resetControlPoints } from '../src/model/controlPoints';
import { Scene3D } from '../src/model/types';

let bad = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    bad++;
    console.log(`  FAIL  ${what}`);
  } else {
    console.log(`   ok   ${what}`);
  }
};

const state = (scene: Scene3D, source = 'two-crossing'): SceneState => ({ scene, source });

// A scene with everything in it: bent strands, masks, and more than one storey.
const rich = (): Scene3D => makeSample('box-stitch-10');

// ---- 1. a fresh history -----------------------------------------------------
{
  const h = new History();
  h.reset(state(rich()));
  ok(h.size() === 1 && h.position() === 0, 'a reset history holds one recording');
  ok(!h.canUndo() && !h.canRedo(), 'and there is nothing on either side of it');
  ok(h.undo() === null && h.redo() === null, 'so neither step does anything');
}

// ---- 2. what looks alike is not a recording --------------------------------
{
  const scene = rich();
  const h = new History();
  h.reset(state(scene));

  ok(h.record(state(scene), 'nothing at all') === false, 'an unchanged scene records nothing');
  ok(h.size() === 1, 'and leaves the history the length it was');

  // A "straighten" on a strand that is already straight is the real-world case:
  // the control runs, the scene is written over with itself, the JSON is equal.
  const alreadyStraight = scene.strands.find((s) => s.control_points[0].x === s.start.x);
  if (alreadyStraight) resetControlPoints(alreadyStraight);
  ok(
    h.record(state(scene), 'straighten a straight strand') === false,
    'so does an edit that lands back on the state it started from',
  );

  addLevelBreak(scene);
  ok(h.record(state(scene), 'add a level') === true, 'a changed scene does record');
  ok(h.size() === 2 && h.canUndo(), 'and there is now a step to take back');
}

// ---- 3. a step puts the scene back exactly ---------------------------------
{
  const scene = rich();
  const before = sceneToJson(scene);
  const h = new History();
  h.reset(state(scene));

  removeStrandAt(scene, 0);
  addLevelBreak(scene);
  scene.name = 'edited';
  h.record(state(scene, 'imported'), 'edit it');
  const after = sceneToJson(scene);
  ok(before !== after, 'the edits really did change the scene');

  const back = h.undo();
  ok(!!back && sceneToJson(back.scene) === before, 'undo restores the scene byte for byte');
  ok(back?.label === 'edit it', 'and names the edit it took off');
  ok(back?.source === 'two-crossing', 'the sample the scene came from travels with it');

  const forward = h.redo();
  ok(!!forward && sceneToJson(forward.scene) === after, 'redo puts the edited scene back');
  ok(forward?.source === 'imported', 'and brings its source with it too');

  // The restored scene must be a COPY: editing it cannot reach into the record.
  const restored = h.undo()!.scene;
  restored.strands[0].width = 999;
  restored.name = 'scribbled on';
  ok(!!h.redo(), 'stepping forward again still works');
  const back2 = h.undo();
  ok(
    !!back2 && sceneToJson(back2.scene) === before,
    'and the recording is untouched by what was done to a restored copy',
  );
}

// ---- 4. a tagged run is one step -------------------------------------------
{
  const scene = rich();
  const h = new History();
  h.reset(state(scene));
  const start = sceneToJson(scene);

  // A width slider dragged: forty `input` events, one control, one undo.
  for (let w = 40; w <= 80; w++) {
    scene.strands[0].width = w;
    h.record(state(scene), 'change a strand’s width', 'width:0');
  }
  ok(h.size() === 2, 'a run of edits from one control is a single recording');
  ok(h.undo()!.scene.strands[0].width !== 80, 'undoing it takes the whole run off');
  ok(sceneToJson(h.redo()!.scene) === sceneToJson(scene), 'redoing puts the end of the run back');

  // Something else in between ends the run, so coming back starts a new step.
  addLevelBreak(scene);
  h.record(state(scene), 'add a level');
  scene.strands[0].width = 90;
  h.record(state(scene), 'change a strand’s width', 'width:0');
  ok(h.size() === 4, 'a run interrupted and resumed is a step of its own');
  ok(sceneToJson(h.undo()!.scene) !== start, 'and stepping back lands between the two, not before both');
}

// ---- 5. recording forgets the redo tail ------------------------------------
{
  const scene = rich();
  const h = new History();
  h.reset(state(scene));
  addLevelBreak(scene);
  h.record(state(scene), 'add a level');
  addLevelBreak(scene);
  h.record(state(scene), 'add another level');
  ok(h.size() === 3, 'three recordings');

  h.undo();
  h.undo();
  ok(h.canRedo() && h.redoLabel() === 'add a level', 'two steps back, two to go forward');

  const branched = rich();
  branched.name = 'a different branch';
  h.record(state(branched), 'go somewhere else');
  ok(!h.canRedo(), 'a recording made from here forgets the tail');
  ok(h.size() === 2, 'and the history is as long as the branch actually taken');
}

// ---- 6. the depth cap drops the oldest, not the newest ---------------------
{
  const scene = rich();
  const h = new History(5);
  h.reset(state(scene));
  for (let i = 0; i < 20; i++) {
    scene.name = `step ${i}`;
    h.record(state(scene), `step ${i}`);
  }
  ok(h.size() === 5, 'a capped history holds its depth and no more');
  ok(h.position() === 4, 'standing on the newest recording');
  ok(h.undoLabel() === 'step 19', 'with the most recent edits still on it');
}

// ---- 7. the camera is not in the recording ---------------------------------
{
  // Nothing here can orbit — there is no camera in the model at all, which is the
  // point. The snapshot is the scene file, and the scene file has no eye in it,
  // so no amount of turning the view can make one recording differ from another.
  const scene = rich();
  const h = new History();
  h.reset(state(scene));
  const snapshot = JSON.parse(sceneToJson(scene)) as Record<string, unknown>;
  const fields = Object.keys(snapshot).sort().join(',');
  ok(
    fields === 'format,levelBreaks,masks,name,strands,version',
    `a recording holds exactly the scene and nothing else (${fields})`,
  );
  ok(h.record(state(scene), 'orbit the camera') === false, 'so a look from elsewhere is no step');
}

// ---- a level nobody has put anything on is not a stacked scene -------------
//
// `isStacked` is what caps the weave swing so a crossing stays inside its
// storey. Testing the BREAKS instead of the storeys, "add a level" — which
// stores a break at the top of the stack, with nothing above it — halved the
// swing at every crossing in the scene, and a carefully placed flat scene
// rearranged itself the moment a level was added that nothing was on yet.
{
  // `rich()` already carries breaks; this is about a scene that has none yet.
  const scene = rich();
  scene.levelBreaks = [];
  const n = scene.strands.length;
  ok(!isStacked(scene), 'a scene with no breaks is not stacked');

  addLevelBreak(scene);
  ok(
    scene.levelBreaks.join() === String(n),
    `the button's own default puts the break above every strand (${scene.levelBreaks.join()})`,
  );
  ok(!isStacked(scene), 'and a break with nothing above it is STILL not stacked');

  addLevelBreak(scene, 0);
  ok(!isStacked(scene), 'nor is one at 0, which lifts the whole stack together');

  addLevelBreak(scene, n - 1);
  ok(isStacked(scene), 'a break with a strand on either side of it IS stacked');

  removeStrandAt(scene, n - 1);
  ok(!isStacked(scene), 'and taking that last strand away un-stacks it again');
}

console.log(bad ? `\n${bad} failed` : '\nall good');
process.exit(bad ? 1 : 0);
