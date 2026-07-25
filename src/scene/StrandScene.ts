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
import { CameraView, MaskLink, Scene3D, Strand3D, RGBA, Point } from '../model/types';
import {
  collectJunctions,
  connectedEndpoints,
  endpoint,
  makeAttachedStrand,
  pointsClose,
  recomputeOccupancy,
  setEndpoint,
} from '../model/connections';
import { sampleCenterline } from '../geometry/bezier';
import { buildRibbonGeometry } from '../geometry/ribbon';
import { buildConnectorGeometry, ConnectorEnd } from '../geometry/connector';
import { easeFolds, roundCorners } from '../geometry/polyline';
import { Anchor, arcLengths, heightField, polylineCrossings } from '../geometry/weave';
import { Vec2, Vec3 } from '../geometry/vec';

// Source (pixel) units -> world units. Keeps camera distances comfortable.
const SCALE = 0.02;

// Handle appearance (world-unit radii + colors), tuned against SCALE so the grab
// dots read clearly at the default framing.
const END_R = 0.18;
const CP_R = 0.14;
const OCC_R = 0.12;
const COLOR_END = 0x2f7bd6; // move-mode endpoint (blue)
const COLOR_CP = 0xe0872a; // move-mode control point (orange)
const COLOR_FREE = 0x2fb862; // attach-mode free endpoint (green — attachable)
const COLOR_OCC = 0x9099a6; // attach-mode occupied endpoint (gray — junction)

