// The Three.js scene manager for Scoubidou3D.
//
// Given a Scene3D (an ordered stack of strands) it builds one ribbon mesh per
// strand, positions each along +Z by its layer index (so the top layer floats
// above the bottom one), frames the content, and drives an orbit camera. The
// drawing plane is XY (matching OpenStrand's 2D canvas, with y flipped so up is
// up); the new depth axis is +Z.
//
// It also hosts DIRECT EDITING — the 3D analogue of OpenStrand Studio's attach
// and move tools:
//   • MOVE  — grab an endpoint (or control point) handle and drag it in the
//             drawing plane. Everything glued to that endpoint moves with it, so
//             attached strands stay connected (move_mode.py's shared-point drag).
//   • ATTACH— grab a FREE endpoint and pull; a new strand is born there, glued
//             to the parent and stacked on top, exactly like AttachMode does in
//             2D. Chain them to weave whole families.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MaskLink, Scene3D, Strand3D, RGBA, Point } from '../model/types';
import {
  collectJunctions,
  connectedEndpoints,
  endpoint,
  makeAttachedStrand,
  pointsClose,
  recomputeOccupancy,
  setEndpoint,
} from '../model/connections';
import { levelAt, removeStrandAt } from '../model/levels';
import {
  ControlHandle,
  VisibleControls,
  beginControlDrag,
  dragControl,
  settleControls,
  syncPassiveCp2,
  updateControlCenter,
  visibleControls,
} from '../model/controlPoints';
import { sampleCenterline } from '../geometry/bezier';
import { buildRibbonGeometry } from '../geometry/ribbon';
import { buildConnectorGeometry, ConnectorEnd } from '../geometry/connector';
import { easeFolds, easeSteps, roundCorners } from '../geometry/polyline';
import { Anchor, arcLengths, heightField, polylineCrossings } from '../geometry/weave';
import { Vec2, Vec3 } from '../geometry/vec';

// Source (pixel) units -> world units. Keeps camera distances comfortable.
const SCALE = 0.02;

// Handle appearance (world-unit radii + colors), tuned against SCALE so the grab
// dots read clearly at the default framing.
const END_R = 0.18;
// OSS draws its control marks at 11 * 1.333 source units (strand_drawing_canvas.py),
// so carry that radius straight over — it keeps the marks the same size against a
// strand's width as they are on the desktop canvas.
const CP_R = 14.66 * SCALE;
const OCC_R = 0.12;
const COLOR_END = 0x2f7bd6; // move-mode endpoint (blue)
const COLOR_CP = 0x008000; // control points — OSS's green (strand_drawing_canvas.py)
const COLOR_FREE = 0x2fb862; // attach-mode free endpoint (green — attachable)
const COLOR_OCC = 0x9099a6; // attach-mode occupied endpoint (gray — junction)

// A drag shorter than this (source units) counts as a click, not an attach, and
// the just-created strand is discarded — the analogue of OSS's min_length guard.
const MIN_ATTACH_LEN = 4;

// GRAB AREAS, in screen pixels — the thing that makes editing work with a finger.
//
// OpenStrand Studio never asks you to hit the mark you can see: move_mode.py tests
// a 120px SQUARE around an endpoint (get_start_area / get_end_area) and a 50px one
// around a control point (get_control_point_rectangle), and attach_mode.py accepts
// the nearest free endpoint within a 120px circle. The drawn marks are a few pixels
// wide; the areas behind them are huge. We had no such slack — a pick was an exact
// raycast against the little handle mesh — which is survivable with a cursor and
// impossible with a fingertip (a ~9mm contact patch, and the finger hides the
// target it is aiming at).
//
// So: a handle is grabbed when the pointer lands inside its drawn silhouette OR
// within this radius of its centre, whichever is larger. Coarse (touch/pen)
// pointers get roughly double the mouse radii. Control points stay tighter than
// endpoints for the same reason OSS keeps 25 < 60: on an untouched strand the
// triangle sits exactly on the start, and the control-point pass runs first, so
// the smaller area is what leaves the endpoint reachable at all.
const GRAB_PX = {
  fine: { endpoint: 14, control: 12, attach: 22, body: 0 },
  coarse: { endpoint: 34, control: 26, attach: 46, body: 18 },
};

// Touch and pen aim badly; a mouse aims exactly. `pointerType` is per-event, so a
// hybrid laptop gets the right areas for whichever device is actually in use.
function grabPx(e: PointerEvent): (typeof GRAB_PX)['fine'] {
  return e.pointerType === 'mouse' ? GRAB_PX.fine : GRAB_PX.coarse;
}

// Control marks float a hair above their layer so they stay legible against the
// ribbon (and above the endpoint dot they share a spot with on a fresh strand).
const CP_LIFT = 0.1;

export type EditMode = 'orbit' | 'move' | 'attach' | 'weave';

interface MoveTarget {
  strand: Strand3D;
  side: 0 | 1;
  /** Whether each control point sat on the grabbed junction at drag start. */
  cpAtAnchor: [boolean, boolean];
  centerAtAnchor: boolean;
}

type DragState =
  | { kind: 'attach'; child: Strand3D; plane: THREE.Plane }
  | { kind: 'move-endpoint'; plane: THREE.Plane; targets: MoveTarget[] }
  | { kind: 'move-control'; plane: THREE.Plane; strand: Strand3D; handle: ControlHandle };

export interface RenderParams {
  thickness: number; // default ribbon depth, source units
  layerGap: number; // base lift between consecutive layers, source units (small)
  widthScale: number; // multiplier applied to every strand width
  outline: boolean; // draw the stroke-colored outline shell
  roundCaps: boolean; // rounded strand ends
  showGrid: boolean;
  weave: boolean; // realise over/under as real depth at crossings
  weaveDepth: number; // weave amplitude — how far a lace lifts/dips, source units
  weaveSpan: number; // crossing pulse width, as a multiple of the crossing widths
  // OSS `enable_third_control_point`: offer the centre square as a third handle,
  // and let a locked centre bend the curve through itself (bezier.ts).
  thirdControlPoint: boolean;
}

export const DEFAULT_PARAMS: RenderParams = {
  thickness: 26,
  // Base lift between layers. The weave picks over/under at every CROSSING on its
  // own (adaptive amplitude), so this only needs to separate strands that overlap
  // WITHOUT crossing (a plain parallel stack) — and it's what gives the ordered
  // stack when the weave is switched off.
  layerGap: 10,
  widthScale: 1,
  outline: true,
  roundCaps: true,
  showGrid: true,
  weave: true,
  weaveDepth: 26,
  weaveSpan: 1.3,
  // On, matching the running desktop canvas (strand_drawing_canvas.py sets it
  // true even though the settings dialog defaults it off).
  thirdControlPoint: true,
};

