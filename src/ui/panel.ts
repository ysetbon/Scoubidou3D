// The control panel: view buttons, global ribbon sliders, scene loaders, and the
// layer stack. The panel owns the working Scene3D and pushes changes into the
// StrandScene. Reordering a layer here restacks it in Z — the direct 3D analogue
// of moving a layer in OpenStrand's layer panel.

import { StrandScene, EditMode } from '../scene/StrandScene';
import { MaskLink, Scene3D, Strand3D, RGBA } from '../model/types';
import { SAMPLE_LABELS, makeSample } from '../model/samples';
import { parseSceneText, sceneFromFile, sceneToJson } from '../model/sceneIO';
import { deleteCustom, getCustom, listCustom, saveCustom, storageAvailable } from '../model/customSamples';

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
    // Attach/finalize adds a strand layer, a weave pick adds a mask layer — both
    // land in the layer stack, and the tool note tracks the pending weave pick.
    this.view.onSceneChanged = () => {
      this.scene = this.view.getScene();
      this.renderLayers();
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
  // The 3D home of OpenStrand Studio's masks. Depth/Span control the shape of a
  // crossing; the masks themselves live in the layer stack, as in OSS.
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
        'Depth is how far a lace lifts over / dips under a crossing — the same either way, however far apart the two layers are. Each mask appears as its own layer below; with no mask on a crossing, the higher layer wins.',
      ),
    );
    return sec;
  }

  // ---- Scene loaders -------------------------------------------------------
  private sceneHost: HTMLElement | null = null;
  // Whether the JSON box, the paste box and the name field are showing.
  private dataOpen = false;
  private pasteOpen = false;
  private namingOpen = false;

  private sceneSection(): HTMLElement {
    const sec = section('Scene');
    this.sceneHost = el('div');
    sec.appendChild(this.sceneHost);
    this.renderSceneControls();
    return sec;
  }

  private renderSceneControls(): void {
    const host = this.sceneHost;
    if (!host) return;
    host.innerHTML = '';

    const saved = listCustom();

    const sampleRow = el('div', 'field');
    sampleRow.appendChild(el('label', 'field-label', 'Sample'));
    const select = el('select', 'select');
    if (this.sceneSource === 'imported') {
      const opt = el('option');
      opt.value = 'imported';
      opt.textContent = `↳ ${this.scene.name}`;
      select.appendChild(opt);
    }
    const builtIn = el('optgroup') as HTMLOptGroupElement;
    builtIn.label = 'Built-in';
    for (const s of SAMPLE_LABELS) {
      const opt = el('option');
      opt.value = s.key;
      opt.textContent = s.label;
      builtIn.appendChild(opt);
    }
    select.appendChild(builtIn);
    if (saved.length) {
      const mine = el('optgroup') as HTMLOptGroupElement;
      mine.label = 'Saved by you';
      for (const c of saved) {
        const opt = el('option');
        opt.value = c.id;
        opt.textContent = c.scene.name;
        mine.appendChild(opt);
      }
      select.appendChild(mine);
    }
    select.value = this.sceneSource;
    select.addEventListener('change', () => this.loadSource(select.value));
    sampleRow.appendChild(select);
    host.appendChild(sampleRow);

    const row = el('div', 'btn-row');
    row.append(
      button('Import .json', () => fileInput.click()),
      button('Add strand', () => this.addStrand()),
    );
    host.appendChild(row);

    // Saving keeps the scene exactly as it stands — strands, masks and all — so a
    // layout worked out by hand can be reloaded, handed to someone else, or pasted
    // into samples.ts to become a built-in.
    const saveRow = el('div', 'btn-row');
    saveRow.append(
      button('Save sample', () => {
        this.namingOpen = !this.namingOpen;
        this.renderSceneControls();
      }),
      button(this.dataOpen ? 'Hide JSON' : 'Show JSON', () => {
        this.dataOpen = !this.dataOpen;
        this.renderSceneControls();
      }),
    );
    host.appendChild(saveRow);

    // Naming uses an inline field rather than window.prompt: modal dialogs are
    // blocked inside a sandboxed frame, which is exactly where this page runs when
    // it is published.
    if (this.namingOpen) {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', 'field-label', 'Save this scene as'));
      const input = el('input', 'text-input') as HTMLInputElement;
      input.type = 'text';
      input.value = this.scene.name;
      wrap.appendChild(input);
      const go = el('div', 'btn-row');
      go.append(
        button('Save', () => this.saveSample(input.value)),
        button('Cancel', () => {
          this.namingOpen = false;
          this.renderSceneControls();
        }),
      );
      wrap.appendChild(go);
      if (!storageAvailable()) {
        wrap.appendChild(
          el('div', 'note', 'This view blocks local storage, so this will not persist — use Show JSON to keep a copy.'),
        );
      }
      host.appendChild(wrap);
      window.setTimeout(() => input.select(), 0);
    }

    // The scene as text, right there in the panel. Clipboard writes and modal
    // prompts can both be refused in a sandboxed frame, so the reliable route is a
    // textarea you can select from by hand.
    if (this.dataOpen) {
      const json = sceneToJson(this.scene);
      const area = el('textarea', 'json-box') as HTMLTextAreaElement;
      area.value = json;
      area.readOnly = true;
      area.spellcheck = false;
      host.appendChild(area);

      const tools = el('div', 'btn-row');
      tools.appendChild(
        button('Select all', () => {
          area.focus();
          area.select();
        }),
      );
      tools.appendChild(button('Copy', () => this.copyJson(json, area)));
      if (window.claude?.downloads) {
        tools.appendChild(button('Download', () => this.downloadJson(json)));
      }
      host.appendChild(tools);
      host.appendChild(
        el('div', 'note', `${this.scene.strands.length} strands · ${this.scene.masks.length} masks · ${json.length} characters`),
      );
    }

    // Loading by paste, for the same reason: a file picker is not always usable.
    const pasteRow = el('div', 'btn-row');
    pasteRow.appendChild(
      button(this.pasteOpen ? 'Cancel paste' : 'Paste a scene', () => {
        this.pasteOpen = !this.pasteOpen;
        this.renderSceneControls();
      }),
    );
    host.appendChild(pasteRow);

    if (this.pasteOpen) {
      const area = el('textarea', 'json-box') as HTMLTextAreaElement;
      area.placeholder = 'Paste scene JSON (or an OpenStrand .json) here, then press Load.';
      area.spellcheck = false;
      host.appendChild(area);
      const go = el('div', 'btn-row');
      go.appendChild(
        button('Load', () => {
          const text = area.value.trim();
          if (!text) return;
          try {
            const scene = parseSceneText(text, 'pasted scene');
            this.pasteOpen = false;
            this.sceneSource = 'imported';
            this.setScene(scene);
          } catch (e) {
            alert('Could not read that: ' + (e as Error).message);
          }
        }),
      );
      host.appendChild(go);
    }

    const current = saved.find((c) => c.id === this.sceneSource);
    if (current) {
      const delRow = el('div', 'btn-row');
      delRow.appendChild(
        button(`Delete “${current.scene.name}”`, () => {
          deleteCustom(current.id);
          this.sceneSource = 'two-crossing';
          this.setScene(makeSample('two-crossing'));
        }),
      );
      host.appendChild(delRow);
    }

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
        this.setScene(parseSceneText(text, f.name.replace(/\.json$/i, '')));
      } catch (e) {
        alert('Could not read that file: ' + (e as Error).message);
      }
      fileInput.value = '';
    });
    host.appendChild(fileInput);

    const note = el('div', 'note');
    note.innerHTML = storageAvailable()
      ? 'Opens OpenStrand Studio / OpenStrandJS saves and scenes saved here. <b>Save sample</b> keeps the current scene in this browser, so it survives a refresh; <b>Copy JSON</b> gives you the text to share.'
      : 'Opens OpenStrand Studio / OpenStrandJS saves. This browser is blocking local storage, so samples cannot be saved — use <b>Copy JSON</b> instead.';
    host.appendChild(note);
  }

  private loadSource(key: string): void {
    this.sceneSource = key;
    const custom = getCustom(key);
    if (custom) {
      try {
        this.setScene(sceneFromFile(custom.scene, custom.scene.name));
        return;
      } catch (e) {
        alert('That saved sample could not be opened: ' + (e as Error).message);
      }
    }
    this.setScene(makeSample(key));
  }

  private saveSample(rawName: string): void {
    const name = rawName.trim();
    if (!name) return;
    const entry = saveCustom(this.scene, name);
    this.scene.name = name;
    this.namingOpen = false;
    if (!entry) {
      // Storage refused (sandboxed or private-mode view, or a full quota). Don't
      // pretend it saved — open the JSON so the work can still be kept.
      this.dataOpen = true;
      this.renderSceneControls();
      this.flashNote('Could not save here — local storage is blocked. The JSON below is your copy.');
      return;
    }
    this.sceneSource = entry.id;
    this.renderSceneControls();
    this.flashNote(`Saved as “${name}”. It will still be here after a refresh.`);
  }

  private async copyJson(text: string, area: HTMLTextAreaElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.flashNote('Copied.');
    } catch {
      // A sandboxed frame can refuse clipboard writes outright; fall back to
      // selecting the text so the keyboard shortcut works.
      area.focus();
      area.select();
      this.flashNote('Clipboard blocked here — the text is selected, press Ctrl/Cmd+C.');
    }
  }

  private async downloadJson(text: string): Promise<void> {
    const api = window.claude?.downloads;
    if (!api) return;
    const filename = `${this.scene.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'scene'}.json`;
    try {
      await api.save({ filename, data: text });
      this.flashNote(`Saved ${filename}.`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return; // viewer said no; never auto-retry
      this.flashNote('Download unavailable here — copy the text instead.');
    }
  }

  private flashNote(message: string): void {
    if (!this.sceneHost) return;
    const flash = el('div', 'note flash', message);
    this.sceneHost.appendChild(flash);
    window.setTimeout(() => flash.remove(), 2600);
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
    // Mask layers first: OSS appends a MaskedStrand to the end of the strand list,
    // which is the top of the layer panel. A mask is named `over_under` there
    // (`first_second`), so `1_2_1_3` reads "1_2 crosses over 1_3".
    this.scene.masks.forEach((m, i) => this.layersHost!.appendChild(this.maskRow(m, i)));
    // Then the strands, topmost first (last in the array is highest Z).
    for (let i = this.scene.strands.length - 1; i >= 0; i--) {
      this.layersHost.appendChild(this.layerRow(i));
    }
  }

  /** A mask layer row. The badge shows the two strands' own colors, over on top
   *  of under, so the row states the relationship at a glance. */
  private maskRow(mask: MaskLink, index: number): HTMLElement {
    const row = el('div', 'layer layer-mask');

    const over = this.scene.strands.find((s) => s.id === mask.overId);
    const under = this.scene.strands.find((s) => s.id === mask.underId);
    const badge = el('div', 'mask-badge');
    if (over && under) {
      badge.style.background = `linear-gradient(180deg, ${hex(over.color)} 50%, ${hex(under.color)} 50%)`;
    }
    badge.title = `${mask.overId} over ${mask.underId}`;
    row.appendChild(badge);

    const nameWrap = el('div', 'layer-name');
    nameWrap.appendChild(el('span', 'layer-id', `${mask.overId}_${mask.underId}`));
    nameWrap.appendChild(el('span', 'layer-tag', 'mask'));
    row.appendChild(nameWrap);

    const controls = el('div', 'layer-controls');

    const flip = el('button', 'icon-btn', '⇅');
    flip.title = `${mask.overId} rides over ${mask.underId} — click to swap`;
    flip.addEventListener('click', () => this.view.flipMask(index));
    controls.appendChild(flip);

    const del = el('button', 'icon-btn danger', '✕');
    del.title = 'Delete mask layer';
    del.addEventListener('click', () => this.view.removeMask(index));
    controls.appendChild(del);

    row.appendChild(controls);
    return row;
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
