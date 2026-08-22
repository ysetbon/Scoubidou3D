import { foldTurn, type Gauge } from '../src/geometry/fold';
const SCALE = 0.02;
const W = 54 * SCALE, T = 26 * SCALE;
function g(step:number, reach=0, lean=0, ramp=0.5): Gauge {
  return { width:W, thickness:T, step, round:0.96, reach, k:0, lean, carryOn:false, ramp };
}
// centreline of the tip, plan projection, per fold.ts:389-394
function planProbe(sep:number, step:number, reach=0, lean=0, ramp=0.5) {
  const swing = Math.PI - sep*Math.PI/180;       // heading change
  const din = {x:1,y:0};
  const dout = {x:Math.cos(swing), y:Math.sin(swing)};
  const gg = g(step, reach, lean, ramp);
  const built = foldTurn(din, dout, gg, [{x:0,y:0}]);   // probe section => centreline
  const pts = built.rings.map(r=>r[0]);
  // plan radius of curvature, min over the turn
  let minR = Infinity, minRat = 0, signs = 0, prevCross = 0;
  for (let i=1;i<pts.length-1;i++){
    const ax=pts[i].x-pts[i-1].x, ay=pts[i].y-pts[i-1].y;
    const bx=pts[i+1].x-pts[i].x, by=pts[i+1].y-pts[i].y;
    const la=Math.hypot(ax,ay), lb=Math.hypot(bx,by);
    if(la<1e-12||lb<1e-12) continue;
    const cr=(ax*by-ay*bx)/(la*lb);
    const dot=(ax*bx+ay*by)/(la*lb);
    const dth=Math.atan2(cr,dot);
    const ds=(la+lb)/2;
    const R = Math.abs(dth)<1e-12 ? Infinity : ds/Math.abs(dth);
    if(R<minR){minR=R; minRat=i/pts.length;}
    const s=Math.sign(cr);
    if(Math.abs(cr)>1e-6){ if(prevCross!==0 && s!==prevCross) signs++; prevCross=s; }
  }
  const planLen = pts.reduce((a,p,i)=> i? a+Math.hypot(p.x-pts[i-1].x,p.y-pts[i-1].y):0,0);
  return {minR, minRat, signs, planLen, slide:built.slide, len:built.length};
}
const roll = Math.max(T, W*1.7 - T), stack = Math.min(T*2, roll);
console.log(`W=${W} T=${T} W/T=${(W/T).toFixed(2)} stack=${stack.toFixed(3)}`);
console.log('sep  step  |  min plan radius (w)  at frac  |  curvature sign changes | plan len (w) | 3D len (w)');
for (const sep of [0,5,10,20,30,45,60,90,119]) {
  for (const step of [stack, T, T*0.3]) {
    const r = planProbe(sep, step);
    console.log(`${String(sep).padStart(3)}  ${(step/T).toFixed(2)}t | ${(r.minR/W).toExponential(2).padStart(10)} @${r.minRat.toFixed(2)} | ${r.signs} | ${(r.planLen/W).toFixed(3)} | ${(r.len/W).toFixed(3)}`);
  }
}
console.log('\n--- with legs (reach) and lean, sep 30, step=stack ---');
for (const reach of [0, 0.2, 0.5, 1.0]) for (const lean of [0,0.25,1]) {
  const r = planProbe(30, stack, reach, lean);
  console.log(`reach ${reach} lean ${lean}: minPlanR=${(r.minR/W).toExponential(2)} signs=${r.signs} planLen=${(r.planLen/W).toFixed(3)}`);
}

// WHAT THIS PROBE IS FOR, so the numbers can be re-derived rather than trusted.
//
// It drives the real `foldTurn` on a one-point section, which is the turn's own
// CENTRELINE, and asks the two questions that separate a bight from a brace:
// how tight the turn is IN PLAN, and how many times its plan curvature reverses.
//
// Read against `npm run probe:seps`, which shows that every sample scene's folds
// sit at separations under 45 degrees, the answer is that the studio's turns are
// all in the near-cusp regime: min plan radius 2.4e-4 lace widths at a dead
// fold-back and 8.3e-2 at 45 degrees, against about 1.08 for the reference
// lanyard. The radius is not a parameter — `h = step / 2` at fold.ts:345 is the
// radius, the height and the plan extent at once, and `g.width` appears in no
// centreline expression anywhere in the file.
//
// The sign-change column is 0 everywhere at reach 0. Plan-curvature reversals
// are a REACH artefact, not the baseline: the brace at default settings is the
// plan cusp on its own.