function threeColor(c: RGBA): THREE.Color {
  return new THREE.Color().setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
}

export class StrandScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  /** Called after an edit changes the strand list (attach create / finalize), so
   *  the layer panel can re-render. Movement doesn't fire it — it changes no
   *  layer, only geometry. */
  onSceneChanged: (() => void) | null = null;

  private strandGroup = new THREE.Group();
  private handleGroup = new THREE.Group();
  // The dashed green rig linking a strand to its control points. Kept out of
  // handleGroup so it never competes for a pick (a Line's raycast threshold is
  // wide enough to swallow the handles it points at).
  private controlLines = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private current: Scene3D = { strands: [], masks: [], levelBreaks: [], name: 'empty' };
  private params: RenderParams = { ...DEFAULT_PARAMS };
  private center: Vec2 = { x: 0, y: 0 };
  private contentRadius = 10;

  private mode: EditMode = 'orbit';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  // Handle shapes, all unit-sized and laid flat in the drawing plane so they read
  // as OSS's marks from the top-down view: a TRIANGLE for control point 1, a
  // CIRCLE for control point 2, a SQUARE for the centre. Endpoints stay spheres —
  // they are grab dots, not OSS control marks.
  private handleGeo = new THREE.SphereGeometry(1, 18, 12);
  private triGeo = new THREE.CylinderGeometry(1.06, 1.06, 0.5, 3)
    .rotateX(Math.PI / 2)
    .rotateZ(Math.PI); // apex toward +Y — OSS's triangle points up the canvas
  private circGeo = new THREE.CylinderGeometry(1, 1, 0.5, 24).rotateX(Math.PI / 2);
  private sqGeo = new THREE.BoxGeometry(1.4, 1.4, 0.5);
  private dragState: DragState | null = null;
  // The one pointer driving the current drag. Every other pointer (a second
  // finger, a stylus resting on the glass) is ignored until it lifts.
  private activePointerId: number | null = null;
  private hovered: THREE.Mesh | null = null;

  // The woven world-space centerline of each strand (indexed like scene.strands;
  // null for hidden strands), rebuilt every frame the scene changes. Handles and
  // connectors read endpoint heights from here so they follow the weave.
  private world3D: Array<Vec3[] | null> = [];
  // Resting height per strand (see computeBaseZ) and the lowest of them, which the
  // grid sits below.
  private baseZ: number[] = [];
  private lowestZ = 0;
  // Weave (mask) tool: the strand picked as "over"; the next pick becomes "under".
  private weavePendingOverId: string | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef1f4');

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.up.set(0, 0, 1); // Z is up: layers stack toward the sky
    this.camera.position.set(6, -14, 12);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.addLights();
    this.scene.add(this.strandGroup);
    this.scene.add(this.controlLines);
    this.scene.add(this.handleGroup);

    // Capture-phase pointerdown so we can claim a handle grab BEFORE OrbitControls
    // sees the event (otherwise it would start orbiting). Move/up live on window
    // so a drag keeps tracking even if the cursor leaves the canvas.
    this.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    // A cancelled pointer (OS gesture, focus loss, touch interruption) must not
    // strand an in-flight edit — abandon it and hand control back to the camera.
    window.addEventListener('pointercancel', this.onPointerCancel, true);

    window.addEventListener('resize', () => this.resize());
    // The window is not the only thing that resizes the canvas: folding the panel
    // away on a phone, or the browser's own chrome sliding in and out as you
    // scroll, changes the canvas box with no resize event at all.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(this.canvas);
    }
    this.resize();
    this.animate();
  }

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9099a6, 1.0);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(8, -10, 22);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    const s = 30;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-12, 8, 10);
    this.scene.add(fill);
  }

  setScene(scene: Scene3D, refit = true): void {
    this.current = scene;
    recomputeOccupancy(scene); // keep endpoint occupancy in sync with the geometry
    this.computeCenter();
    this.rebuild();
    if (refit) this.fitView();
  }

  setParams(patch: Partial<RenderParams>): void {
    this.params = { ...this.params, ...patch };
    this.rebuild();
  }

  getParams(): RenderParams {
    return { ...this.params };
  }

  getScene(): Scene3D {
    return this.current;
  }

  getMode(): EditMode {
    return this.mode;
  }

  /** Switch edit tool. Cancels any in-flight drag and rebuilds the handles. */
  setMode(mode: EditMode): void {
    if (this.mode === mode) return;
    if (this.dragState) {
      this.cancelDrag();
    }
    this.mode = mode;
    this.hovered = null;
    this.weavePendingOverId = null;
    this.rebuild();
    this.setCursor(mode === 'orbit' ? '' : 'crosshair');
  }

  /** The strand picked as "over" in the weave tool (null when nothing pending). */
  getWeavePending(): string | null {
    return this.weavePendingOverId;
  }

  /** Abandon an in-flight drag without committing it. An attach in progress is
   *  thrown away entirely (it was never finished), so we never leave a stray
   *  zero-length strand or a wrongly-occupied parent behind. */
  private cancelDrag(): void {
    const st = this.dragState;
    this.dragState = null;
    this.activePointerId = null;
    this.controls.enabled = true;
    if (st && st.kind === 'attach') {
      removeStrandAt(this.current, this.current.strands.indexOf(st.child));
      recomputeOccupancy(this.current);
      this.onSceneChanged?.();
    }
  }

  /** Rebuild all ribbon meshes, connectors and edit handles from the current
   *  scene + params. This is where masks become real depth: we find every
   *  crossing, decide who rides over, and weave the centerlines in Z. */
  rebuild(): void {
    this.disposeGroup();

    // 0) Resting height per strand, shared by every strand in one lace.
    this.computeBaseZ();

    // 1) The flat world-space centerline of every strand (null = skip).
    const worldLines = this.current.strands.map((s) =>
      s.visible && !s.isMask ? densify(this.strandCenterlineWorld(s), 0.2) : null,
    );

    // 2) Weave: turn crossings into per-strand Z height fields, then bake Z into
    //    each centerline. world3D[i] is the woven centerline used everywhere.
    this.world3D = this.weaveCenterlines(worldLines);

    // 3) Build the ribbons. Strands glued into one lace become ONE mesh along a
    //    single centerline, so the lace has no internal seams at all.
    const merged = this.buildLaceMeshes();

    // 4) Anything not absorbed into a lace gets its own ribbon...
    const glued = new Set<string>();
    for (const j of collectJunctions(this.current)) {
      glued.add(`${j.childIndex}:${j.childSide}`);
      glued.add(`${j.parentIndex}:${j.parentSide}`);
    }
    this.current.strands.forEach((strand, i) => {
      if (merged.has(i)) return;
      const line = this.world3D[i];
      if (!line) return;
      const mesh = this.buildStrandMesh(strand, line, [
        !glued.has(`${i}:0`),
        !glued.has(`${i}:1`),
      ]);
      if (mesh) this.strandGroup.add(mesh);
    });

    // 5) ...and any joint still spanning two separate meshes gets a connector.
    this.buildConnectors(merged);

    this.updateGrid();
    this.buildHandles();
  }

  /**
   * Draw each continuous LACE as a single ribbon and report which strands were
   * absorbed.
   *
   * Strands glued end to end are one physical lace — the arms of a stitch, an OSS
   * attached-strand family. Meshing them separately leaves an internal seam at
   * every joint: two end caps meeting face to face, plus an outline shell that
   * closes across the ribbon and reads as a black band. Sweeping one ribbon along
   * the whole concatenated centerline removes the joints instead of patching them.
   *
   * Only laces whose members look identical are merged (one ribbon carries one
   * width and one colour); anything else falls back to per-strand meshes bridged
   * by connectors.
   */
  private buildLaceMeshes(): Set<number> {
    const strands = this.current.strands;
    const absorbed = new Set<number>();

    // Which end is glued to which. An end shared by more than two strands is a
    // fork, not a chain, so it is left unlinked and handled by a connector.
    const partner = new Map<string, { index: number; side: 0 | 1 }>();
    const degree = new Map<string, number>();
    const bump = (k: string) => degree.set(k, (degree.get(k) ?? 0) + 1);
    const junctions = collectJunctions(this.current);
    for (const j of junctions) {
      bump(`${j.childIndex}:${j.childSide}`);
      bump(`${j.parentIndex}:${j.parentSide}`);
    }
    for (const j of junctions) {
      const a = `${j.childIndex}:${j.childSide}`;
      const b = `${j.parentIndex}:${j.parentSide}`;
      if ((degree.get(a) ?? 0) > 1 || (degree.get(b) ?? 0) > 1) continue;
      partner.set(a, { index: j.parentIndex, side: j.parentSide });
      partner.set(b, { index: j.childIndex, side: j.childSide });
    }
    if (partner.size === 0) return absorbed;

    const sameLook = (a: Strand3D, b: Strand3D): boolean =>
      a.width === b.width &&
      a.thickness === b.thickness &&
      a.stroke_width === b.stroke_width &&
      sameColor(a.color, b.color) &&
      sameColor(a.stroke_color, b.stroke_color);

    const visited = new Set<number>();
    for (let seed = 0; seed < strands.length; seed++) {
      if (visited.has(seed) || !this.world3D[seed]) continue;

      // Walk back from the seed to the head of its chain.
      let head = seed;
      let headIn: 0 | 1 = 0;
      const back = new Set<number>([seed]);
      for (;;) {
        const p = partner.get(`${head}:${headIn}`);
        if (!p || back.has(p.index)) break;
        back.add(p.index);
        head = p.index;
        headIn = (1 - p.side) as 0 | 1;
      }

      // Then walk forward, recording each member and whether it is traversed
      // against its own start->end direction.
      const chain: Array<{ index: number; reversed: boolean }> = [];
      let cur = head;
      let inSide = headIn;
      for (;;) {
        if (visited.has(cur)) break;
        visited.add(cur);
        chain.push({ index: cur, reversed: inSide === 1 });
        const p = partner.get(`${cur}:${(1 - inSide) as 0 | 1}`);
        if (!p) break;
        cur = p.index;
        inSide = p.side;
      }

      if (chain.length < 2) continue;
      const first = strands[chain[0].index];
      const ok = chain.every((m) => this.world3D[m.index] && sameLook(strands[m.index], first));
      if (!ok) {
        for (const m of chain) visited.delete(m.index); // let them mesh individually
        continue;
      }

      // Concatenate into one centerline. The joint vertex arrives twice — once
      // from each strand, each with its own weave height — so collapse the pair
      // and split the difference, otherwise the joint carries a step with no
      // length in the plane and the heading there reads as neither run's.
      const line: Vec3[] = [];
      for (const m of chain) {
        const part = this.world3D[m.index]!;
        const walk = m.reversed ? [...part].reverse() : part;
        for (const p of walk) {
          const last = line[line.length - 1];
          if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) {
            last.zIn = last.zIn ?? last.z;
            last.zOut = p.z;
            last.z = (last.zIn + last.zOut) / 2;
            continue;
          }
          line.push({ ...p });
        }
      }

      // Round the gentle joins before sweeping — glued strands meet at whatever
      // angle they were drawn at, and anything from about 20 degrees up wants a
      // bight rather than a kink. The bight is sized from the lace's own width.
      // Folds are deliberately left sharp: the sweep creases them (ribbon.ts),
      // which is the only way a flat lace can turn that far.
      const width = first.width * this.params.widthScale * SCALE;
      // Settle each fold before sweeping: the lace stacks on itself there, one
      // thickness apart, with the change eased into the runs on either side.
      const thickness = (first.thickness ?? this.params.thickness) * SCALE;
      easeFolds(line, thickness, thickness * 2);
      // Then walk up any step left at a gentle joint — a level break between two
      // members of the lace puts one storey's worth of height there, and without a
      // crease to climb at it has to be ramped into the runs instead.
      easeSteps(line, width);
      const rounded = roundCorners(line, width * 0.5);
      const mesh = this.buildStrandMesh(first, rounded, [true, true]);
      if (!mesh) {
        for (const m of chain) visited.delete(m.index);
        continue;
      }
      this.strandGroup.add(mesh);
      for (const m of chain) absorbed.add(m.index);
    }
    return absorbed;
  }

  // Sample a strand's OSS-faithful centerline and map it to world XY (y flipped).
  private strandCenterlineWorld(strand: Strand3D): Vec2[] {
    const src = sampleCenterline({
      start: strand.start,
      end: strand.end,
      control_points: strand.control_points,
      // With the third control point switched off, a locked centre is ignored by
      // the curve as well as by the handles — OSS gates its path on the setting
      // (strand.py: `third_locked = third_enabled and ...locked`), so turning the
      // option off restores the plain two-handle shape without losing the centre.
      control_point_center: this.params.thirdControlPoint ? strand.control_point_center : null,
      control_point_center_locked: strand.control_point_center_locked,
    });
    return src.map((p) => ({ x: (p.x - this.center.x) * SCALE, y: -(p.y - this.center.y) * SCALE }));
  }

  // Does a mask fix the order for this pair? Returns the index (i or j) that
  // rides over, or null if no mask covers them (caller falls back to layer order).
  private maskOver(i: number, j: number): number | null {
    const idI = this.current.strands[i].id;
    const idJ = this.current.strands[j].id;
    for (const m of this.current.masks) {
      if (m.overId === idI && m.underId === idJ) return i;
      if (m.overId === idJ && m.underId === idI) return j;
    }
    return null;
  }

  private strandThicknessWorld(strand: Strand3D): number {
    return (strand.thickness ?? this.params.thickness) * SCALE;
  }

  /** Build every strand's woven centerline (world XY + Z from the weave).
   *
   *  Each crossing is resolved to ABSOLUTE heights about the weave plane (z = 0):
   *  the over lace goes to +h, the under lace to -h. That's what makes a mask a
   *  purely LOCAL statement — "this strand crosses over that one, here" — with no
   *  dependence on how far apart the two sit in the layer panel. Masking a
   *  bottom-of-the-stack strand over a top-of-the-stack one costs exactly the same
   *  displacement as masking two neighbours, so a lace masked over several strands
   *  rides flat instead of ramping, and no other layer is disturbed.
   *
   *  The base layer height still governs stretches with NO crossing, which is what
   *  keeps overlapping-but-never-crossing strands apart and gives the plain
   *  ordered stack when the weave is switched off. */
  private weaveCenterlines(worldLines: Array<Vec2[] | null>): Array<Vec3[] | null> {
    const strands = this.current.strands;
    const span = this.params.weaveSpan;
    const anchors: Anchor[][] = strands.map(() => []);

    if (this.params.weave) {
      const boxes = worldLines.map((l) => (l ? bbox(l) : null));
      for (let i = 0; i < strands.length; i++) {
        const a = worldLines[i];
        if (!a) continue;
        for (let j = i + 1; j < strands.length; j++) {
          const b = worldLines[j];
          if (!b) continue;
          if (!boxesOverlap(boxes[i]!, boxes[j]!)) continue; // cheap reject
          const crossings = polylineCrossings(a, b);
          if (crossings.length === 0) continue;

          // Who's over here: a mask if one covers the pair, else the higher layer.
          const over = this.maskOver(i, j) ?? j;
          const under = over === i ? j : i;
          // Half-separation. At minimum the two ribbons must not interpenetrate;
          // the Depth control can open the weave up beyond that.
          const clearance =
            ((this.strandThicknessWorld(strands[over]) + this.strandThicknessWorld(strands[under])) / 2) * 1.15;
          const h = Math.max(this.params.weaveDepth * SCALE, clearance / 2);

          const wi = strands[i].width * this.params.widthScale * SCALE;
          const wj = strands[j].width * this.params.widthScale * SCALE;
          const radius = (wi / 2 + wj / 2) * span;
          for (const c of crossings) {
            const sOver = over === i ? c.sA : c.sB;
            const sUnder = under === i ? c.sA : c.sB;
            anchors[over].push({ s: sOver, radius, z: h });
            anchors[under].push({ s: sUnder, radius, z: -h });
          }
        }
      }
    }

    return strands.map((_, i) => {
      const line = worldLines[i];
      if (!line) return null;
      const { cum } = arcLengths(line);
      const z = heightField(cum, anchors[i], this.layerZ(i));
      return line.map((p, k) => ({ x: p.x, y: p.y, z: z[k] }));
    });
  }

  /** Bridge each attach junction with a lofted connector so the joined ribbons
   *  read as one continuous lace stepping between layers. Joints inside a merged
   *  lace need nothing — that ribbon is already one piece. */
  private buildConnectors(merged: Set<number>): void {
    for (const j of collectJunctions(this.current)) {
      if (merged.has(j.childIndex) && merged.has(j.parentIndex)) continue;
      const parent = this.endAt(j.parentIndex, j.parentSide);
      const child = this.endAt(j.childIndex, j.childSide);
      if (!parent || !child) continue;
      const strand = this.current.strands[j.childIndex];
      const width = strand.width * this.params.widthScale * SCALE;
      const thickness = (strand.thickness ?? this.params.thickness) * SCALE;
      const geom = buildConnectorGeometry(parent, child, {
        width,
        thickness,
        cornerRadius: thickness * 0.48,
        cornerSteps: 3,
      });
      if (!geom) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: threeColor(strand.color),
        roughness: 0.5,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      if (strand.color.a < 255) {
        mat.transparent = true;
        mat.opacity = strand.color.a / 255;
      }
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.strandGroup.add(mesh);

      // Match the ribbons' outline shell so the dark rim runs unbroken through
      // the joint instead of stopping at it.
      if (this.params.outline && strand.stroke_width > 0) {
        const ow = strand.stroke_width * SCALE;
        const outlineGeom = buildConnectorGeometry(parent, child, {
          width: width + ow * 2,
          thickness: thickness + ow * 2,
          cornerRadius: (thickness + ow * 2) * 0.48,
          cornerSteps: 3,
        });
        if (outlineGeom) {
          const outlineMat = new THREE.MeshBasicMaterial({
            color: threeColor(strand.stroke_color),
            side: THREE.BackSide,
          });
          const outlineMesh = new THREE.Mesh(outlineGeom, outlineMat);
          outlineMesh.renderOrder = -1;
          this.strandGroup.add(outlineMesh);
        }
      }
    }
  }

  // The woven world endpoint of a strand, as a connector end (position + the
  // in-plane heading along the strand at that end). null if the strand is hidden.
  private endAt(index: number, side: 0 | 1): ConnectorEnd | null {
    const line = this.world3D[index];
    if (!line || line.length < 2) return null;
    if (side === 0) {
      const p = line[0];
      const q = line[1];
      return { center: { ...p }, tangent: { x: q.x - p.x, y: q.y - p.y } };
    }
    const p = line[line.length - 1];
    const q = line[line.length - 2];
    // Heading in the start->end sense (points outward past the end).
    return { center: { ...p }, tangent: { x: p.x - q.x, y: p.y - q.y } };
  }

  private buildStrandMesh(
    strand: Strand3D,
    centerline: Vec3[],
    freeEnds: [boolean, boolean] = [true, true],
  ): THREE.Object3D | null {
    if (centerline.length < 2) return null;

    const width = strand.width * this.params.widthScale * SCALE;
    const thickness = (strand.thickness ?? this.params.thickness) * SCALE;
    if (width <= 0 || thickness <= 0) return null;

    const group = new THREE.Group();
    // Only a FREE end gets a rounded tip; a glued end would bulge through the joint.
    const capStart = this.params.roundCaps && freeEnds[0];
    const capEnd = this.params.roundCaps && freeEnds[1];

    const fillGeom = buildRibbonGeometry(centerline, {
      width,
      thickness,
      cornerRadius: thickness * 0.48,
      cornerSteps: 3,
      roundCaps: this.params.roundCaps,
      capStart,
      capEnd,
    });
    const fillMat = new THREE.MeshStandardMaterial({
      color: threeColor(strand.color),
      roughness: 0.5,
      metalness: 0.04,
      // The swept tube's winding yields inward normals; DoubleSide lets Three
      // flip the normal per back-facing fragment so the body lights correctly
      // (without it the ribbon shades black). Caps/dome are consistent too.
      side: THREE.DoubleSide,
    });
    if (strand.color.a < 255) {
      fillMat.transparent = true;
      fillMat.opacity = strand.color.a / 255;
    }
    // Weave tool: glow the strand picked as "over" while waiting for the "under".
    if (this.mode === 'weave' && strand.id === this.weavePendingOverId) {
      fillMat.emissive = new THREE.Color(0x2fb862);
      fillMat.emissiveIntensity = 0.6;
    }
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.castShadow = true;
    fillMesh.receiveShadow = true;
    fillMesh.userData.strandId = strand.id;
    group.add(fillMesh);

    if (this.params.outline && strand.stroke_width > 0) {
      const ow = strand.stroke_width * SCALE;
      const outlineGeom = buildRibbonGeometry(centerline, {
        width: width + ow * 2,
        thickness: thickness + ow * 2,
        cornerRadius: (thickness + ow * 2) * 0.48,
        cornerSteps: 3,
        roundCaps: this.params.roundCaps,
        capStart,
        capEnd,
        // A glued end leaves the shell open so the outlines of the two laces join
        // into one sleeve instead of showing a black plate at the seam.
        openStart: !freeEnds[0],
        openEnd: !freeEnds[1],
        openFolds: true,
      });
      const outlineMat = new THREE.MeshBasicMaterial({
        color: threeColor(strand.stroke_color),
        side: THREE.BackSide, // show only the shell's far faces => a rim outline
        // Bias the shell away from the camera. Where a lace bends hard — the
        // bights of a stitch — or meets another lace end to end, a far face of the
        // shell can otherwise land in front of the body it is meant to sit behind,
        // and the rim floods across the ribbon as a black band.
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      });
      const outlineMesh = new THREE.Mesh(outlineGeom, outlineMat);
      outlineMesh.renderOrder = -1;
      group.add(outlineMesh);
    }

    return group;
  }

  // ---- coordinate helpers --------------------------------------------------
  // World position of a source-space point on a given layer's plane.
  private srcToWorld(p: Point, z: number): THREE.Vector3 {
    return new THREE.Vector3((p.x - this.center.x) * SCALE, -(p.y - this.center.y) * SCALE, z);
  }

  // Inverse of srcToWorld's XY (used when a dragged point is read off a plane).
  private worldToSrc(x: number, y: number): Point {
    return { x: x / SCALE + this.center.x, y: -(y / SCALE) + this.center.y };
  }

  /**
   * The resting height of a strand — where it sits away from any crossing.
   *
   * Two separate things set it, and they are deliberately scoped differently.
   *
   * RANK — position in the layer panel, spaced by the (small) layer lift — is
   * shared by every strand in one LACE. A cord built from several strands glued
   * end to end (an OSS attached-strand family, or the folded arms of a stitch) is
   * one physical object, and its members' panel positions are incidental: they
   * are whatever order the cord happened to be drawn in. Ranking each member
   * separately would make the cord climb a staircase along its own length for no
   * reason the eye can see, so the whole lace takes the rank of its lowest
   * member and laces stack against each other.
   *
   * LEVEL — how many level breaks sit below the strand, each worth one full
   * strand thickness — is PER STRAND. A break is not incidental: it is the user
   * saying "this storey is higher", and the usual way to use it is to press
   * New level and then Attach, continuing an existing cord onto the new storey.
   * Averaging that away over the lace would make the button do nothing whenever
   * the new strand is attached rather than free-standing, which is most of the
   * time. So a lace may step between storeys along its length — at a fold it
   * lies on the run it came off (`easeFolds`), at a gentle joint it walks up
   * over a short ramp (`easeSteps`), and where the two ends belong to separate
   * meshes the connector lofts between them.
   *
   * Masks are untouched by all of this: they decide what happens at crossings,
   * this only sets the resting plane.
   */
  private computeBaseZ(): void {
    const n = this.current.strands.length;
    const root = Array.from({ length: n }, (_, i) => i);
    const find = (a: number): number => {
      while (root[a] !== a) {
        root[a] = root[root[a]];
        a = root[a];
      }
      return a;
    };
    for (const j of collectJunctions(this.current)) {
      const ra = find(j.childIndex);
      const rb = find(j.parentIndex);
      if (ra !== rb) root[rb] = ra;
    }

    // Rank each lace by its lowest member index, so the stacking still follows the
    // layer panel.
    const lowest = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const cur = lowest.get(r);
      if (cur === undefined || i < cur) lowest.set(r, i);
    }
    const gap = this.params.layerGap * SCALE;
    // One level break is worth one strand thickness: the exact separation at
    // which the upper ribbon's underside meets the lower one's top face.
    const step = this.params.thickness * SCALE;
    const rankZ = new Map<number, number>();
    [...lowest.entries()]
      .sort((a, b) => a[1] - b[1])
      .forEach(([r], k) => rankZ.set(r, k * gap));

    const rest = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      rest[i] = (rankZ.get(find(i)) ?? 0) + levelAt(this.current, i) * step;
    }

    // Re-centre on z = 0, so adding a level opens the stack up around the grid
    // instead of walking the whole model off it.
    let min = Infinity;
    let max = -Infinity;
    for (const z of rest) {
      if (z < min) min = z;
      if (z > max) max = z;
    }
    const shift = n ? -(min + max) / 2 : 0;
    this.baseZ = rest.map((z) => z + shift);
    this.lowestZ = n ? min + shift : 0;
  }

  private layerZ(layerIndex: number): number {
    return this.baseZ[layerIndex] ?? 0;
  }

  // ---- edit handles --------------------------------------------------------
  /**
   * One grab handle. `core` fills it with the strand's own colour at half size,
   * the way OSS paints the inside of every control mark, so a handle says which
   * strand it belongs to without being clicked.
   *
   * The core and the outline ride as CHILDREN of the pickable mesh: the handle
   * raycast is deliberately non-recursive, so they can't steal a hit, and they
   * still inherit the hover scale-up for free.
   */
  private makeHandle(
    geo: THREE.BufferGeometry,
    radius: number,
    colorHex: number,
    core?: RGBA,
    order = 20,
  ): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: false, // always grabbable, even behind ribbons
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = order;
    mesh.userData.baseColor = colorHex;
    mesh.userData.baseRadius = radius;

    if (core) {
      const inner = new THREE.Mesh(
        geo,
        // Transparent like its shell, so both land in the same render pass and
        // renderOrder decides: an opaque core would be drawn in the earlier pass
        // and the shell would paint straight over it.
        new THREE.MeshBasicMaterial({ color: threeColor(core), depthTest: false, transparent: true }),
      );
      inner.scale.setScalar(0.5);
      inner.position.z = 0.3; // clear of the outer face when seen from above
      inner.renderOrder = order + 1;
      mesh.add(inner);
    }
    return mesh;
  }

  private buildHandles(): void {
    this.disposeHandles();
    // Orbit has no handles; the weave tool picks strand bodies, not endpoints.
    if (this.mode === 'orbit' || this.mode === 'weave') return;

    this.current.strands.forEach((strand, layerIndex) => {
      if (!strand.visible || strand.isMask) return;
      const line = this.world3D[layerIndex];
      const z = this.layerZ(layerIndex);
      // Endpoint handles sit at the strand's woven height so they track the lace
      // as it rises and dips; control points use the base layer height.
      const endZ = (side: 0 | 1): number =>
        line && line.length >= 2 ? (side === 0 ? line[0].z : line[line.length - 1].z) : z;

      ([0, 1] as const).forEach((side) => {
        const occupied = strand.hasCircles[side];
        if (this.mode === 'attach') {
          const attachable = !occupied;
          const mesh = this.makeHandle(
            this.handleGeo,
            attachable ? END_R : OCC_R,
            attachable ? COLOR_FREE : COLOR_OCC,
          );
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), endZ(side)));
          mesh.userData.kind = 'endpoint';
          mesh.userData.index = layerIndex;
          mesh.userData.side = side;
          mesh.userData.attachable = attachable;
          this.handleGroup.add(mesh);
        } else {
          // move mode: every endpoint is draggable
          const mesh = this.makeHandle(this.handleGeo, END_R, COLOR_END);
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), endZ(side)));
          mesh.userData.kind = 'endpoint';
          mesh.userData.index = layerIndex;
          mesh.userData.side = side;
          this.handleGroup.add(mesh);
        }
      });

      // Control points (move mode only), exactly OSS's staged set: an untouched
      // strand offers only the TRIANGLE — parked on the start, where its control
      // points live — and grabbing it reveals the CIRCLE and the centre SQUARE.
      // See controlPoints.ts; the shapes are the desktop app's own.
      if (this.mode === 'move') {
        const vis = visibleControls(strand, this.params.thirdControlPoint);
        const addMark = (handle: ControlHandle, p: Point, geo: THREE.BufferGeometry): void => {
          const mesh = this.makeHandle(geo, CP_R, COLOR_CP, strand.color, 22);
          mesh.position.copy(this.srcToWorld(p, z + CP_LIFT));
          mesh.userData.kind = 'control';
          mesh.userData.index = layerIndex;
          mesh.userData.cp = handle;
          this.handleGroup.add(mesh);
        };
        if (vis.circle) addMark(1, strand.control_points[1], this.circGeo);
        if (vis.center && strand.control_point_center) {
          addMark('center', strand.control_point_center, this.sqGeo);
        }
        // Triangle last so it lands on top wherever the marks coincide — which is
        // every mark at once on a strand nobody has bent yet.
        if (vis.triangle) addMark(0, strand.control_points[0], this.triGeo);

        this.buildControlLines(strand, vis, z);
      }
    });
  }

  /**
   * OSS's dashed green rig (strand_drawing_canvas.py `_create_control_line_pen`):
   * start→triangle, end→circle — or start→circle while the circle is still parked
   * on the start — plus the centre's two spokes. Drawn only once the set is open,
   * so an untouched strand stays clean.
   */
  private buildControlLines(strand: Strand3D, vis: VisibleControls, z: number): void {
    if (!vis.circle && !vis.center) return;
    const [cp1, cp2] = strand.control_points;
    const ends: Point[] = [strand.start, cp1];
    ends.push(pointsClose(cp2, strand.start) ? strand.start : strand.end, cp2);
    if (vis.center && strand.control_point_center) {
      ends.push(strand.control_point_center, cp1, strand.control_point_center, cp2);
    }

    const positions = new Float32Array(ends.length * 3);
    ends.forEach((p, i) => {
      const w = this.srcToWorld(p, z + CP_LIFT);
      positions[i * 3] = w.x;
      positions[i * 3 + 1] = w.y;
      positions[i * 3 + 2] = w.z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line = new THREE.LineSegments(
      geo,
      new THREE.LineDashedMaterial({
        color: COLOR_CP,
        dashSize: 0.12,
        gapSize: 0.08,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 19; // under the handles it points at
    this.controlLines.add(line);
  }

  // ---- pointer interaction -------------------------------------------------
  private ndc(e: PointerEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    return true;
  }

  /** Where a world point lands in the canvas box, in CSS pixels. Null when it is
   *  behind the camera (a projected point there comes back mirrored). */
  private toScreen(world: THREE.Vector3, rect: DOMRect): Vec2 | null {
    const p = world.clone().project(this.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height };
  }

  /** How wide a handle actually draws on screen, so a mark that is already big
   *  under the cursor keeps its own silhouette as the grab area. */
  private screenRadius(mesh: THREE.Mesh, center: Vec2, rect: DOMRect): number {
    const r = (mesh.userData.baseRadius as number) ?? 0;
    if (!r) return 0;
    // Camera-right, so the offset is the radius seen face-on whatever the orbit.
    const right = new THREE.Vector3()
      .setFromMatrixColumn(this.camera.matrixWorld, 0)
      .multiplyScalar(r);
    const edge = this.toScreen(mesh.position.clone().add(right), rect);
    return edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 0;
  }

  /**
   * The handle a press should grab: a proximity test in screen space, not a
   * raycast, so a fingertip that lands *near* a mark still takes it (see GRAB_PX).
   *
   * OSS's pass order is preserved: a control point anywhere under the pointer beats
   * every endpoint (move_mode.py runs try_move_control_points first), and within a
   * kind the closest mark wins — measured as a fraction of each mark's own reach so
   * a small tight one isn't swamped by a big loose neighbour.
   */
  private pickHandle(e: PointerEvent): THREE.Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tol = grabPx(e);

    let bestControl: { mesh: THREE.Mesh; score: number } | null = null;
    let bestEndpoint: { mesh: THREE.Mesh; score: number } | null = null;

    for (const obj of this.handleGroup.children) {
      const mesh = obj as THREE.Mesh;
      const center = this.toScreen(mesh.position, rect);
      if (!center) continue;
      const control = mesh.userData.kind === 'control';
      // Attach mode's free endpoints get OSS's roomier circle; an occupied one
      // keeps the plain endpoint area (it is only there to swallow the press).
      const min = control
        ? tol.control
        : this.mode === 'attach' && mesh.userData.attachable
          ? tol.attach
          : tol.endpoint;
      const reach = Math.max(this.screenRadius(mesh, center, rect), min);
      const score = Math.hypot(px - center.x, py - center.y) / reach;
      if (score > 1) continue;
      const slot = control ? bestControl : bestEndpoint;
      if (!slot || score < slot.score) {
        if (control) bestControl = { mesh, score };
        else bestEndpoint = { mesh, score };
      }
    }
    return (bestControl ?? bestEndpoint)?.mesh ?? null;
  }

  // Topmost strand id under the pointer (skips outline shells and connectors,
  // which carry no strandId). Used by the weave tool. A body is a big target, so
  // an exact ray is enough for a mouse; a finger gets a ring of fallback rays at
  // the coarse tolerance so a tap that lands just off a lace still picks it.
  private pickStrand(e: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const r = grabPx(e).body;
    const offsets: Vec2[] = [{ x: 0, y: 0 }];
    for (let i = 0; i < 8 && r > 0; i++) {
      const a = (i / 8) * Math.PI * 2;
      offsets.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    for (const o of offsets) {
      this.pointer.set(
        ((e.clientX - rect.left + o.x) / rect.width) * 2 - 1,
        -((e.clientY - rect.top + o.y) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.strandGroup.children, true);
      for (const h of hits) {
        const id = h.object.userData?.strandId;
        if (typeof id === 'string') return id;
      }
    }
    return null;
  }

  // Weave tool click: first pick is the OVER strand, second is the UNDER strand.
  private handleWeavePick(id: string): void {
    if (this.weavePendingOverId === null) {
      this.weavePendingOverId = id; // arm: this strand rides over
    } else if (id === this.weavePendingOverId) {
      this.weavePendingOverId = null; // re-clicking the armed strand cancels
    } else {
      this.setMask(this.weavePendingOverId, id); // second pick goes under
      this.weavePendingOverId = null;
    }
    this.rebuild();
    this.onSceneChanged?.();
  }

  // ---- masks (over/under) --------------------------------------------------
  getMasks(): MaskLink[] {
    return this.current.masks;
  }

  /** Set `overId` to ride over `underId`, replacing any existing relationship for
   *  the pair (so a repeat pick in the other order simply flips it). */
  setMask(overId: string, underId: string): void {
    if (overId === underId) return;
    this.current.masks = this.current.masks.filter(
      (m) =>
        !((m.overId === overId && m.underId === underId) || (m.overId === underId && m.underId === overId)),
    );
    this.current.masks.push({ overId, underId });
    this.rebuild();
    this.onSceneChanged?.();
  }

  flipMask(index: number): void {
    const m = this.current.masks[index];
    if (!m) return;
    this.current.masks[index] = { overId: m.underId, underId: m.overId };
    this.rebuild();
    this.onSceneChanged?.();
  }

  removeMask(index: number): void {
    if (index < 0 || index >= this.current.masks.length) return;
    this.current.masks.splice(index, 1);
    this.rebuild();
    this.onSceneChanged?.();
  }

  private rayToSrc(e: PointerEvent, plane: THREE.Plane): Point | null {
    if (!this.ndc(e)) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    return this.worldToSrc(hit.x, hit.y);
  }

  private onPointerDown = (e: PointerEvent): void => {
    // A second finger landing mid-drag must not reach OrbitControls (which would
    // read the pair as a pinch) — swallow it and keep dragging with the first.
    if (this.dragState) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (this.mode === 'orbit' || e.button !== 0) return;

    // Weave tool: click the OVER strand, then the UNDER strand — pick bodies,
    // not endpoint handles. Clicking empty space still orbits.
    if (this.mode === 'weave') {
      const id = this.pickStrand(e);
      if (!id) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.handleWeavePick(id);
      return;
    }

    const hit = this.pickHandle(e);
    if (!hit) return; // missed every handle -> let OrbitControls orbit

    const ud = hit.userData;
    if (this.mode === 'attach' && ud.kind === 'endpoint' && !ud.attachable) {
      // occupied junction: not attachable, but still swallow the click so we
      // don't orbit off a handle the user meant to grab.
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // Claim the gesture: stop OrbitControls, keep receiving moves.
    e.stopImmediatePropagation();
    e.preventDefault();
    this.controls.enabled = false;
    this.activePointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not all environments support pointer capture */
    }

    const anchorWorld = hit.position.clone();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      anchorWorld,
    );

    if (this.mode === 'attach') {
      const parent = this.current.strands[ud.index as number];
      const side = ud.side as 0 | 1;
      const child = makeAttachedStrand(this.current, parent, side);
      this.current.strands.push(child); // new attachment stacks on top (highest Z)
      // Mark the parent side occupied now; the child already carries [true,false].
      // A full recompute is deferred to release — while the child is still
      // zero-length its end coincides with the junction and would be mismarked.
      parent.hasCircles[side] = true;
      this.dragState = { kind: 'attach', child, plane };
      this.rebuild();
      this.onSceneChanged?.();
    } else if (ud.kind === 'endpoint') {
      const index = ud.index as number;
      const side = ud.side as 0 | 1;
      const anchor: Point = { ...endpoint(this.current.strands[index], side) };
      // Freeze the connected set NOW (before positions change) so the whole
      // junction — this endpoint plus every strand glued to it — drags together.
      const targets: MoveTarget[] = connectedEndpoints(this.current, index, side).map((r) => {
        const s = this.current.strands[r.index];
        return {
          strand: s,
          side: r.side,
          cpAtAnchor: [
            pointsClose(s.control_points[0], anchor),
            pointsClose(s.control_points[1], anchor),
          ],
          centerAtAnchor: !!s.control_point_center && pointsClose(s.control_point_center, anchor),
        };
      });
      this.dragState = { kind: 'move-endpoint', plane, targets };
    } else {
      const strand = this.current.strands[ud.index as number];
      const handle = ud.cp as ControlHandle;
      // OSS applies the press side effects before any movement: grabbing the
      // triangle opens the set, grabbing the centre is what locks it.
      beginControlDrag(strand, handle);
      this.dragState = { kind: 'move-control', plane, strand, handle };
      this.rebuild(); // the newly revealed marks appear under the cursor at once
    }
    this.setCursor('grabbing');
  };

  /** Events from a finger that isn't the one driving the current drag. */
  private isStrayPointer(e: PointerEvent): boolean {
    return this.activePointerId !== null && e.pointerId !== this.activePointerId;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.isStrayPointer(e)) return;
    if (this.dragState) {
      this.applyDrag(e);
      return;
    }
    // Hover is a mouse-only idea: a touch "move" only ever happens mid-gesture, so
    // reading it as hover would light up handles under a finger that is orbiting.
    if (this.mode !== 'orbit' && e.buttons === 0 && e.pointerType === 'mouse') {
      this.updateHover(e);
    }
  };

  private applyDrag(e: PointerEvent): void {
    const st = this.dragState;
    if (!st) return;
    const src = this.rayToSrc(e, st.plane);
    if (!src) return;

    if (st.kind === 'attach') {
      // Only the child's end grows; its start (and control points) stay pinned to
      // the parent junction, so it reads as a straight strand while dragging.
      setEndpoint(st.child, 1, src);
    } else if (st.kind === 'move-endpoint') {
      for (const t of st.targets) {
        setEndpoint(t.strand, t.side, src);
        // Keep control points that were pinned to this junction glued to it, so a
        // straight strand stays straight as its endpoint moves (OSS's `start`
        // setter does the same for whatever coincides with the old start).
        if (t.cpAtAnchor[0]) t.strand.control_points[0] = { ...src };
        if (t.cpAtAnchor[1]) t.strand.control_points[1] = { ...src };
        if (t.centerAtAnchor && t.strand.control_point_center) {
          t.strand.control_point_center = { ...src };
        }
        // A circle nobody has claimed rides with the end it belongs to.
        if (t.side === 1) syncPassiveCp2(t.strand);
        updateControlCenter(t.strand);
      }
    } else {
      dragControl(st.strand, st.handle, src);
    }
    this.rebuild();
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isStrayPointer(e)) return;
    const st = this.dragState;
    if (!st) return;
    this.dragState = null;
    this.activePointerId = null;
    this.controls.enabled = true;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (st.kind === 'attach') {
      const child = st.child;
      const len = Math.hypot(child.end.x - child.start.x, child.end.y - child.start.y);
      if (len < MIN_ATTACH_LEN) {
        removeStrandAt(this.current, this.current.strands.indexOf(child));
      }
      recomputeOccupancy(this.current);
      this.rebuild();
      this.onSceneChanged?.();
    } else {
      // Putting the circle back on the start (with the centre free or back there
      // too) means the strand is untouched again, so the set folds away.
      if (st.kind === 'move-control') settleControls(st.strand);
      this.rebuild();
    }
    this.setCursor(this.mode === 'orbit' ? '' : 'crosshair');
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.isStrayPointer(e)) return;
    if (!this.dragState) return;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.cancelDrag();
    this.rebuild();
    this.setCursor(this.mode === 'orbit' ? '' : 'crosshair');
  };

  private updateHover(e: PointerEvent): void {
    const obj = this.pickHandle(e);
    const grabbable =
      !!obj &&
      !(this.mode === 'attach' && obj.userData.kind === 'endpoint' && !obj.userData.attachable);

    if (this.hovered && this.hovered !== obj) this.restoreHandle(this.hovered);
    if (grabbable && obj) {
      if (this.hovered !== obj) this.highlightHandle(obj);
      this.hovered = obj;
      this.setCursor('grab');
    } else {
      this.hovered = null;
      this.setCursor('crosshair');
    }
  }

  private highlightHandle(mesh: THREE.Mesh): void {
    mesh.scale.setScalar((mesh.userData.baseRadius as number) * 1.4);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(mesh.userData.baseColor as number).lerp(new THREE.Color(0xffffff), 0.45);
  }

  private restoreHandle(mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
    if (!mat || !mat.color) return; // material may have been disposed by a rebuild
    mesh.scale.setScalar(mesh.userData.baseRadius as number);
    mat.color.set(mesh.userData.baseColor as number);
  }

  private setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  private computeCenter(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const s of this.current.strands) {
      if (s.isMask) continue;
      for (const p of [s.start, s.end, s.control_points[0], s.control_points[1]]) {
        any = true;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!any) {
      this.center = { x: 0, y: 0 };
      this.contentRadius = 10;
      return;
    }
    this.center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const halfW = ((maxX - minX) / 2) * SCALE;
    const halfH = ((maxY - minY) / 2) * SCALE;
    this.contentRadius = Math.max(2, Math.hypot(halfW, halfH));
  }

  private updateGrid(): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    if (!this.params.showGrid) return;
    const size = Math.ceil(this.contentRadius * 2.6);
    const grid = new THREE.GridHelper(size * 2, size * 2, 0xb8c0cc, 0xd4dae2);
    grid.rotation.x = Math.PI / 2; // lie in the XY (drawing) plane
    // Sit clear below the lowest resting plane AND below anything the weave dips.
    const drop = Math.max(this.params.thickness, this.params.weaveDepth) * SCALE * 1.6;
    grid.position.z = this.lowestZ - drop;
    this.grid = grid;
    this.scene.add(grid);
  }

  /** Frame the content: point the camera at the center and back off to fit. */
  fitView(): void {
    const r = this.contentRadius * 1.15;
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 180 / 2);
    const dir = new THREE.Vector3(0.35, -1.0, 0.85).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.camera.near = Math.max(0.01, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Snap to a straight-down view — the familiar OpenStrand top-down look. */
  topView(): void {
    const dist = (this.contentRadius * 1.15) / Math.sin((this.camera.fov * Math.PI) / 180 / 2);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 0, dist);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private disposeGroup(): void {
    this.strandGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.strandGroup.clear();
  }

  private disposeHandles(): void {
    // Geometries are shared between handles (handleGeo / triGeo / circGeo / sqGeo)
    // — only the per-handle materials are ours to free here.
    this.handleGroup.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
    this.handleGroup.clear();
    for (const line of this.controlLines.children) {
      const l = line as THREE.LineSegments;
      l.geometry.dispose(); // built per rebuild, unlike the handle shapes
      (l.material as THREE.Material).dispose();
    }
    this.controlLines.clear();
    this.hovered = null;
  }

  /** Match the drawing buffer and the camera to the canvas's own box.
   *
   *  It used to measure the PARENT, which is the flex row holding the canvas AND
   *  the side panel — so the camera got the whole window's aspect while the canvas
   *  element was panel-width narrower, and the picture was squeezed horizontally
   *  to fit. Harmless-looking on a wide desktop, brutal on a phone where the panel
   *  is most of the viewport. */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

// Subdivide a polyline so no segment is longer than maxSeg. Straight strands are
// sampled as just two points; the weave needs intermediate samples to lift and
// dip smoothly through a crossing, so we densify before building the height
// field. Capped so a pathological input can't blow up.
function densify(poly: Vec2[], maxSeg: number): Vec2[] {
  if (poly.length < 2) return poly;
  const cap = 600;
  const out: Vec2[] = [poly[0]];
  for (let i = 1; i < poly.length && out.length < cap; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / maxSeg));
    for (let k = 1; k <= n && out.length < cap; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(poly: Vec2[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Exact RGBA equality — used to decide whether glued strands can share one mesh.
function sameColor(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
