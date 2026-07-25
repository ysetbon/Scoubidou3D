// The control panel: view buttons, global ribbon sliders, scene loaders, and the
// layer stack. The panel owns the working Scene3D and pushes changes into the
// StrandScene. Reordering a layer here restacks it in Z — the direct 3D analogue
// of moving a layer in OpenStrand's layer panel.

import { StrandScene, EditMode } from '../scene/StrandScene';
import { Scene3D, Strand3D, RGBA } from '../model/types';
import { SAMPLE_LABELS, makeSample } from '../model/samples';
import { sceneFromJsonText } from '../model/importOss';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function hex(c: RGBA): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function rgbaFromHex(hexStr: string, a: number): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexStr);
  if (!m) return { r: 0, g: 0, b: 0, a };
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a };
}

export class Panel {
  private scene: Scene3D;
  // Which entry the Sample dropdown should show: a sample key, or 'imported'
  // for a loaded file (the file name is shown as an extra option).
  private sceneSource = 'two-crossing';

  constructor(private root: HTMLElement, private view: StrandScene) {
    this.scene = view.getScene();
    // Attach/finalize adds a layer; weave picks change the tool note and masks.
    // Keep all three in sync after any in-scene edit.
    this.view.onSceneChanged = () => {
      this.scene = this.view.getScene();
      this.renderLayers();
      this.renderMasks();
      this.renderTools();
    };
    this.render();
  }

  setScene(scene: Scene3D): void {
    this.scene = scene;
    this.view.setScene(scene, true);
    this.render();
  }

  private apply(refit = false): void {
    this.view.setScene(this.scene, refit);
    this.renderLayers();
  }

  private render(): void {
    this.root.innerHTML = '';

    const brand = el('div', 'brand');
    brand.appendChild(el('div', 'brand-title', 'Scoubidou3D'));
    brand.appendChild(el('div', 'brand-sub', 'strands with real depth · orbit to explore'));
    this.root.appendChild(brand);

    this.root.appendChild(this.toolSection());
    this.root.appendChild(this.viewSection());
    this.root.appendChild(this.ribbonSection());
    this.root.appendChild(this.weaveSection());
    this.root.appendChild(this.sceneSection());
    this.root.appendChild(this.layersSection());

    const hint = el('div', 'hint');
    hint.innerHTML = 'Drag to orbit · scroll to zoom · right-drag to pan';
    this.root.appendChild(hint);
  }

  // ---- Tool (Orbit / Move / Attach) ---------------------------------------
  // The 3D analogue of OpenStrand Studio's toolbar. Orbit is pure camera; Move
  // drags endpoints & control points (connected strands follow); Attach pulls a
  // new strand out of a free endpoint.
  private toolHost: HTMLElement | null = null;

  private toolSection(): HTMLElement {
    const sec = section('Tool');
    this.toolHost = el('div');
    sec.appendChild(this.toolHost);
    this.renderTools();
    return sec;
  }

  private renderTools(): void {
    if (!this.toolHost) return;
    this.toolHost.innerHTML = '';
    const mode = this.view.getMode();

    const row = el('div', 'btn-row');
    const tools: Array<{ key: EditMode; label: string }> = [
      { key: 'orbit', label: 'Orbit' },
      { key: 'move', label: 'Move' },
      { key: 'attach', label: 'Attach' },
      { key: 'weave', label: 'Weave' },
    ];
    for (const t of tools) {
      const b = el('button', 'btn tool-btn' + (mode === t.key ? ' active' : ''), t.label);
      b.addEventListener('click', () => {
        this.view.setMode(t.key);
        this.renderTools();
        this.renderMasks();
      });
      row.appendChild(b);
    }
    this.toolHost.appendChild(row);

    const note = el('div', 'note');
    if (mode === 'attach') {
      note.innerHTML =
        'Pull from a <b style="color:#2fb862">green</b> endpoint to grow a new attached strand (it joins the same set and stacks on top). Gray endpoints are already joined.';
    } else if (mode === 'move') {
      note.innerHTML =
        'Drag a <b style="color:#2f7bd6">blue</b> endpoint — connected strands follow. Drag an <b style="color:#e0872a">orange</b> dot to bend the strand.';
    } else if (mode === 'weave') {
      const pending = this.view.getWeavePending();
      note.innerHTML = pending
        ? `<b style="color:#2fb862">${pending}</b> rides over — now click the strand it should cross <b>over</b> (click it again to cancel).`
        : 'Click the strand that goes <b>over</b>, then the one it goes <b>under</b>. They interlock at their crossing — the 3D version of an OpenStrand mask.';
    } else {
      note.textContent = 'Orbit the camera freely. Switch to Move, Attach or Weave to edit strands in place.';
    }
    this.toolHost.appendChild(note);
  }

  // ---- View ----------------------------------------------------------------
  private viewSection(): HTMLElement {
    const sec = section('View');
    const row = el('div', 'btn-row');
    const fit = button('Fit', () => this.view.fitView());
    const top = button('Top', () => this.view.topView());
    row.append(fit, top);
    sec.appendChild(row);
    return sec;
  }

