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
import { Scene3D, Strand3D, RGBA, Point } from '../model/types';
import {
  connectedEndpoints,
  endpoint,
  makeAttachedStrand,
  pointsClose,
  recomputeOccupancy,
  setEndpoint,
} from '../model/connections';
import { sampleCenterline } from '../geometry/bezier';
import { buildRibbonGeometry } from '../geometry/ribbon';
import { Vec2 } from '../geometry/vec';

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

export type EditMode = 'orbit' | 'move' | 'attach';

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
  layerGap: number; // Z distance between consecutive layers, source units
  widthScale: number; // multiplier applied to every strand width
  outline: boolean; // draw the stroke-colored outline shell
  roundCaps: boolean; // rounded strand ends
  showGrid: boolean;
}

export const DEFAULT_PARAMS: RenderParams = {
  thickness: 26,
  layerGap: 30,
  widthScale: 1,
  outline: true,
  roundCaps: true,
  showGrid: true,
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
  private current: Scene3D = { strands: [], name: 'empty' };
  private params: RenderParams = { ...DEFAULT_PARAMS };
  private center: Vec2 = { x: 0, y: 0 };
  private contentRadius = 10;

  private mode: EditMode = 'orbit';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private handleGeo = new THREE.SphereGeometry(1, 18, 12);
  private dragState: DragState | null = null;
  private hovered: THREE.Mesh | null = null;

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
    this.rebuild();
    this.setCursor(mode === 'orbit' ? '' : 'crosshair');
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

  /** Rebuild all ribbon meshes (and edit handles) from the current scene + params. */
  rebuild(): void {
    this.disposeGroup();

    const n = this.current.strands.length;
    const gap = this.params.layerGap * SCALE;
    // Center the stack in Z around 0.
    const zBase = -((n - 1) * gap) / 2;

    this.current.strands.forEach((strand, layerIndex) => {
      if (!strand.visible || strand.isMask) return;
      const mesh = this.buildStrandMesh(strand);
      if (!mesh) return;
      mesh.position.z = zBase + layerIndex * gap;
      this.strandGroup.add(mesh);
    });

    this.updateGrid();
    this.buildHandles();
  }

  private buildStrandMesh(strand: Strand3D): THREE.Object3D | null {
    // Sample the OSS-faithful centerline, then map source -> world XY.
    const srcCenter = sampleCenterline({
      start: strand.start,
      end: strand.end,
      control_points: strand.control_points,
      control_point_center: strand.control_point_center,
      control_point_center_locked: strand.control_point_center_locked,
    });
    const worldLine: Vec2[] = srcCenter.map((p) => ({
      x: (p.x - this.center.x) * SCALE,
      y: -(p.y - this.center.y) * SCALE, // flip: OSS y is down, world y is up
    }));
    if (worldLine.length < 2) return null;

    const width = strand.width * this.params.widthScale * SCALE;
    const thickness = (strand.thickness ?? this.params.thickness) * SCALE;
    if (width <= 0 || thickness <= 0) return null;

    const group = new THREE.Group();

    const fillGeom = buildRibbonGeometry(worldLine, {
      width,
      thickness,
      cornerRadius: thickness * 0.48,
      cornerSteps: 3,
      roundCaps: this.params.roundCaps,
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
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.castShadow = true;
    fillMesh.receiveShadow = true;
    fillMesh.userData.strandId = strand.id;
    group.add(fillMesh);

    if (this.params.outline && strand.stroke_width > 0) {
      const ow = strand.stroke_width * SCALE;
      const outlineGeom = buildRibbonGeometry(worldLine, {
        width: width + ow * 2,
        thickness: thickness + ow * 2,
        cornerRadius: (thickness + ow * 2) * 0.48,
        cornerSteps: 3,
        roundCaps: this.params.roundCaps,
      });
      const outlineMat = new THREE.MeshBasicMaterial({
        color: threeColor(strand.stroke_color),
        side: THREE.BackSide, // show only the shell's far faces => a rim outline
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

  private layerZ(layerIndex: number): number {
    const n = this.current.strands.length;
    const gap = this.params.layerGap * SCALE;
    return -((n - 1) * gap) / 2 + layerIndex * gap;
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
    if (this.mode === 'orbit') return;

    this.current.strands.forEach((strand, layerIndex) => {
      if (!strand.visible || strand.isMask) return;
      const z = this.layerZ(layerIndex);

      ([0, 1] as const).forEach((side) => {
        const occupied = strand.hasCircles[side];
        if (this.mode === 'attach') {
          const attachable = !occupied;
          const mesh = this.makeHandle(attachable ? END_R : OCC_R, attachable ? COLOR_FREE : COLOR_OCC);
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), z));
          mesh.userData.kind = 'endpoint';
          mesh.userData.index = layerIndex;
          mesh.userData.side = side;
          mesh.userData.attachable = attachable;
          this.handleGroup.add(mesh);
        } else {
          // move mode: every endpoint is draggable
          const mesh = this.makeHandle(END_R, COLOR_END);
          mesh.position.copy(this.srcToWorld(endpoint(strand, side), z));
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

  private rayToSrc(e: PointerEvent, plane: THREE.Plane): Point | null {
    if (!this.ndc(e)) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    return this.worldToSrc(hit.x, hit.y);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.mode === 'orbit' || e.button !== 0) return;
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
    const n = this.current.strands.length;
    const gap = this.params.layerGap * SCALE;
    grid.position.z = -((n - 1) * gap) / 2 - this.params.thickness * SCALE * 1.5;
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
