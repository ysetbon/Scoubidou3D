// The control panel: view buttons, global ribbon sliders, scene loaders, and the
// layer stack. The panel owns the working Scene3D and pushes changes into the
// StrandScene. Reordering a layer here restacks it in Z — the direct 3D analogue
// of moving a layer in OpenStrand's layer panel.

import { StrandScene, EditMode } from '../scene/StrandScene';
import { MaskLink, Scene3D, Strand3D, RGBA } from '../model/types';
import { SAMPLE_LABELS, TWIST_FAMILY, TWIST_MAX, makeSample } from '../model/samples';
import { HANDS, TWOFAN_COLUMN_FAMILY, TWOFAN_MAX, columnKey } from '../model/twofan';
import { parseSceneText, sceneFromFile, sceneToJson } from '../model/sceneIO';
import {
  addLevelBreak,
  levelAt,
  moveLevelBreak,
  removeLevelBreak,
  removeStrandAt,
} from '../model/levels';
import { deleteCustom, getCustom, listCustom, saveCustom, storageAvailable } from '../model/customSamples';
import { controlsAtDefault, resetControlPoints } from '../model/controlPoints';

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
  // for a loaded file (the file name is shown as an extra option). `openKey` is
  // whatever main.ts actually put on screen, so a `?sample=` link opens with the
  // dropdown already pointing at the scene you asked for.
  private sceneSource: string;

  constructor(private root: HTMLElement, private view: StrandScene, openKey = 'two-crossing') {
    this.sceneSource = openKey;
    this.scene = view.getScene();
    // Attach/finalize adds a strand layer, a weave pick adds a mask layer — both
    // land in the layer stack, and the tool note tracks the pending weave pick.
    this.view.onSceneChanged = () => {
      this.scene = this.view.getScene();
      this.renderLayers();
      this.renderTools();
    };
    // The weave tool reports the layer under the pointer; show its name at the
    // cursor, so the lit ribbon is not the only thing telling you which of a
    // stitch's arms a click would take.
    this.view.onWeaveHover = (id) => this.showHoverChip(id);
    this.buildChrome();
    this.render();
  }

  // ---- Chrome floating over the scene --------------------------------------
  /**
   * The tool switch lives in a horizontal bar over the top of the canvas, the way
   * OpenStrand Studio keeps its modes on one strip above the drawing — the tool is
   * the control you reach for between every other action, and hunting for it down
   * a scrolling side panel put it furthest from the work. It also means the panel
   * can be folded away on a phone with the tools still to hand, which is what
   * makes editing possible on one at all.
   *
   * Two more pieces of chrome live out here with it: the panel fold toggle (narrow
   * screens only) and the weave's hover chip.
   */
  private buildChrome(): void {
    const bar = el('div');
    bar.id = 'toolbar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Tool');
    this.toolbarHost = bar;
    document.body.appendChild(bar);

    const chip = el('div');
    chip.id = 'hover-chip';
    chip.setAttribute('aria-hidden', 'true');
    this.hoverChip = chip;
    document.body.appendChild(chip);
    // The chip follows the pointer, so it has to see moves that the canvas
    // swallows; window-level and passive keeps it clear of the edit gestures.
    window.addEventListener(
      'pointermove',
      (e) => {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        if (chip.classList.contains('on')) this.placeHoverChip();
      },
      { passive: true },
    );

    const toggle = el('button', undefined, '') as HTMLButtonElement;
    toggle.id = 'panel-toggle';
    toggle.type = 'button';
    const sync = (): void => {
      const open = !document.body.classList.contains('panel-collapsed');
      toggle.textContent = open ? 'Hide panel' : 'Panel';
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('panel-collapsed');
      sync();
    });
    sync();
    document.body.appendChild(toggle);
  }

  // Last known pointer position, for placing the hover chip.
  private pointerX = 0;
  private pointerY = 0;
  private hoverChip: HTMLElement | null = null;

  /** Name the layer under the pointer next to the cursor, or clear the chip. */
  private showHoverChip(id: string | null): void {
    const chip = this.hoverChip;
    if (!chip) return;
    if (!id) {
      chip.classList.remove('on');
      return;
    }
    const pending = this.view.getWeavePending();
    chip.textContent = pending && pending !== id ? `${id} — goes under` : id;
    chip.classList.toggle('under', !!pending && pending !== id);
    chip.classList.add('on');
    this.placeHoverChip();
  }

  private placeHoverChip(): void {
    const chip = this.hoverChip;
    if (!chip) return;
    // Kept clear of the cursor itself, and off the right edge on a narrow view.
    const x = Math.min(this.pointerX + 16, window.innerWidth - chip.offsetWidth - 8);
    chip.style.transform = `translate(${Math.max(8, x)}px, ${this.pointerY + 18}px)`;
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
    // The app lives at /app/ under the project site; give it a way back.
    const home = el('a', 'brand-home', 'About the project ↗');
    home.href = '../';
    brand.appendChild(home);
    this.root.appendChild(brand);

    this.root.appendChild(this.toolSection());
    this.root.appendChild(this.viewSection());
    this.root.appendChild(this.ribbonSection());
    this.root.appendChild(this.weaveSection());
    this.root.appendChild(this.sceneSection());
    this.root.appendChild(this.layersSection());

    const hint = el('div', 'hint');
    // Touch has no scroll wheel and no right button, so name the gestures that
    // actually reach the camera on the device in front of you.
    hint.innerHTML = matchMedia('(pointer: coarse)').matches
      ? 'One finger to orbit · pinch to zoom · two fingers to pan'
      : 'Drag to orbit · scroll to zoom · right-drag to pan';
    this.root.appendChild(hint);
  }

  // ---- Tool (Orbit / Move / Attach / Weave) -------------------------------
  // The 3D analogue of OpenStrand Studio's toolbar, and in the same place: a
  // horizontal strip over the scene. Orbit is pure camera; Move drags endpoints &
  // control points (connected strands follow); Attach pulls a new strand out of a
  // free endpoint; Weave masks one strand over another.
  //
  // The panel keeps what the toolbar has no room for — the note on the live tool,
  // and the options that belong to it.
  private toolHost: HTMLElement | null = null;
  private toolbarHost: HTMLElement | null = null;

  private toolSection(): HTMLElement {
    const sec = section('Tool');
    this.toolHost = el('div');
    sec.appendChild(this.toolHost);
    this.renderTools();
    return sec;
  }

  private static readonly TOOLS: Array<{ key: EditMode; label: string; hint: string }> = [
    { key: 'pan', label: 'Pan', hint: 'Slide the camera sideways with a plain drag' },
    { key: 'orbit', label: 'Orbit', hint: 'Move the camera only — nothing in the scene can be edited' },
    { key: 'move', label: 'Move', hint: 'Drag endpoints and control points' },
    { key: 'attach', label: 'Attach', hint: 'Grow a new strand from a free endpoint' },
    { key: 'weave', label: 'Weave', hint: 'Mask one strand over another at their crossing' },
  ];

  /** The toolbar's buttons, wired to the current mode. */
  private renderToolbar(mode: EditMode): void {
    const bar = this.toolbarHost;
    if (!bar) return;
    bar.innerHTML = '';
    for (const t of Panel.TOOLS) {
      const active = mode === t.key;
      const b = el('button', 'btn tool-btn' + (active ? ' active' : '')) as HTMLButtonElement;
      b.type = 'button';
      b.innerHTML = `${TOOL_ICONS[t.key]}<span>${t.label}</span>`;
      b.title = t.hint;
      b.setAttribute('aria-pressed', String(active));
      b.addEventListener('click', () => {
        this.view.setMode(t.key);
        this.renderTools();
      });
      bar.appendChild(b);
    }
  }

  private renderTools(): void {
    const mode = this.view.getMode();
    this.renderToolbar(mode);
    if (!this.toolHost) return;
    this.toolHost.innerHTML = '';

    // The toolbar is over the scene, not in here, so the panel says which of its
    // buttons is live before it explains what that one does.
    const active = Panel.TOOLS.find((t) => t.key === mode);
    const live = el('div', 'tool-live');
    live.innerHTML = `${TOOL_ICONS[mode]}<span>${active?.label ?? mode}</span>`;
    this.toolHost.appendChild(live);

    // OSS's `enable_third_control_point`: with it off a strand has the classic two
    // handles, and a centre already placed by hand is ignored — by the handles and
    // by the curve alike — rather than lost.
    if (mode === 'move') {
      const toggles = el('div', 'toggle-row');
      toggles.appendChild(
        toggle('Middle handle', this.view.getParams().thirdControlPoint, (v) => {
          this.view.setParams({ thirdControlPoint: v });
          this.renderTools();
        }),
      );
      this.toolHost.appendChild(toggles);
    }

    const note = el('div', 'note');
    if (mode === 'attach') {
      note.innerHTML =
        'Pull from a <b style="color:#2fb862">green</b> endpoint to grow a new attached strand (it joins the same set and stacks on top). Gray endpoints are already joined.';
    } else if (mode === 'move') {
      // The control marks are OpenStrand Studio's own, shapes and staging alike —
      // see docs/control-points.md.
      note.innerHTML =
        'Drag a <b style="color:#2f7bd6">blue</b> endpoint — connected strands follow. ' +
        'Pull the <b style="color:#008000">green triangle</b> to bend the strand; that brings out the ' +
        '<b style="color:#008000">circle</b> (the far handle) and the <b style="color:#008000">square</b> ' +
        '(the middle). Park the circle back on the start to fold them away again.';
    } else if (mode === 'weave') {
      // The colours here are the ones the overlays light up in, and they carry
      // the roles: green is the over, blue the under.
      const pending = this.view.getWeavePending();
      note.innerHTML = pending
        ? `<b style="color:#2fb862">${pending}</b> rides over — now click the strand it should cross <b>over</b> (click it again to cancel). The layer under your pointer lights <b style="color:#2f7bd6">blue</b>: that one goes under.`
        : 'Click the strand that goes <b>over</b>, then the one it goes <b>under</b>. They interlock at their crossing — the 3D version of an OpenStrand mask. Hovering lights <b>one layer</b>, not the whole arm family, and names it — so on a stitch you can see exactly which of its strands you are about to mask.';
    } else if (mode === 'pan') {
      note.innerHTML = matchMedia('(pointer: coarse)').matches
        ? 'Drag with <b>one finger</b> to slide the scene sideways instead of turning it. Pinch still zooms, and two fingers still pan under every tool — this is the version you can do one-handed.'
        : 'Drag to slide the scene sideways instead of turning it. Right-drag does the same under every tool; this is the one that needs no second button, which is what a trackpad often is.';
    } else {
      note.textContent =
        'Orbit the camera freely. Switch to Move, Attach or Weave to edit strands in place, or Pan to slide the view.';
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
    // An imported file has no key, and neither does a twist face opened from the
    // browser — the dropdown lists a dozen scenes and the family is 64. Either way
    // the current scene gets its own entry so the box is never blank.
    const named = SAMPLE_LABELS.some((s) => s.key === this.sceneSource)
      || saved.some((c) => c.id === this.sceneSource);
    if (this.sceneSource === 'imported' || !named) {
      const opt = el('option');
      opt.value = this.sceneSource;
      opt.textContent = `↳ ${this.scene.name}`;
      select.appendChild(opt);
    }
    // One optgroup per group, in the order SAMPLE_LABELS first mentions each —
    // the same grouping the browser uses, so a scene sits in the same folder
    // whichever way you reach it.
    const byGroup = new Map<string, HTMLOptGroupElement>();
    for (const s of SAMPLE_LABELS) {
      let g = byGroup.get(s.group);
      if (!g) {
        g = el('optgroup') as HTMLOptGroupElement;
        g.label = s.group;
        byGroup.set(s.group, g);
        select.appendChild(g);
      }
      const opt = el('option');
      opt.value = s.key;
      opt.textContent = s.label;
      g.appendChild(opt);
    }
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

    // The dropdown names a dozen scenes; the m x n twist family is 64 more, which
    // is a grid rather than a list. Browse… opens both.
    const browseRow = el('div', 'btn-row');
    browseRow.appendChild(button('Browse samples…', () => this.openBrowser()));
    host.appendChild(browseRow);

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

  /**
   * The sample browser: every built-in in one place, grouped, plus the whole m x n
   * twist family as a grid. The dropdown stays for the dozen named scenes — this is
   * for the 64 that would drown it, and it quotes each face's turn so the family
   * reads as the table it is.
   */
  private openBrowser(): void {
    const saved = listCustom();
    const back = el('div', 'browser-back');
    const close = (): void => {
      back.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });

    const box = el('div', 'browser');
    const head = el('div', 'browser-head');
    head.appendChild(el('h3', undefined, 'Samples'));
    head.appendChild(button('Close', close));
    box.appendChild(head);

    const body = el('div', 'browser-body');
    const pick = (key: string): void => {
      close();
      this.loadSource(key);
    };

    // The named scenes, in the groups they belong to.
    const groups: string[] = [];
    for (const s of SAMPLE_LABELS) if (!groups.includes(s.group)) groups.push(s.group);
    for (const g of groups) {
      body.appendChild(el('h4', 'browser-group', g));
      const list = el('div', 'browser-list');
      for (const s of SAMPLE_LABELS.filter((x) => x.group === g)) {
        const b = button(s.label, () => pick(s.key));
        if (s.key === this.sceneSource) b.classList.add('browser-on');
        list.appendChild(b);
      }
      body.appendChild(list);
    }

    // The family. Rows are m, columns are n, and the two are interchangeable — an
    // m x n stitch is an n x m one looked at sideways — so the grid is symmetric.
    body.appendChild(
      el('h4', 'browser-group', 'Twist family — the original, every m×n face, 10 twists'),
    );
    body.appendChild(
      el(
        'p',
        'browser-note',
        'Rows m, columns n, and each cell quotes its turn. The shading is how far the ' +
          'loosest arm hangs past the weave: a square face pulls tight, a lopsided one ' +
          'cannot. Off the diagonal one turn has to serve two bands of different depth, ' +
          'so the shallower side is left with arm it does not need — and the smaller ' +
          'family carries the binding alone. Pale cells are ribbons round a spine, not ' +
          'woven columns. Nothing is broken in them; they are just loose by construction.',
      ),
    );
    const grid = el('div', 'browser-grid');
    grid.style.gridTemplateColumns = `auto repeat(${TWIST_MAX}, 1fr)`;
    grid.appendChild(el('span', 'browser-axis', ''));
    for (let n = 1; n <= TWIST_MAX; n++) grid.appendChild(el('span', 'browser-axis', `n=${n}`));
    for (let m = 1; m <= TWIST_MAX; m++) {
      grid.appendChild(el('span', 'browser-axis', `m=${m}`));
      for (let n = 1; n <= TWIST_MAX; n++) {
        const s = TWIST_FAMILY.find((x) => x.m === m && x.n === n)!;
        const b = button('', () => pick(s.key));
        b.classList.add('browser-cell');
        // Fade with the slack, so the usable region of the family is visible at a
        // glance rather than hidden behind 64 identical buttons.
        b.style.setProperty('--slack', String(Math.min(1, s.slack / 6)));
        b.appendChild(el('b', undefined, `${m}×${n}`));
        b.appendChild(el('small', undefined, `${s.turn.toFixed(1)}°`));
        b.appendChild(el('small', 'browser-slack', s.slack < 1 ? 'tight' : `+${s.slack.toFixed(1)}w`));
        const crossings = 4 * m * n;
        const most = 4 * Math.max(m, n);
        b.title =
          `${m}×${n} — ${m + n} laces, ${2 * (m + n)} arms a level, turn ${s.turn.toFixed(2)}°\n` +
          `loosest arm hangs ${s.slack.toFixed(2)} widths past the weave\n` +
          (s.load === 1
            ? `every lace is in ${most} of the ${crossings} crossings a level — balanced`
            : `a ${Math.min(m, n) === m ? 'warp' : 'weft'} lace is in ${most} of the ${crossings} ` +
              `crossings a level against ${4 * Math.min(m, n)} for the others — ${s.load.toFixed(1)}× the load`);
        if (s.key === this.sceneSource) b.classList.add('browser-on');
        grid.appendChild(b);
      }
    }
    body.appendChild(grid);

    // Folder two: the same 64 faces built to the 1xn reference, in both hands.
    // Hand is a real distinction here and not a label -- the reference tabulates
    // every size in both, and one is the exact mirror of the other.
    body.appendChild(
      el('h4', 'browser-group', 'Twist family — the 1×n reference, every m×n face, 10 levels, both hands'),
    );
    // Every level of every face, at full resolution, on the project site. The grid
    // below quotes the numbers; that page shows what they look like.
    const levels = el('p', 'browser-note');
    levels.innerHTML =
      'Each cell quotes its turn and its overhang. To see them — every level of every ' +
      'face, top view and orbit, at full resolution — open ' +
      '<a class="browser-link" href="../levels/" target="_blank" rel="noopener">' +
      'the level gallery</a>.';
    body.appendChild(levels);
    body.appendChild(
      el(
        'p',
        'browser-note',
        'The same 64 faces built to the 1×n reference. Two things change. Laces now ' +
          'sit a tenth of a width apart instead of touching, so the weave is no longer ' +
          'jammed against itself; and the turn comes out of that clearance rather than ' +
          'being assumed — 50.03° at a 1×1, where the original says 45°, and 45° turns ' +
          'out to overlap the laces. Each cell quotes its turn, and its tooltip what the ' +
          "reference's larger fan wants. A column cannot have that larger angle: its few " +
          'laces would no longer reach across the wide band, and the weave comes apart. ' +
          'That is why the shading off the diagonal is unchanged — the slack is real, and ' +
          'it is not the turn that causes it.',
      ),
    );
    for (const { hand, label, sense } of HANDS) {
      body.appendChild(el('h5', 'browser-subgroup', `${label} — turns ${sense}`));
      const g2 = el('div', 'browser-grid');
      g2.style.gridTemplateColumns = `auto repeat(${TWOFAN_MAX}, 1fr)`;
      g2.appendChild(el('span', 'browser-axis', ''));
      for (let n = 1; n <= TWOFAN_MAX; n++) g2.appendChild(el('span', 'browser-axis', `n=${n}`));
      for (let m = 1; m <= TWOFAN_MAX; m++) {
        g2.appendChild(el('span', 'browser-axis', `m=${m}`));
        for (let n = 1; n <= TWOFAN_MAX; n++) {
          const s = TWOFAN_COLUMN_FAMILY.find((x) => x.m === m && x.n === n)!;
          const key = columnKey(hand, m, n);
          const b = button('', () => pick(key));
          b.classList.add('browser-cell');
          b.style.setProperty('--slack', String(Math.min(1, s.slack / 6)));
          b.appendChild(el('b', undefined, `${m}×${n}`));
          b.appendChild(el('small', undefined, `${s.turn.toFixed(1)}°`));
          b.appendChild(
            el('small', 'browser-slack', s.slack < 1 ? 'tight' : `+${s.slack.toFixed(1)}w`),
          );
          b.title =
            `${m}×${n} ${hand.toUpperCase()} — ${m + n} laces, ${2 * (m + n)} arms a level, ` +
            `turn ${s.turn.toFixed(2)}° ${sense}\n` +
            "gap 1.217 widths — the reference's floor, w + 10\n" +
            (Math.abs(s.wanted - s.turn) < 0.005
              ? `m = n, so the reference's two fans coincide and this IS its angle`
              : `its larger fan wants ${s.wanted.toFixed(2)}°, which a column cannot take`) +
            `\nloosest arm hangs ${s.slack.toFixed(2)} widths past the weave`;
          if (key === this.sceneSource) b.classList.add('browser-on');
          g2.appendChild(b);
        }
      }
      body.appendChild(g2);
    }

    if (saved.length) {
      body.appendChild(el('h4', 'browser-group', 'Saved by you'));
      const list = el('div', 'browser-list');
      for (const c of saved) {
        const b = button(c.scene.name, () => pick(c.id));
        if (c.id === this.sceneSource) b.classList.add('browser-on');
        list.appendChild(b);
      }
      body.appendChild(list);
    }

    box.appendChild(body);
    back.appendChild(box);
    document.body.appendChild(back);
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
    const sx = cx - Math.cos(rad) * len;
    const sy = cy - Math.sin(rad) * len;
    const s: Strand3D = {
      id: `${maxSet + 1}_1`,
      start: { x: sx, y: sy },
      end: { x: cx + Math.cos(rad) * len, y: cy + Math.sin(rad) * len },
      // Straight out of the box: OSS parks both control points on the start, which
      // is what buildProfile reads as line mode and what leaves the strand
      // offering just its triangle until someone bends it.
      control_points: [{ x: sx, y: sy }, { x: sx, y: sy }],
      control_point_center: null,
      control_point_center_locked: false,
      triangleHasMoved: false,
      cp2Activated: false,
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
  private resetAllBtn: HTMLButtonElement | null = null;
  // "Reset curves" hits every layer at once and there is no undo in this app, so
  // it takes two clicks: the first arms it, the second does it.
  private resetAllArmed = false;
  private resetAllTimer = 0;

  private layersSection(): HTMLElement {
    const sec = section('Layers  (top = front)');

    // "New level" drops a storey marker at the top of the stack, so everything
    // added from here on rests a full storey higher. See levels.ts.
    const row = el('div', 'btn-row');
    const add = el('button', 'btn btn-icon');
    add.innerHTML = `${LAYERS_ICON}<span>New level</span>`;
    add.title = 'Add a level: from now on, new layers rest one storey higher';
    add.addEventListener('click', () => {
      addLevelBreak(this.scene);
      this.apply(false);
    });
    row.appendChild(add);

    // The whole-scene twin of the ↺ on each layer row: put every strand back on
    // the control points it was born with, straightening the lot in one go.
    const resetAll = el('button', 'btn btn-icon') as HTMLButtonElement;
    this.resetAllBtn = resetAll;
    resetAll.addEventListener('click', () => this.resetAllControls());
    row.appendChild(resetAll);

    sec.appendChild(row);

    this.layersHost = el('div', 'layers');
    sec.appendChild(this.layersHost);

    sec.appendChild(
      el(
        'div',
        'note',
        'A level is a step of one whole storey — the strand thickness plus the band the weave needs, so a lace up there rests ON the woven round below instead of sinking into it. Drag it down the stack with ▲▼ to drop the layers it passes back a storey. ↺ on a row straightens that one strand, back to the control points it was born with; Reset curves does the whole stack.',
      ),
    );
    this.renderLayers();
    return sec;
  }

  /** How many strands are carrying control points off their default set — the
   *  number "Reset curves" would straighten. */
  private bentStrandCount(): number {
    return this.scene.strands.reduce((n, s) => (controlsAtDefault(s) ? n : n + 1), 0);
  }

  /** Keep the header button in step with the stack it acts on: nothing bent, no
   *  button to press. It lives outside `layersHost`, so it is refreshed by hand
   *  rather than rebuilt with the rows. */
  private syncResetAll(): void {
    const b = this.resetAllBtn;
    if (!b) return;
    const n = this.bentStrandCount();
    b.disabled = n === 0;
    b.classList.toggle('btn-armed', this.resetAllArmed);
    if (this.resetAllArmed) {
      b.innerHTML = `${RESET_ICON}<span>Reset ${n}? Click again</span>`;
      b.title = 'Click again to straighten every strand — this cannot be undone';
      return;
    }
    b.innerHTML = `${RESET_ICON}<span>Reset curves</span>`;
    b.title = n
      ? `Put every strand's control points back to their default (${n} bent)`
      : 'Every strand is already on its default control points';
  }

  /**
   * First click arms, second click resets the whole stack — and the arming lapses
   * on its own if it goes unanswered. A `confirm()` would be the obvious guard,
   * but modal dialogs are refused in a sandboxed frame, which is exactly where
   * this page runs when it is published.
   */
  private resetAllControls(): void {
    window.clearTimeout(this.resetAllTimer);
    if (!this.resetAllArmed) {
      this.resetAllArmed = true;
      this.resetAllTimer = window.setTimeout(() => {
        this.resetAllArmed = false;
        this.syncResetAll();
      }, 4000);
      this.syncResetAll();
      return;
    }
    this.resetAllArmed = false;
    for (const s of this.scene.strands) resetControlPoints(s);
    this.apply(false);
  }

  private renderLayers(): void {
    this.syncResetAll();
    if (!this.layersHost) return;
    this.layersHost.innerHTML = '';
    // Mask layers first: OSS appends a MaskedStrand to the end of the strand list,
    // which is the top of the layer panel. A mask is named `over_under` there
    // (`first_second`), so `1_2_1_3` reads "1_2 crosses over 1_3".
    this.scene.masks.forEach((m, i) => this.layersHost!.appendChild(this.maskRow(m, i)));
    // Then the strands, topmost first (last in the array is highest Z), with the
    // level breaks interleaved: a break at position k sits above strand k-1.
    const breaks = this.scene.levelBreaks;
    for (let i = this.scene.strands.length; i >= 0; i--) {
      for (let b = breaks.length - 1; b >= 0; b--) {
        if (breaks[b] === i) this.layersHost.appendChild(this.levelRow(b));
      }
      if (i > 0) this.layersHost.appendChild(this.layerRow(i - 1));
    }
  }

  /** A level row: the storey marker itself. Everything above it rests one storey
   *  higher, and it reorders and deletes like any other layer. */
  private levelRow(index: number): HTMLElement {
    const at = this.scene.levelBreaks[index];
    const row = el('div', 'layer layer-level');

    const badge = el('div', 'level-badge');
    badge.innerHTML = LAYERS_ICON;
    row.appendChild(badge);

    const nameWrap = el('div', 'layer-name');
    nameWrap.appendChild(el('span', 'layer-id', `level ${index + 1}`));
    nameWrap.appendChild(el('span', 'layer-tag', '+1 storey'));
    row.appendChild(nameWrap);
    row.title = `Everything above this rests one storey (${fmt(
      this.view.getLevelStep(),
    )}) higher — the strand thickness plus the band the weave lifts and dips through.`;

    const controls = el('div', 'layer-controls');

    const up = el('button', 'icon-btn', '▲');
    up.title = 'Move up (fewer layers lifted)';
    up.disabled = at >= this.scene.strands.length;
    up.addEventListener('click', () => {
      moveLevelBreak(this.scene, index, +1);
      this.apply(false);
    });
    controls.appendChild(up);

    const down = el('button', 'icon-btn', '▼');
    down.title = 'Move down (lift one more layer)';
    down.disabled = at <= 0;
    down.addEventListener('click', () => {
      moveLevelBreak(this.scene, index, -1);
      this.apply(false);
    });
    controls.appendChild(down);

    const del = el('button', 'icon-btn danger', '✕');
    del.title = 'Remove this level';
    del.addEventListener('click', () => {
      removeLevelBreak(this.scene, index);
      this.apply(false);
    });
    controls.appendChild(del);

    row.appendChild(controls);
    return row;
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
    // …and which storey it rests on, once any level break is in play.
    const level = levelAt(this.scene, index);
    if (level > 0) nameWrap.appendChild(el('span', 'layer-tag level-tag', `L${level}`));
    row.appendChild(nameWrap);

    const controls = el('div', 'layer-controls');

    // Every layer carries this one: it puts the strand's control points back
    // where a fresh strand keeps them — both on the start, no centre, nothing
    // flagged as touched — which straightens the run. A strand already there has
    // it greyed out rather than missing, so the controls stay in the same places
    // on every row and the button is there to find before you need it.
    const atDefault = controlsAtDefault(strand);
    const straight = el('button', 'icon-btn', '↺') as HTMLButtonElement;
    straight.disabled = atDefault;
    straight.title = atDefault
      ? 'Control points are already at their default'
      : 'Reset control points (straighten this strand)';
    straight.addEventListener('click', () => {
      resetControlPoints(strand);
      this.apply(false);
    });
    controls.appendChild(straight);

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
      removeStrandAt(this.scene, index);
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

// The stacked-layers mark used by the "New level" button and by the rows it adds:
// a slab seen edge-on with a second one showing beneath it — one storey above
// another, which is exactly what a level is.
const LAYERS_ICON =
  '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 3 22 9.2 12 15.4 2 9.2Z"/>' +
  '<path d="M12 17.7 3.7 12.5 2 13.6 12 19.8 22 13.6 20.3 12.5Z"/>' +
  '</svg>';

// The toolbar's marks. Each one states what the tool acts on rather than naming
// it twice: a ring you turn around, a four-way drag, a strand growing out of a
// joint, and one band crossing over another with the second broken where it
// passes beneath — which is the whole of what a mask says.
const svg = (body: string): string =>
  `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const TOOL_ICONS: Record<EditMode, string> = {
  // A hand for Pan and arrows for Move, not two sets of arrows: one takes hold of
  // the VIEW and slides it, the other takes hold of a strand. The four-way arrow
  // would read the same for both.
  pan: svg(
    '<path d="M18.5 8.2c-.3 0-.6.07-.85.2V6.1a1.65 1.65 0 0 0-2.5-1.42A1.65 1.65 0 0 0 12 3.6a1.63 1.63 0 0 0-.9.27V2.9a1.65 1.65 0 1 0-3.3 0v7.72l-.62-.75a1.75 1.75 0 0 0-2.7 2.22l3.5 4.75A5.9 5.9 0 0 0 12.7 20h1.6a5.85 5.85 0 0 0 5.85-5.85V9.85c0-.91-.74-1.65-1.65-1.65Z"/>',
  ),
  orbit: svg(
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/>' +
      '<circle cx="12" cy="12" r="3.2"/>',
  ),
  move: svg(
    '<path d="M12 1.6 8.4 5.2h2.4v4.6H6.2V7.4L2.6 11l3.6 3.6v-2.4h4.6v4.6H8.4L12 20.4l3.6-3.6h-2.4v-4.6h4.6v2.4L21.4 11l-3.6-3.6v2.4h-4.6V5.2h2.4Z"/>',
  ),
  attach: svg(
    '<circle cx="5.6" cy="18.4" r="3"/>' +
      '<path d="M6.5 15.6a10.4 10.4 0 0 1 9.1-9.1V3.2l5 4.4-5 4.4V9a7.4 7.4 0 0 0-6.1 6.1Z"/>',
  ),
  // Diagonally, because upright straps have only the height of the box to run in
  // and end up too stubby to read as straps — the mark came out as a division
  // sign. On the diagonal both have the box's full reach, and the broken one
  // states the whole of what a mask says: this lace passes under that one.
  weave: svg(
    '<g transform="rotate(-45 12 12)">' +
      '<rect x="-1.5" y="9.5" width="10" height="5" rx="2.5"/>' +
      '<rect x="15.5" y="9.5" width="10" height="5" rx="2.5"/>' +
      '</g>' +
      '<rect x="-1.5" y="9.5" width="27" height="5" rx="2.5" transform="rotate(45 12 12)"/>',
  ),
};

// The anticlockwise turn-back arrow on "Reset curves", drawn to read as the ↺ the
// layer rows carry, so the two controls state their kinship: one row, or all.
const RESET_ICON =
  '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z"/>' +
  '</svg>';

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