  // ---- Ribbon params -------------------------------------------------------
  private ribbonSection(): HTMLElement {
    const sec = section('Ribbon');
    const p = this.view.getParams();

    sec.appendChild(
      slider('Thickness', p.thickness, 2, 120, 1, (v) => this.view.setParams({ thickness: v })),
    );
    sec.appendChild(
      slider('Width scale', p.widthScale, 0.2, 3, 0.05, (v) => this.view.setParams({ widthScale: v })),
    );

    const toggles = el('div', 'toggle-row');
    toggles.append(
      toggle('Outline', p.outline, (v) => this.view.setParams({ outline: v })),
      toggle('Round ends', p.roundCaps, (v) => this.view.setParams({ roundCaps: v })),
      toggle('Grid', p.showGrid, (v) => this.view.setParams({ showGrid: v })),
    );
    sec.appendChild(toggles);
    return sec;
  }

  // ---- Weave (over / under) ------------------------------------------------
  // The 3D home of OpenStrand Studio's masks. Depth controls how far a lace
  // lifts over / dips under; the mask list shows every over/under override.
  private weaveHost: HTMLElement | null = null;

  private weaveSection(): HTMLElement {
    const sec = section('Weave  (over / under)');
    const p = this.view.getParams();

    const toggles = el('div', 'toggle-row');
    toggles.append(toggle('Weave', p.weave, (v) => this.view.setParams({ weave: v })));
    sec.appendChild(toggles);

    sec.appendChild(slider('Depth', p.weaveDepth, 0, 120, 1, (v) => this.view.setParams({ weaveDepth: v })));
    sec.appendChild(slider('Span', p.weaveSpan, 0.4, 3, 0.05, (v) => this.view.setParams({ weaveSpan: v })));
    sec.appendChild(slider('Layer lift', p.layerGap, 0, 80, 1, (v) => this.view.setParams({ layerGap: v })));

    sec.appendChild(
      el(
        'div',
        'note',
        'Depth is how far a lace lifts over / dips under a crossing. Use the Weave tool to set which strand is on top; with no mask, the higher layer wins.',
      ),
    );

    this.weaveHost = el('div', 'masks');
    sec.appendChild(this.weaveHost);
    this.renderMasks();
    return sec;
  }

  private renderMasks(): void {
    if (!this.weaveHost) return;
    this.weaveHost.innerHTML = '';
    const masks = this.scene.masks;
    if (!masks.length) return;
    this.weaveHost.appendChild(
      el('div', 'note', `${masks.length} over/under mask${masks.length > 1 ? 's' : ''}:`),
    );
    masks.forEach((m, i) => {
      const row = el('div', 'mask-row');
      const text = el('span', 'mask-text');
      text.innerHTML = `<b>${m.overId}</b> over <b>${m.underId}</b>`;
      row.appendChild(text);
      const flip = el('button', 'icon-btn', '⇅');
      flip.title = 'Flip over / under';
      flip.addEventListener('click', () => this.view.flipMask(i));
      const del = el('button', 'icon-btn danger', '✕');
      del.title = 'Remove mask';
      del.addEventListener('click', () => this.view.removeMask(i));
      row.append(flip, del);
      this.weaveHost!.appendChild(row);
    });
  }