// A drag shorter than this (source units) counts as a click, not an attach, and
// the just-created strand is discarded — the analogue of OSS's min_length guard.
const MIN_ATTACH_LEN = 4;

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
  | { kind: 'move-control'; plane: THREE.Plane; strand: Strand3D; cpIndex: 0 | 1 };

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
  private grid: THREE.GridHelper | null = null;
  private current: Scene3D = { strands: [], masks: [], name: 'empty' };
  private params: RenderParams = { ...DEFAULT_PARAMS };
  private center: Vec2 = { x: 0, y: 0 };
  private contentRadius = 10;

  private mode: EditMode = 'orbit';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private handleGeo = new THREE.SphereGeometry(1, 18, 12);
  private dragState: DragState | null = null;
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
    // A scene that remembers where it was looked at is restored to that view;
    // anything else (a sample, an OpenStrand import) gets framed by fitting.
    if (refit) {
      if (scene.camera) this.applyCameraView(scene.camera);
      else this.fitView();
    }
  }

  /** Where the camera is right now, in the form a scene file stores. */
  getCameraView(): CameraView {
    const p = this.camera.position;
    const t = this.controls.target;
    const round = (n: number) => Math.round(n * 1e4) / 1e4; // keep the JSON readable
    return {
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      target: { x: round(t.x), y: round(t.y), z: round(t.z) },
      fov: round(this.camera.fov),
    };
  }

  /** Put the camera back where a scene file says it stood. */
  applyCameraView(view: CameraView): void {
    this.camera.position.set(view.position.x, view.position.y, view.position.z);
    this.controls.target.set(view.target.x, view.target.y, view.target.z);
    if (view.fov > 0) this.camera.fov = view.fov;
    // Clip planes are derived, not stored: they depend only on how far the eye
    // ended up from what it is looking at, and a stored pair could easily be
    // wrong for a scene that has since been edited.
    const dist = Math.max(0.01, this.camera.position.distanceTo(this.controls.target));
    this.camera.near = Math.max(0.01, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
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
    this.controls.enabled = true;
    if (st && st.kind === 'attach') {
      const idx = this.current.strands.indexOf(st.child);
      if (idx >= 0) this.current.strands.splice(idx, 1);
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
      control_point_center: strand.control_point_center,
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
   * Shared by every strand in one LACE. A cord built from several strands glued
   * end to end (an OSS attached-strand family, or the folded arms of a stitch) is
   * one physical object, so giving each member its own layer height would make the
   * cord climb a staircase along its own length. Instead each connected group gets
   * one height, and groups are stacked in layer-panel order. Nothing is lost:
   * masks decide what happens at crossings, and this only sets the resting plane.
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
    const rank = new Map<number, number>();
    [...lowest.entries()]
      .sort((a, b) => a[1] - b[1])
      .forEach(([r], k) => rank.set(r, k));

    const gap = this.params.layerGap * SCALE;
    const levels = rank.size;
    const z0 = -((levels - 1) * gap) / 2;
    this.baseZ = new Array<number>(n);
    for (let i = 0; i < n; i++) this.baseZ[i] = z0 + (rank.get(find(i)) ?? 0) * gap;
    this.lowestZ = levels > 0 ? z0 : 0;
  }

  private layerZ(layerIndex: number): number {
    return this.baseZ[layerIndex] ?? 0;
  }

  // ---- edit handles --------------------------------------------------------
  private makeHandle(radius: number, colorHex: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: false, // always grabbable, even behind ribbons
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(this.handleGeo, mat);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 20;
    mesh.userData.baseColor = colorHex;
    mesh.userData.baseRadius = radius;
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
          const mesh = this.makeHandle(attachable ? END_R : OCC_R, attachable ? COLOR_FREE : COLOR_OCC);
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), endZ(side)));
          mesh.userData.kind = 'endpoint';
          mesh.userData.index = layerIndex;
          mesh.userData.side = side;
          mesh.userData.attachable = attachable;
          this.handleGroup.add(mesh);
        } else {
          // move mode: every endpoint is draggable
          const mesh = this.makeHandle(END_R, COLOR_END);
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), endZ(side)));
          mesh.userData.kind = 'endpoint';
          mesh.userData.index = layerIndex;
          mesh.userData.side = side;
          this.handleGroup.add(mesh);
        }
      });

      // Control-point handles (move mode only). For a straight strand both
      // control points sit on the start, which would stack them on the endpoint
      // handle — so display them at 1/3 and 2/3 along the strand instead, giving
      // a grabbable "bend here" dot. Dragging one writes the real control point.
      if (this.mode === 'move') {
        const straight =
          pointsClose(strand.control_points[0], strand.start) &&
          pointsClose(strand.control_points[1], strand.start);
        ([0, 1] as const).forEach((cp) => {
          const display = straight
            ? lerp(strand.start, strand.end, cp === 0 ? 1 / 3 : 2 / 3)
            : strand.control_points[cp];
          const mesh = this.makeHandle(CP_R, COLOR_CP);
          mesh.position.copy(this.srcToWorld(display, z));
          mesh.userData.kind = 'control';
          mesh.userData.index = layerIndex;
          mesh.userData.cp = cp;
          this.handleGroup.add(mesh);
        });
      }
    });
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

  private pickHandle(e: PointerEvent): THREE.Intersection | null {
    if (!this.ndc(e)) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleGroup.children, false);
    return hits.length ? hits[0] : null;
  }

  // Topmost strand id under the pointer (skips outline shells and connectors,
  // which carry no strandId). Used by the weave tool.
  private pickStrand(e: PointerEvent): string | null {
    if (!this.ndc(e)) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.strandGroup.children, true);
    for (const h of hits) {
      const id = h.object.userData?.strandId;
      if (typeof id === 'string') return id;
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

    const ud = hit.object.userData;
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
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not all environments support pointer capture */
    }

    const anchorWorld = (hit.object as THREE.Mesh).position.clone();
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
      this.dragState = {
        kind: 'move-control',
        plane,
        strand: this.current.strands[ud.index as number],
        cpIndex: ud.cp as 0 | 1,
      };
    }
    this.setCursor('grabbing');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragState) {
      this.applyDrag(e);
      return;
    }
    if (this.mode !== 'orbit' && e.buttons === 0) this.updateHover(e);
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
        // straight strand stays straight as its endpoint moves.
        if (t.cpAtAnchor[0]) t.strand.control_points[0] = { ...src };
        if (t.cpAtAnchor[1]) t.strand.control_points[1] = { ...src };
        if (t.centerAtAnchor && t.strand.control_point_center) {
          t.strand.control_point_center = { ...src };
        }
      }
    } else {
      st.strand.control_points[st.cpIndex] = { ...src };
      // Editing a control point directly detaches the auto-centered midpoint.
      st.strand.control_point_center_locked = false;
    }
    this.rebuild();
  }

  private onPointerUp = (e: PointerEvent): void => {
    const st = this.dragState;
    if (!st) return;
    this.dragState = null;
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
        const idx = this.current.strands.indexOf(child);
        if (idx >= 0) this.current.strands.splice(idx, 1);
      }
      recomputeOccupancy(this.current);
      this.rebuild();
      this.onSceneChanged?.();
    } else {
      this.rebuild();
    }
    this.setCursor(this.mode === 'orbit' ? '' : 'crosshair');
  };

  private onPointerCancel = (e: PointerEvent): void => {
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
    const hit = this.pickHandle(e);
    const obj = (hit?.object as THREE.Mesh) ?? null;
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
    for (const child of this.handleGroup.children) {
      const mat = (child as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.dispose(); // geometry is shared (handleGeo) — never dispose it here
    }
    this.handleGroup.clear();
    this.hovered = null;
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

// Linear interpolation between two source-space points.
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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