  // ---- Scene loaders -------------------------------------------------------
  private sceneSection(): HTMLElement {
    const sec = section('Scene');

    const sampleRow = el('div', 'field');
    sampleRow.appendChild(el('label', 'field-label', 'Sample'));
    const select = el('select', 'select');
    if (this.sceneSource === 'imported') {
      const opt = el('option');
      opt.value = 'imported';
      opt.textContent = `↳ ${this.scene.name}`;
      select.appendChild(opt);
    }
    for (const s of SAMPLE_LABELS) {
      const opt = el('option');
      opt.value = s.key;
      opt.textContent = s.label;
      select.appendChild(opt);
    }
    select.value = this.sceneSource;
    select.addEventListener('change', () => {
      this.sceneSource = select.value;
      this.setScene(makeSample(select.value));
    });
    sampleRow.appendChild(select);
    sec.appendChild(sampleRow);

    const row = el('div', 'btn-row');
    const importBtn = button('Import .json', () => fileInput.click());
    const addBtn = button('Add strand', () => this.addStrand());
    row.append(importBtn, addBtn);
    sec.appendChild(row);

    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        this.sceneSource = 'imported';
        this.setScene(sceneFromJsonText(text, f.name.replace(/\.json$/i, '')));
      } catch (e) {
        alert('Could not read that file as an OpenStrand .json: ' + (e as Error).message);
      }
      fileInput.value = '';
    });
    sec.appendChild(fileInput);

    const note = el('div', 'note', 'Loads OpenStrand Studio / OpenStrandJS save files. Masks become a real over/under weave.');
    sec.appendChild(note);
    return sec;
  }

  private addStrand(): void {
    const n = this.scene.strands.length;
    const angle = (n * 37) % 360;
    const rad = (angle * Math.PI) / 180;
    const cx = 400;
    const cy = 250;
    const len = 220;
    // Start a new set (OSS-style `N_1`) so a later Attach grows it into `N_2`…
    let maxSet = 0;
    for (const st of this.scene.strands) {
      const m = /^(\d+)_/.exec(st.id);
      if (m) maxSet = Math.max(maxSet, parseInt(m[1], 10));
    }
    const s: Strand3D = {
      id: `${maxSet + 1}_1`,
      start: { x: cx - Math.cos(rad) * len, y: cy - Math.sin(rad) * len },
      end: { x: cx + Math.cos(rad) * len, y: cy + Math.sin(rad) * len },
      control_points: [{ x: cx, y: cy }, { x: cx, y: cy }],
      control_point_center: null,
      control_point_center_locked: false,
      width: 46,
      stroke_width: 4,
      color: PALETTE[n % PALETTE.length],
      stroke_color: { r: 30, g: 30, b: 30, a: 255 },
      thickness: null,
      visible: true,
      isMask: false,
      hasCircles: [false, false],
      parentId: null,
      parentSide: null,
    };
    // New strand goes on top of the stack (highest layer).
    this.scene.strands.push(s);
    this.apply(false);
  }

  // ---- Layer stack ---------------------------------------------------------
  private layersHost: HTMLElement | null = null;

  private layersSection(): HTMLElement {
    const sec = section('Layers  (top = front)');
    this.layersHost = el('div', 'layers');
    sec.appendChild(this.layersHost);
    this.renderLayers();
    return sec;
  }

  private renderLayers(): void {
    if (!this.layersHost) return;
    this.layersHost.innerHTML = '';
    // Show topmost layer first (last in the array is highest Z).
    for (let i = this.scene.strands.length - 1; i >= 0; i--) {
      this.layersHost.appendChild(this.layerRow(i));
    }
  }

  private layerRow(index: number): HTMLElement {
    const strand = this.scene.strands[index];
    const row = el('div', 'layer' + (strand.isMask ? ' layer-mask' : ''));

    const swatch = el('input', 'swatch') as HTMLInputElement;
    swatch.type = 'color';
    swatch.value = hex(strand.color);
    swatch.title = 'Strand color';
    swatch.addEventListener('input', () => {
      strand.color = rgbaFromHex(swatch.value, strand.color.a);
      this.apply(false);
    });
    row.appendChild(swatch);

    const nameWrap = el('div', 'layer-name');
    nameWrap.appendChild(el('span', 'layer-id', strand.id));
    if (strand.isMask) nameWrap.appendChild(el('span', 'layer-tag', 'mask'));
    // Show attach lineage — the OSS "this strand hangs off <parent>" relationship.
    if (strand.parentId) nameWrap.appendChild(el('span', 'layer-tag', `↳ ${strand.parentId}`));
    row.appendChild(nameWrap);

    const controls = el('div', 'layer-controls');

    const vis = el('button', 'icon-btn', strand.visible ? '●' : '○');
    vis.title = 'Show / hide';
    vis.addEventListener('click', () => {
      strand.visible = !strand.visible;
      this.apply(false);
    });
    controls.appendChild(vis);

    const up = el('button', 'icon-btn', '▲');
    up.title = 'Move up (toward front)';
    up.disabled = index === this.scene.strands.length - 1;
    up.addEventListener('click', () => this.reorder(index, +1));
    controls.appendChild(up);

    const down = el('button', 'icon-btn', '▼');
    down.title = 'Move down (toward back)';
    down.disabled = index === 0;
    down.addEventListener('click', () => this.reorder(index, -1));
    controls.appendChild(down);

    const del = el('button', 'icon-btn danger', '✕');
    del.title = 'Delete';
    del.addEventListener('click', () => {
      this.scene.strands.splice(index, 1);
      this.apply(false);
    });
    controls.appendChild(del);

    row.appendChild(controls);
    return row;
  }

  private reorder(index: number, dir: 1 | -1): void {
    const j = index + dir;
    if (j < 0 || j >= this.scene.strands.length) return;
    const arr = this.scene.strands;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    this.apply(false);
  }
}

const PALETTE: RGBA[] = [
  { r: 245, g: 200, b: 55, a: 255 },
  { r: 226, g: 122, b: 38, a: 255 },
  { r: 60, g: 170, b: 175, a: 255 },
  { r: 210, g: 90, b: 110, a: 255 },
  { r: 120, g: 140, b: 220, a: 255 },
  { r: 240, g: 240, b: 240, a: 255 },
];

// ---- small DOM builders ----------------------------------------------------
function section(title: string): HTMLElement {
  const sec = el('section', 'panel-section');
  sec.appendChild(el('h3', 'section-title', title));
  return sec;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'btn', label);
  b.addEventListener('click', onClick);
  return b;
}

function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = el('label', 'toggle');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.appendChild(el('span', undefined, label));
  return wrap;
}

function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = el('div', 'slider');
  const head = el('div', 'slider-head');
  head.appendChild(el('span', 'slider-label', label));
  const val = el('span', 'slider-val', fmt(value));
  head.appendChild(val);
  wrap.appendChild(head);
  const input = el('input') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onChange(v);
  });
  wrap.appendChild(input);
  return wrap;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
