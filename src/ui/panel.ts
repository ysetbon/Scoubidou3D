// The control panel, built to the mock-3 layout in docs/panel-mocks.
//
// The shape of it, and why:
//
//   * The PANEL is the layer stack and nothing else. Everything that used to
//     scroll above the stack — Ribbon, Weave, View, Scene — has left, so the
//     thing you actually work in is never below anything.
//   * A storey is a BAR OF ITS OWN, sitting UNDER the layers it carries, because
//     that is what a storey is: the floor they rest on. So level 0's bar is the
//     last thing in the panel — the ground, under everything — and ▲▼ on a bar
//     walk it through the stack past the rows next to it, which is the whole of
//     what a level does. A card whose header names it could not say any of that;
//     a bar you can move can. Level 0 carries no controls: the ground is not a
//     break, just what is left below the lowest one. Masks are crossings rather
//     than storeys, so they sit in a card above the stack — where OpenStrand's
//     own layer panel keeps them.
//   * The stack HANGS FROM THE BOTTOM. It is built bottom-up (level 0 is the
//     ground, strands[0] is the lowest layer), so a panel with room to spare puts
//     the ground on its floor rather than its ceiling.
//   * Selecting a row opens an INSPECTOR inside it: that strand's colour, width
//     and straighten, next to the row they belong to instead of in a section
//     somewhere else.
//   * The SETTINGS live in a dock along the bottom of the canvas — four pills,
//     one popover at a time, each next to the scene it changes and each printing
//     its own current value so the setup reads without opening anything.
//   * NO PROSE anywhere in the working chrome. Every note the panel used to
//     print — what each tool does, what a level is, what a mask is, the gestures,
//     the storage caveat — lives in one About sheet behind the ?. What is left
//     over the canvas is a single status pill: the camera gesture normally, and
//     the weave's pending pick when there is one.
//
// The panel owns the working Scene3D and pushes changes into the StrandScene.
// Reordering a layer here restacks it in Z — the direct 3D analogue of moving a
// layer in OpenStrand's layer panel.

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

/**
 * Whether the sample browser shows the ORIGINAL m x n twist family — the grid
 * built on the single-turn law, `atan(1/max(m,n))`.
 *
 * Off: the browser shows only the 1xn reference folder. Nothing is deleted —
 * `TWIST_FAMILY` still generates all 64, `makeSample('twist-3x2-10')` still
 * builds them, and `?sample=` links to them still open. Only the grid is
 * hidden. Flip this back to `true` to put the folder back.
 *
 * Typed `boolean` on purpose: a literal `false` would narrow the block to
 * unreachable code and take the family's own rendering out of type-checking.
 */
const SHOW_ORIGINAL_TWIST_FAMILY: boolean = false;

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

/** Which dock card is open, if any. */
type DockKey = 'ribbon' | 'weave' | 'view' | 'scene';

const DOCK_KEYS: DockKey[] = ['ribbon', 'weave', 'view', 'scene'];

const DOCK_LABELS: Record<DockKey, string> = {
  ribbon: 'Ribbon',
  weave: 'Weave',
  view: 'View',
  scene: 'Scene',
};

/** The width at which the panel stops being a column beside the canvas and
 *  becomes a bottom sheet under it — the same breakpoint styles.css uses, and
 *  the point where a floating card would cover the scene it belongs to. */
const NARROW = '(max-width: 860px)';

function isNarrow(): boolean {
  return matchMedia(NARROW).matches;
}

export class Panel {
  private scene: Scene3D;
  // Which entry the Sample dropdown should show: a sample key, or 'imported'
  // for a loaded file (the file name is shown as an extra option). `openKey` is
  // whatever main.ts actually put on screen, so a `?sample=` link opens with the
  // dropdown already pointing at the scene you asked for.
  private sceneSource: string;
  // The strand whose inspector is open, by id. Panel-side only: the scene has no
  // notion of a selection, and this one exists to put a row's own controls in
  // the row rather than in a section of their own.
  private selectedId: string | null = null;

  constructor(private root: HTMLElement, private view: StrandScene, openKey = 'two-crossing') {
    this.sceneSource = openKey;
    this.scene = view.getScene();
    // Attach/finalize adds a strand layer, a weave pick adds a mask layer — both
    // land in the layer stack, and the status pill tracks the pending weave pick.
    this.view.onSceneChanged = () => {
      this.scene = this.view.getScene();
      this.renderPanelBody();
      this.syncToolbar();
      this.syncStatus();
    };
    // The weave tool reports the layer under the pointer; show its name at the
    // cursor, so the lit ribbon is not the only thing telling you which of a
    // stitch's arms a click would take.
    this.view.onWeaveHover = (id) => this.showHoverChip(id);
    initTheme(view);
    this.buildChrome();
    this.render();
  }

  // ---- Chrome floating over the scene --------------------------------------
  /**
   * Everything that is not the layer stack lives out here, over the canvas:
   *
   *   * the tool switch, a horizontal strip along the top — the way OpenStrand
   *     Studio keeps its modes on one bar above the drawing. The tool is the
   *     control you reach for between every other action, and hunting for it
   *     down a scrolling side panel put it furthest from the work;
   *   * the settings dock along the bottom, next to what it changes;
   *   * the About sheet's ? and the theme switch, top right;
   *   * the status pill, bottom left;
   *   * the weave's hover chip, at the pointer;
   *   * and the panel fold toggle on a narrow screen.
   */
  private buildChrome(): void {
    const bar = el('div');
    bar.id = 'toolbar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Tool');
    this.toolbarHost = bar;
    document.body.appendChild(bar);

    // Top right: the theme switch and the one door to every word of prose.
    const corner = el('div');
    corner.id = 'corner';
    const theme = el('button', 'round') as HTMLButtonElement;
    theme.type = 'button';
    theme.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    themeButtons.push(theme);
    syncThemeButtons();
    const help = el('button', 'round', '?') as HTMLButtonElement;
    help.type = 'button';
    help.title = 'About: the tools, levels, masks, camera and files';
    help.setAttribute('aria-expanded', 'false');
    help.addEventListener('click', () => this.toggleAbout(help));
    this.helpBtn = help;
    corner.append(theme, help);
    document.body.appendChild(corner);

    const dock = el('div');
    dock.id = 'dock';
    dock.setAttribute('role', 'group');
    dock.setAttribute('aria-label', 'Settings');
    this.dockHost = dock;
    document.body.appendChild(dock);

    // The popovers live OUTSIDE the dock, in a layer of their own. Inside it they
    // were clipped and mispositioned on a phone, and both causes are the dock
    // itself: `overflow-x: auto` (which the four pills need when they no longer
    // fit) clips a child, and `backdrop-filter` makes the dock a containing block
    // so a `position: fixed` child measures from the dock instead of the viewport.
    const pops = el('div');
    pops.id = 'popover-layer';
    this.popHost = pops;
    document.body.appendChild(pops);

    const status = el('div');
    status.id = 'status';
    this.statusHost = status;
    document.body.appendChild(status);

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
    this.foldToggle = toggle;
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('panel-collapsed');
      this.syncFoldToggle();
    });
    this.syncFoldToggle();
    document.body.appendChild(toggle);

    // Crossing the breakpoint moves the open card between the panel and the
    // canvas, so it has to be redrawn — a rotated phone would otherwise leave the
    // Ribbon controls in a panel that is now a column, or a popover pointing at a
    // pill that has moved.
    matchMedia(NARROW).addEventListener('change', () => this.renderDock());

    // Escape closes the topmost thing: the About sheet if it is up, else the
    // open dock popover.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.aboutOpen) {
        this.closeAbout();
        return;
      }
      if (this.dockOpen) this.openDock(null);
    });
  }

  // Last known pointer position, for placing the hover chip.
  private pointerX = 0;
  private pointerY = 0;
  private hoverChip: HTMLElement | null = null;
  private statusHost: HTMLElement | null = null;
  private helpBtn: HTMLButtonElement | null = null;
  private foldToggle: HTMLButtonElement | null = null;

  /** The fold toggle names whatever the sheet is actually holding — which is the
   *  layer stack most of the time, but a dock card whenever one is open. */
  private syncFoldToggle(): void {
    const b = this.foldToggle;
    if (!b) return;
    const open = !document.body.classList.contains('panel-collapsed');
    const what = this.inlineDock() ? DOCK_LABELS[this.inlineDock()!] : 'layers';
    b.textContent = open ? `Hide ${what.toLowerCase()}` : what;
    b.setAttribute('aria-expanded', String(open));
  }

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

  /**
   * The one line of text over the canvas. It states the camera gesture for the
   * device you are on — a phone has no scroll wheel and no right button — and
   * gives that space up to the weave whenever a pick is half-made, which is the
   * only moment in the app where a mode is holding something for you.
   */
  private syncStatus(): void {
    const host = this.statusHost;
    if (!host) return;
    const pending = this.view.getWeavePending();
    if (pending) {
      host.innerHTML = `<b>${pending}</b> rides over — now click the strand it crosses`;
      host.classList.add('live');
      return;
    }
    host.classList.remove('live');
    host.textContent = matchMedia('(pointer: coarse)').matches
      ? 'One finger orbits · pinch zooms · two fingers pan'
      : 'Drag to orbit · scroll to zoom · right-drag to pan';
  }

  setScene(scene: Scene3D): void {
    this.scene = scene;
    this.selectedId = null;
    this.view.setScene(scene, true);
    this.render();
  }

  private apply(refit = false): void {
    this.view.setScene(this.scene, refit);
    this.renderPanelBody();
  }

  /** The panel proper: brand, stack header, stack. Plus the chrome's contents. */
  private render(): void {
    this.root.innerHTML = '';

    const brand = el('div', 'brandbar');
    // The app lives at /app/ under the project site; the mark leads back to it.
    const home = el('a', 'brand-home');
    home.href = '../';
    home.title = 'About the project';
    home.innerHTML = `${MARK}<span>Scoubidou<i>3D</i></span>`;
    brand.appendChild(home);
    // Only the strand count: a 42-strand, 10-level scene ran the full line off the
    // panel's edge, and the cards below already state their own counts — the level
    // headers their layers, the mask card its crossings.
    const name = el('span', 'tag teal');
    this.brandTag = name;
    brand.appendChild(name);
    this.syncBrand();
    this.root.appendChild(brand);

    this.barHost = el('div', 'stackbar');
    this.root.appendChild(this.barHost);

    this.stackHost = el('div', 'stack');
    this.root.appendChild(this.stackHost);

    this.buildAbout();
    this.renderDock();
    this.syncToolbar();
    this.syncStatus();
  }

  /**
   * The panel's bar and body, which are a swappable pair.
   *
   * Wide: the panel is always the layer stack, and a dock card opens as a popover
   * over the canvas next to the pill that opened it.
   *
   * Narrow: it CANNOT be a popover. The panel is a bottom sheet, the canvas is the
   * strip above it, and a 310px card floating over that strip covers the very
   * thing the slider is changing — you drag Thickness and cannot see the ribbon.
   * So on a phone the dock swaps the panel instead: tap Ribbon and the stack
   * becomes the Ribbon controls, with the canvas left alone. Same four pills, same
   * four cards, in the one place there is room for them.
   */
  private renderPanelBody(): void {
    const bar = this.barHost;
    const host = this.stackHost;
    if (!bar || !host) return;
    bar.innerHTML = '';
    host.innerHTML = '';

    this.syncFoldToggle();

    this.syncBrand();

    // The stack reads bottom-up — level 0 is the ground — so an under-filled
    // panel hangs from the bottom and the ground row sits on the panel's floor.
    // A dock card rendered in here is not a stack and starts at the top.
    host.classList.toggle('from-bottom', !this.inlineDock());

    const section = this.inlineDock();
    if (section) {
      const title = el('h2', 'stack-title', DOCK_LABELS[section]);
      bar.appendChild(title);
      // The way back, next to the title rather than only on the dock pill: this is
      // the panel's own content, so the panel says how to leave it.
      const back = iconPill(LAYERS_ICON, 'Layers', () => this.openDock(section));
      back.title = 'Back to the layer stack';
      bar.appendChild(back);
      const card = this.cardFor(section);
      card.classList.add('inline');
      host.appendChild(card);
      return;
    }

    const title = el('h2', 'stack-title', 'Layers');
    title.appendChild(el('u', undefined, 'top = front'));
    bar.appendChild(title);
    // "New level" drops a storey marker at the top of the stack, so everything
    // added from here on rests a full storey higher. See levels.ts.
    const addLevel = iconPill(LAYERS_ICON, 'Level', () => {
      addLevelBreak(this.scene);
      this.apply(false);
    });
    addLevel.classList.add('coral');
    addLevel.title = 'Add a level: from now on, new layers rest one storey higher';
    bar.appendChild(addLevel);
    bar.appendChild(
      pill('Strand', () => this.addStrand(), 'Drop a new straight strand into the scene'),
    );
    this.renderStack();
  }

  /** Which dock card the PANEL is showing, if any — only ever set on a narrow
   *  screen, where a popover would cover the scene it belongs to. */
  private inlineDock(): DockKey | null {
    return this.dockOpen && isNarrow() ? this.dockOpen : null;
  }

  // ---- Tool (Pan / Orbit / Move / Attach / Weave) --------------------------
  // The 3D analogue of OpenStrand Studio's toolbar, and in the same place: a
  // horizontal strip over the scene. Orbit is pure camera; Pan slides it; Move
  // drags endpoints & control points (connected strands follow); Attach pulls a
  // new strand out of a free endpoint; Weave masks one strand over another.
  private toolbarHost: HTMLElement | null = null;

  private static readonly TOOLS: Array<{ key: EditMode; label: string; hint: string }> = [
    { key: 'pan', label: 'Pan', hint: 'Slide the camera sideways with a plain drag' },
    { key: 'orbit', label: 'Orbit', hint: 'Move the camera only — nothing in the scene can be edited' },
    { key: 'move', label: 'Move', hint: 'Drag endpoints and control points' },
    { key: 'attach', label: 'Attach', hint: 'Grow a new strand from a free endpoint' },
    { key: 'weave', label: 'Weave', hint: 'Mask one strand over another at their crossing' },
  ];

  /** The toolbar's buttons, wired to the current mode. */
  private syncToolbar(): void {
    const bar = this.toolbarHost;
    if (!bar) return;
    const mode = this.view.getMode();
    bar.innerHTML = '';
    for (const t of Panel.TOOLS) {
      const active = mode === t.key;
      const b = el('button', 'tool-btn' + (active ? ' on' : '')) as HTMLButtonElement;
      b.type = 'button';
      b.innerHTML = `${TOOL_ICONS[t.key]}<span>${t.label}</span>`;
      b.title = t.hint;
      b.setAttribute('aria-pressed', String(active));
      b.addEventListener('click', () => {
        this.view.setMode(t.key);
        this.syncToolbar();
        this.syncStatus();
        // Move is the one tool with an option of its own; it rides in the dock's
        // View card, which has to be redrawn to show it.
        this.renderDock();
      });
      bar.appendChild(b);
    }
  }

  // ---- The settings dock ---------------------------------------------------
  // Four pills over the canvas, one popover at a time. Each pill states its own
  // value, so the whole setup of a scene reads off the dock without opening
  // anything — which is what most of the old panel's scrolling was for.
  private dockHost: HTMLElement | null = null;
  private popHost: HTMLElement | null = null;
  private dockOpen: DockKey | null = null;
  // Whether the Scene card's JSON box, paste box and name field are showing.
  private dataOpen = false;
  private pasteOpen = false;
  private namingOpen = false;
  // "Straighten all" hits every layer at once and there is no undo in this app,
  // so it takes two presses: the first arms it, the second does it.
  private resetAllArmed = false;
  private resetAllTimer = 0;

  private openDock(key: DockKey | null): void {
    this.dockOpen = this.dockOpen === key ? null : key;
    // On a phone the card is the panel's content, so a folded-away panel would
    // swallow it: the pill would light up and nothing would appear.
    if (this.dockOpen && isNarrow()) document.body.classList.remove('panel-collapsed');
    if (this.dockOpen !== 'scene') {
      this.dataOpen = false;
      this.pasteOpen = false;
      this.namingOpen = false;
      this.disarmResetAll();
    }
    this.renderDock();
  }

  private renderDock(): void {
    const host = this.dockHost;
    if (!host) return;
    host.innerHTML = '';
    const p = this.view.getParams();

    const values: Record<DockKey, string> = {
      ribbon: String(p.thickness),
      weave: p.weave ? 'on' : 'off',
      view: '',
      scene: shortName(this.scene.name),
    };

    if (this.popHost) this.popHost.innerHTML = '';
    // On a narrow screen the open card lives in the panel, so nothing floats.
    const floating = this.dockOpen && !isNarrow();

    for (const key of DOCK_KEYS) {
      const open = this.dockOpen === key;
      const b = el('button', 'dock-btn' + (open ? ' on' : '')) as HTMLButtonElement;
      b.type = 'button';
      b.innerHTML = values[key] ? `${DOCK_LABELS[key]} <u>${values[key]}</u>` : DOCK_LABELS[key];
      b.setAttribute('aria-expanded', String(open));
      b.addEventListener('click', () => this.openDock(key));
      host.appendChild(b);
      if (open && floating && this.popHost) {
        const card = this.cardFor(key);
        this.popHost.appendChild(card);
        this.placePop(card, b);
      }
    }

    this.renderPanelBody();
  }

  private cardFor(key: DockKey): HTMLElement {
    switch (key) {
      case 'ribbon':
        return this.ribbonCard();
      case 'weave':
        return this.weaveCard();
      case 'view':
        return this.viewCard();
      case 'scene':
        return this.sceneCard();
    }
  }

  /**
   * Centre the open card over the pill that opened it, and keep it on screen.
   *
   * Anchoring in CSS alone would need the card inside the dock, which is what
   * broke on a phone — so the geometry is measured here instead. On a narrow
   * screen the card spans the width and the nub is dropped: it would be pointing
   * at a pill that the dock may have scrolled away from under it.
   */
  private placePop(card: HTMLElement, pill: HTMLElement): void {
    const place = (): void => {
      if (!card.isConnected) return;
      const r = pill.getBoundingClientRect();
      card.style.bottom = `${Math.round(window.innerHeight - r.top + 14)}px`;
      if (matchMedia('(max-width: 860px)').matches) {
        card.style.left = '';
        return;
      }
      const w = card.offsetWidth;
      const left = Math.min(
        Math.max(10, r.left + r.width / 2 - w / 2),
        window.innerWidth - w - 10,
      );
      card.style.left = `${Math.round(left)}px`;
      // The nub points at the pill's middle, wherever the card had to sit.
      card.style.setProperty('--nub', `${Math.round(r.left + r.width / 2 - left)}px`);
    };
    place();
    // The card is measured, so anything that changes the layout has to re-measure:
    // a window resize, and the panel folding away on a phone.
    const onResize = (): void => {
      if (!card.isConnected) {
        window.removeEventListener('resize', onResize);
        return;
      }
      place();
    };
    window.addEventListener('resize', onResize);
  }

  /** A dock popover: a paper card with a serif title, above its pill. */
  private popover(title: string, note?: string): HTMLElement {
    const pop = el('div', 'pop');
    const head = el('h3', undefined, title);
    if (note) head.appendChild(el('small', undefined, note));
    pop.appendChild(head);
    return pop;
  }

  private ribbonCard(): HTMLElement {
    const pop = this.popover('Ribbon', 'global');
    const p = this.view.getParams();
    pop.appendChild(
      slider('Thickness', p.thickness, 2, 120, 1, (v) => {
        this.view.setParams({ thickness: v });
        this.syncDockValues();
      }),
    );
    pop.appendChild(
      slider('Width scale', p.widthScale, 0.2, 3, 0.05, (v) => this.view.setParams({ widthScale: v })),
    );
    const toggles = el('div', 'check-row');
    toggles.append(
      check('Outline', p.outline, (v) => this.view.setParams({ outline: v })),
      check('Round ends', p.roundCaps, (v) => this.view.setParams({ roundCaps: v })),
    );
    pop.appendChild(toggles);
    return pop;
  }

  private weaveCard(): HTMLElement {
    const pop = this.popover('Weave', 'over / under');
    const p = this.view.getParams();
    const toggles = el('div', 'check-row');
    toggles.appendChild(
      check('Interlock at crossings', p.weave, (v) => {
        this.view.setParams({ weave: v });
        this.syncDockValues();
      }),
    );
    pop.appendChild(toggles);
    pop.appendChild(slider('Depth', p.weaveDepth, 0, 120, 1, (v) => this.view.setParams({ weaveDepth: v })));
    pop.appendChild(slider('Span', p.weaveSpan, 0.4, 3, 0.05, (v) => this.view.setParams({ weaveSpan: v })));
    pop.appendChild(slider('Layer lift', p.layerGap, 0, 80, 1, (v) => this.view.setParams({ layerGap: v })));
    return pop;
  }

  private viewCard(): HTMLElement {
    const pop = this.popover('View', 'camera');
    const p = this.view.getParams();
    const shots = el('div', 'pill-row');
    shots.append(
      pill('Fit', () => this.view.fitView()),
      pill('Top', () => this.view.topView()),
    );
    pop.appendChild(shots);
    const toggles = el('div', 'check-row');
    toggles.appendChild(check('Grid', p.showGrid, (v) => this.view.setParams({ showGrid: v })));
    // OSS's `enable_third_control_point`: with it off a strand has the classic
    // two handles, and a centre already placed by hand is ignored — by the
    // handles and by the curve alike — rather than lost. It belongs to Move, so
    // it only appears while Move is the live tool.
    if (this.view.getMode() === 'move') {
      toggles.appendChild(
        check('Middle handle', p.thirdControlPoint, (v) => {
          this.view.setParams({ thirdControlPoint: v });
          this.renderDock();
        }),
      );
    }
    pop.appendChild(toggles);
    return pop;
  }

  private sceneCard(): HTMLElement {
    const pop = this.popover('Scene');
    pop.classList.add('pop-scene');
    const saved = listCustom();

    const head = el('div', 'pop-row');
    head.appendChild(el('span', 'pop-name', this.scene.name));
    head.appendChild(
      el('span', 'tag', `${this.scene.strands.length} strands`),
    );
    pop.appendChild(head);

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
    pop.appendChild(sampleRow);

    // The dropdown names a dozen scenes; the m x n twist family is 64 more, which
    // is a grid rather than a list. Browse… opens both.
    const browse = el('div', 'pill-row');
    const browseBtn = pill('Browse samples…', () => this.openBrowser());
    browseBtn.classList.add('coral');
    browse.appendChild(browseBtn);
    pop.appendChild(browse);

    const row = el('div', 'pill-row');
    row.append(
      pill('Import .json', () => fileInput.click()),
      pill('Save', () => {
        this.namingOpen = !this.namingOpen;
        this.renderDock();
      }),
      pill(this.dataOpen ? 'Hide JSON' : 'JSON', () => {
        this.dataOpen = !this.dataOpen;
        this.renderDock();
      }),
    );
    pop.appendChild(row);

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
      const go = el('div', 'pill-row');
      go.append(
        pill('Save', () => this.saveSample(input.value)),
        pill('Cancel', () => {
          this.namingOpen = false;
          this.renderDock();
        }),
      );
      wrap.appendChild(go);
      pop.appendChild(wrap);
      window.setTimeout(() => input.select(), 0);
    }

    // The scene as text, right there in the card. Clipboard writes and modal
    // prompts can both be refused in a sandboxed frame, so the reliable route is a
    // textarea you can select from by hand.
    if (this.dataOpen) {
      const json = sceneToJson(this.scene);
      const area = el('textarea', 'json-box') as HTMLTextAreaElement;
      area.value = json;
      area.readOnly = true;
      area.spellcheck = false;
      pop.appendChild(area);

      const tools = el('div', 'pill-row');
      tools.appendChild(
        pill('Select all', () => {
          area.focus();
          area.select();
        }),
      );
      tools.appendChild(pill('Copy', () => this.copyJson(json, area)));
      if (window.claude?.downloads) {
        tools.appendChild(pill('Download', () => this.downloadJson(json)));
      }
      pop.appendChild(tools);
    }

    // Every strand back on the control points it was born with — the whole-scene
    // twin of Straighten in a row's inspector. A whole-scene edit, which is what
    // this card is for.
    const bent = this.scene.strands.reduce((n, st) => (controlsAtDefault(st) ? n : n + 1), 0);
    const straightenRow = el('div', 'pill-row');
    const straightenAll = pill(
      this.resetAllArmed ? `Straighten ${bent}? Press again` : 'Straighten all',
      () => this.resetAllControls(),
      this.resetAllArmed
        ? 'Press again to straighten every strand — this cannot be undone'
        : bent
          ? `Put every strand's control points back to their default (${bent} bent)`
          : 'Every strand is already on its default control points',
    );
    straightenAll.disabled = bent === 0;
    if (this.resetAllArmed) straightenAll.classList.add('armed');
    straightenRow.appendChild(straightenAll);
    pop.appendChild(straightenRow);

    // Loading by paste, for the same reason: a file picker is not always usable.
    const pasteRow = el('div', 'pill-row');
    pasteRow.appendChild(
      pill(this.pasteOpen ? 'Cancel paste' : 'Paste a scene', () => {
        this.pasteOpen = !this.pasteOpen;
        this.renderDock();
      }),
    );
    pop.appendChild(pasteRow);

    if (this.pasteOpen) {
      const area = el('textarea', 'json-box') as HTMLTextAreaElement;
      area.placeholder = 'Paste scene JSON (or an OpenStrand .json) here, then press Load.';
      area.spellcheck = false;
      pop.appendChild(area);
      const go = el('div', 'pill-row');
      go.appendChild(
        pill('Load', () => {
          const text = area.value.trim();
          if (!text) return;
          try {
            const scene = parseSceneText(text, 'pasted scene');
            this.pasteOpen = false;
            this.sceneSource = 'imported';
            this.setScene(scene);
          } catch (e) {
            this.flash('Could not read that: ' + (e as Error).message, true);
          }
        }),
      );
      pop.appendChild(go);
    }

    const current = saved.find((c) => c.id === this.sceneSource);
    if (current) {
      const delRow = el('div', 'pill-row');
      delRow.appendChild(
        pill(`Delete “${shortName(current.scene.name)}”`, () => {
          deleteCustom(current.id);
          this.sceneSource = 'two-crossing';
          this.setScene(makeSample('two-crossing'));
        }),
      );
      pop.appendChild(delRow);
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
        this.flash('Could not read that file: ' + (e as Error).message, true);
      }
      fileInput.value = '';
    });
    pop.appendChild(fileInput);

    return pop;
  }

  private disarmResetAll(): void {
    window.clearTimeout(this.resetAllTimer);
    this.resetAllArmed = false;
  }

  /**
   * First press arms, second press straightens the whole stack — and the arming
   * lapses on its own if it goes unanswered. A `confirm()` would be the obvious
   * guard, but modal dialogs are refused in a sandboxed frame, which is exactly
   * where this page runs when it is published.
   */
  private resetAllControls(): void {
    window.clearTimeout(this.resetAllTimer);
    if (!this.resetAllArmed) {
      this.resetAllArmed = true;
      this.resetAllTimer = window.setTimeout(() => {
        this.resetAllArmed = false;
        this.renderDock();
      }, 4000);
      this.renderDock();
      return;
    }
    this.resetAllArmed = false;
    for (const st of this.scene.strands) resetControlPoints(st);
    this.apply(false);
    this.renderDock();
    this.flash('Every strand straightened.');
  }

  /** Refresh just the values printed on the dock pills, without rebuilding the
   *  open card underneath a slider being dragged. */
  private syncDockValues(): void {
    const host = this.dockHost;
    if (!host) return;
    const p = this.view.getParams();
    const values: Record<string, string> = {
      Ribbon: String(p.thickness),
      Weave: p.weave ? 'on' : 'off',
    };
    for (const b of Array.from(host.querySelectorAll('.dock-btn'))) {
      const label = b.firstChild?.textContent?.trim() ?? '';
      const u = b.querySelector('u');
      if (u && values[label] != null) u.textContent = values[label];
    }
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
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });

    const box = el('div', 'browser');
    const head = el('div', 'browser-head');
    head.appendChild(el('h3', undefined, 'Samples'));
    head.appendChild(pill('Close', close));
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
        const b = pill(s.label, () => pick(s.key));
        if (s.key === this.sceneSource) b.classList.add('browser-on');
        list.appendChild(b);
      }
      body.appendChild(list);
    }

    // The family. Rows are m, columns are n, and the two are interchangeable — an
    // m x n stitch is an n x m one looked at sideways — so the grid is symmetric.
    // Hidden while SHOW_ORIGINAL_TWIST_FAMILY is off; the scenes themselves stay
    // reachable by key, this is only the folder that lists them.
    if (SHOW_ORIGINAL_TWIST_FAMILY) {
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
          const b = pill('', () => pick(s.key));
          b.classList.add('browser-cell');
          // Fade with the slack, so the usable region of the family is visible at a
          // glance rather than hidden behind 64 identical buttons.
          b.style.setProperty('--slack', String(Math.min(1, s.slack / 6)));
          b.appendChild(el('b', undefined, `${m}×${n}`));
          b.appendChild(el('small', undefined, `${s.turn.toFixed(1)}°`));
          b.appendChild(
            el('small', 'browser-slack', s.slack < 1 ? 'tight' : `+${s.slack.toFixed(1)}w`),
          );
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
    }

    // The 1xn reference's own 64 faces, in both hands. Hand is a real distinction
    // here and not a label -- the reference tabulates every size in both, and one
    // is the exact mirror of the other.
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
        (SHOW_ORIGINAL_TWIST_FAMILY
          ? 'The same 64 faces built to the 1×n reference. '
          : 'All 64 m×n faces, built to the 1×n reference. ') +
          'Two things change from the original single-turn law. Laces now ' +
          'sit a tenth of a width apart instead of touching, so the weave is no longer ' +
          'jammed against itself; and the turn comes out of that clearance rather than ' +
          'being assumed — 50.03° at a 1×1, where the original says 45°, and 45° turns ' +
          'out to overlap the laces. Each cell quotes its turn, and its tooltip what the ' +
          "reference's larger fan wants. A column cannot have that larger angle: its few " +
          'laces would no longer reach across the wide band, and the weave comes apart. ' +
          'That is why the shading off the diagonal survives the new angles — the slack is real, and ' +
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
          const b = pill('', () => pick(key));
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
        const b = pill(c.scene.name, () => pick(c.id));
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
        this.flash('That saved sample could not be opened: ' + (e as Error).message, true);
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
      this.renderDock();
      this.flash('Could not save here — local storage is blocked. Copy the JSON instead.', true);
      return;
    }
    this.sceneSource = entry.id;
    // render() redraws the dock with the Scene card still open, so the saved name
    // appears in the dropdown under the press that saved it. openDock('scene')
    // here would TOGGLE that card shut instead.
    this.render();
    this.flash(`Saved as “${name}”.`);
  }

  private async copyJson(text: string, area: HTMLTextAreaElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.flash('Copied.');
    } catch {
      // A sandboxed frame can refuse clipboard writes outright; fall back to
      // selecting the text so the keyboard shortcut works.
      area.focus();
      area.select();
      this.flash('Clipboard blocked here — the text is selected, press Ctrl/Cmd+C.', true);
    }
  }

  private async downloadJson(text: string): Promise<void> {
    const api = window.claude?.downloads;
    if (!api) return;
    const filename = `${this.scene.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'scene'}.json`;
    try {
      await api.save({ filename, data: text });
      this.flash(`Saved ${filename}.`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return; // viewer said no; never auto-retry
      this.flash('Download unavailable here — copy the text instead.', true);
    }
  }

  /**
   * A toast over the canvas. The old panel printed these into the Scene section,
   * which no longer exists as a place — and half of them report on something the
   * dock card may already have been closed over.
   */
  private flash(message: string, warn = false): void {
    const note = el('div', 'toast' + (warn ? ' warn' : ''), message);
    document.body.appendChild(note);
    window.setTimeout(() => note.classList.add('on'), 10);
    window.setTimeout(() => {
      note.classList.remove('on');
      window.setTimeout(() => note.remove(), 300);
    }, warn ? 5200 : 2600);
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
    this.selectedId = s.id;
    this.apply(false);
  }

  // ---- The layer stack -----------------------------------------------------
  private stackHost: HTMLElement | null = null;
  private barHost: HTMLElement | null = null;
  private brandTag: HTMLElement | null = null;

  /** The scene's own line in the brand bar. Refreshed with the stack rather than
   *  only on a full render: adding a strand used to leave the count stale. */
  private syncBrand(): void {
    const tag = this.brandTag;
    if (!tag) return;
    tag.textContent = plural(this.scene.strands.length, 'strand');
    tag.title = `${this.scene.name} — ${sceneTag(this.scene)}`;
  }

  /**
   * A card per storey, highest first, then the masks in a card of their own.
   *
   * The stack is stored bottom-up (`strands[0]` is the lowest layer) and shown
   * top-down, because the top of the panel is the front of the scene. Level N is
   * the run of strands with N breaks at or below them, and it is break N-1 that
   * moves or deletes it — level 0 is the ground and has no break, so its header
   * carries no controls.
   */
  private renderStack(): void {
    const host = this.stackHost;
    if (!host) return;
    host.innerHTML = '';

    // Masks are crossings rather than storeys, so they sit above the stack proper
    // — which is also where OpenStrand's own layer panel keeps them.
    if (this.scene.masks.length) host.appendChild(this.maskCard());

    const top = this.scene.levelBreaks.length;
    for (let level = top; level >= 0; level--) {
      const rows: number[] = [];
      for (let i = this.scene.strands.length - 1; i >= 0; i--) {
        if (levelAt(this.scene, i) === level) rows.push(i);
      }
      // The bar goes UNDER the layers it carries, because that is what a storey
      // is: the floor they rest on. Level 0's bar is therefore the last thing in
      // the panel — the ground, under everything — and pressing ▼ on a bar walks
      // it down past the row below, which is exactly the layer that then joins
      // the storey above it. A break parked at the very top holds no layers yet,
      // so its bar stands alone with nothing over it; every layer added from now
      // on is born up there, above that bar.
      if (rows.length) host.appendChild(this.levelGroup(level, rows));
      host.appendChild(this.levelBar(level, rows.length));
    }
  }

  /**
   * The storey marker: a bar of its own, above the layers resting on it.
   *
   * Level N is break N-1, so the bar carries that break's ▲▼✕. Level 0 is the
   * ground — not a break at all, just what is left below the lowest one — so its
   * bar has nothing to move and says so by carrying no controls.
   */
  private levelBar(level: number, count: number): HTMLElement {
    const bar = el('div', 'level-bar' + (level === 0 ? ' ground' : ''));

    bar.appendChild(el('span', 'level-badge', String(level)));
    bar.appendChild(el('b', undefined, `Level ${level}`));

    const step = fmt(this.view.getLevelStep());
    const layers = plural(count, 'layer');
    bar.appendChild(
      el(
        'small',
        undefined,
        level === 0
          ? `ground · ${layers}`
          : `+${level} ${level === 1 ? 'storey' : 'storeys'} · ${layers}`,
      ),
    );
    bar.title =
      level === 0
        ? 'The ground storey — everything here rests on the base plane.'
        : `Rests ${level} × ${step} above the ground — the strand thickness plus the band the weave lifts and dips through.`;

    if (level > 0) {
      const index = level - 1;
      const at = this.scene.levelBreaks[index];
      const controls = el('span', 'row-acts');

      const up = iconBtn('▲', 'Move up (fewer layers lifted)', () => {
        moveLevelBreak(this.scene, index, +1);
        this.apply(false);
      });
      up.disabled = at >= this.scene.strands.length;
      controls.appendChild(up);

      const down = iconBtn('▼', 'Move down (lift one more layer)', () => {
        moveLevelBreak(this.scene, index, -1);
        this.apply(false);
      });
      down.disabled = at <= 0;
      controls.appendChild(down);

      const del = iconBtn('✕', 'Remove this level', () => {
        removeLevelBreak(this.scene, index);
        this.apply(false);
      });
      del.classList.add('danger');
      controls.appendChild(del);

      bar.appendChild(controls);
    }
    return bar;
  }

  /** The layers resting on one storey, top of the stack first. Only drawn when
   *  the storey has any: an empty one is just its bar, with nothing over it. */
  private levelGroup(level: number, rows: number[]): HTMLElement {
    const group = el('div', 'level-group');
    group.setAttribute('aria-label', `Level ${level}`);
    for (const i of rows) {
      group.appendChild(this.layerRow(i));
      if (this.scene.strands[i].id === this.selectedId) {
        group.appendChild(this.inspector(this.scene.strands[i], i));
      }
    }
    return group;
  }

  private maskCard(): HTMLElement {
    const card = el('section', 'mask-card');
    const head = el('header');
    head.appendChild(el('b', undefined, 'Masks'));
    head.appendChild(el('small', undefined, plural(this.scene.masks.length, 'crossing')));
    card.appendChild(head);
    const body = el('div');
    // OSS appends a MaskedStrand to the end of the strand list, which is the top
    // of the layer panel; here they are a kind of their own, so they keep their
    // own order and their own card.
    this.scene.masks.forEach((m, i) => body.appendChild(this.maskRow(m, i)));
    card.appendChild(body);
    return card;
  }

  /** A mask row. The disc shows the two strands' own colours, over above under,
   *  so the row states the relationship at a glance. */
  private maskRow(mask: MaskLink, index: number): HTMLElement {
    const row = el('div', 'row row-mask');

    const over = this.scene.strands.find((s) => s.id === mask.overId);
    const under = this.scene.strands.find((s) => s.id === mask.underId);
    const disc = el('span', 'mask-disc');
    if (over && under) {
      disc.style.background = `linear-gradient(180deg, ${hex(over.color)} 50%, ${hex(under.color)} 50%)`;
    }
    disc.title = `${mask.overId} over ${mask.underId}`;
    row.appendChild(disc);

    const name = el('span', 'row-name');
    name.appendChild(el('span', 'row-id', mask.overId));
    name.appendChild(el('span', 'tag coral', 'over'));
    name.appendChild(el('span', 'row-id', mask.underId));
    row.appendChild(name);

    const controls = el('span', 'row-acts');
    controls.appendChild(
      iconBtn('⇅', `${mask.overId} rides over ${mask.underId} — click to swap`, () =>
        this.view.flipMask(index),
      ),
    );
    const del = iconBtn('✕', 'Delete mask layer', () => this.view.removeMask(index));
    del.classList.add('danger');
    controls.appendChild(del);
    row.appendChild(controls);
    return row;
  }

  private layerRow(index: number): HTMLElement {
    const strand = this.scene.strands[index];
    const selected = strand.id === this.selectedId;
    const row = el('div', 'row' + (selected ? ' sel' : '') + (strand.isMask ? ' row-mask' : ''));

    const swatch = el('span', 'swatch');
    swatch.style.background = hex(strand.color);
    row.appendChild(swatch);

    // The row itself is the select target: one press opens this strand's own
    // controls under it, another puts them away.
    const name = el('button', 'row-name') as HTMLButtonElement;
    name.type = 'button';
    name.setAttribute('aria-expanded', String(selected));
    name.title = selected ? 'Close this strand’s controls' : 'Open this strand’s controls';
    name.appendChild(el('span', 'row-id', strand.id));
    if (strand.isMask) name.appendChild(el('span', 'tag', 'mask'));
    // Show attach lineage — the OSS "this strand hangs off <parent>" relationship.
    if (strand.parentId) name.appendChild(el('span', 'tag', `↳ ${strand.parentId}`));
    name.addEventListener('click', () => {
      this.selectedId = selected ? null : strand.id;
      this.renderStack();
    });
    row.appendChild(name);

    const controls = el('span', 'row-acts');
    controls.appendChild(
      iconBtn(strand.visible ? '●' : '○', 'Show / hide', () => {
        strand.visible = !strand.visible;
        this.apply(false);
      }),
    );
    const up = iconBtn('▲', 'Move up — over the row or the level above', () =>
      this.reorder(index, +1),
    );
    up.disabled = !this.canMove(index, +1);
    controls.appendChild(up);
    const down = iconBtn('▼', 'Move down — under the row or the level below', () =>
      this.reorder(index, -1),
    );
    down.disabled = !this.canMove(index, -1);
    controls.appendChild(down);
    row.appendChild(controls);
    return row;
  }

  /**
   * The selected strand's own controls, opened in its row: colour, width, and the
   * ↺ that puts its control points back where a fresh strand keeps them — both on
   * the start, no centre, nothing flagged as touched — which straightens the run.
   */
  private inspector(strand: Strand3D, index: number): HTMLElement {
    const box = el('div', 'inspector');

    const colours = el('div', 'insp-row');
    colours.appendChild(el('span', 'insp-label', 'Colour'));
    const chips = el('span', 'chips');
    for (const c of PALETTE) {
      const chip = el('button', 'chip') as HTMLButtonElement;
      chip.type = 'button';
      chip.style.background = hex(c);
      chip.title = hex(c);
      if (hex(c) === hex(strand.color)) chip.classList.add('on');
      chip.addEventListener('click', () => {
        strand.color = { ...c, a: strand.color.a };
        this.apply(false);
      });
      chips.appendChild(chip);
    }
    // The palette is six laces; anything else comes out of the picker, which is
    // also how a colour read off a file gets edited rather than replaced.
    const custom = el('input', 'swatch-input') as HTMLInputElement;
    custom.type = 'color';
    custom.value = hex(strand.color);
    custom.title = 'Any colour';
    custom.addEventListener('input', () => {
      strand.color = rgbaFromHex(custom.value, strand.color.a);
      this.apply(false);
    });
    chips.appendChild(custom);
    colours.appendChild(chips);
    box.appendChild(colours);

    box.appendChild(
      slider('Width', strand.width, 6, 140, 1, (v) => {
        strand.width = v;
        this.apply(false);
      }),
    );

    const acts = el('div', 'pill-row');
    const atDefault = controlsAtDefault(strand);
    const straighten = pill('Straighten', () => {
      resetControlPoints(strand);
      this.apply(false);
    });
    straighten.disabled = atDefault;
    straighten.title = atDefault
      ? 'Control points are already at their default'
      : 'Reset control points (straighten this strand)';
    acts.appendChild(straighten);
    acts.appendChild(
      pill(strand.visible ? 'Hide' : 'Show', () => {
        strand.visible = !strand.visible;
        this.apply(false);
      }, 'Show / hide this strand'),
    );

    // A bin for deleting and a ✕ for closing. They were the same button before,
    // which is the one pairing you cannot have: ✕ reads as "put this away" on
    // every panel ever built, and it was throwing the strand away instead.
    const del = el('button', 'pill square danger') as HTMLButtonElement;
    del.type = 'button';
    del.innerHTML = BIN_ICON;
    del.title = `Delete strand ${strand.id}`;
    del.setAttribute('aria-label', `Delete strand ${strand.id}`);
    del.addEventListener('click', () => {
      removeStrandAt(this.scene, index);
      this.selectedId = null;
      this.apply(false);
    });
    acts.appendChild(del);

    const close = pill('✕', () => {
      this.selectedId = null;
      this.renderPanelBody();
    }, 'Close these controls — the strand stays');
    close.classList.add('ghost', 'square');
    close.setAttribute('aria-label', 'Close these controls');
    acts.appendChild(close);

    box.appendChild(acts);
    return box;
  }

  /**
   * Which level bar, if any, is immediately next to this row in the direction it
   * is about to travel. Going down (-1) that is a break at the row's own position
   * — the bar drawn under it; going up (+1), the break one above.
   */
  private barBeside(index: number, dir: 1 | -1): number {
    return this.scene.levelBreaks.indexOf(dir === -1 ? index : index + 1);
  }

  /** Is there anything for this row to step past — a strand, or a bar? */
  private canMove(index: number, dir: 1 | -1): boolean {
    const j = index + dir;
    if (j >= 0 && j < this.scene.strands.length) return true;
    return this.barBeside(index, dir) !== -1;
  }

  /**
   * One step down (or up) the stack — and the stack contains level bars as well
   * as strands, so a bar is a step of its own.
   *
   * With a bar directly below it, pressing ▼ used to swap the strand with the
   * strand BEYOND the bar: it changed storey and jumped a neighbour at the same
   * time. Stepping past the bar instead moves the bar up over this strand, which
   * drops the strand a storey and leaves it exactly where it was in the stack —
   * under the level, still over the row below. Which is what the arrow looks like
   * it should do.
   */
  private reorder(index: number, dir: 1 | -1): void {
    const b = this.barBeside(index, dir);
    if (b !== -1) {
      // The row goes one way, so the bar goes the other.
      moveLevelBreak(this.scene, b, dir === -1 ? 1 : -1);
      this.apply(false);
      return;
    }
    const j = index + dir;
    if (j < 0 || j >= this.scene.strands.length) return;
    const arr = this.scene.strands;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    this.apply(false);
  }

  // ---- The About sheet -----------------------------------------------------
  // Every word the panel used to print, in one place. It slides up over the
  // panel and takes the whole of it, so opening reads as the panel turned over
  // rather than a dialog dropped on top.
  private aboutHost: HTMLElement | null = null;
  private aboutOpen = false;

  private buildAbout(): void {
    const sheet = el('div', 'sheet');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.setAttribute('role', 'region');
    sheet.setAttribute('aria-label', 'About');

    const head = el('div', 'sheet-head');
    head.appendChild(el('h2', undefined, 'About'));
    const close = el('button', 'round hot', '✕') as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.closeAbout());
    head.appendChild(close);
    sheet.appendChild(head);

    const body = el('div', 'sheet-body');
    for (const [title, html] of ABOUT) {
      const entry = el('div', 'entry');
      entry.appendChild(el('h3', undefined, title));
      const p = el('p');
      p.innerHTML = html;
      entry.appendChild(p);
      body.appendChild(entry);
    }
    // The storage caveat is a fact about the browser this page happens to be in,
    // so it is stated only where it is true.
    if (!storageAvailable()) {
      const entry = el('div', 'entry');
      entry.appendChild(el('h3', undefined, 'This browser'));
      const p = el('p');
      p.innerHTML =
        'Local storage is blocked here, so <b>Save</b> cannot keep a scene between ' +
        'refreshes. Use <b>JSON → Copy</b> to keep your work instead.';
      entry.appendChild(p);
      body.appendChild(entry);
    }
    const out = el('div', 'entry');
    const link = el('a', 'sheet-link', 'The project, the geometry and the notes ↗');
    link.href = '../';
    out.appendChild(link);
    body.appendChild(out);

    sheet.appendChild(body);
    this.aboutHost = sheet;
    this.root.appendChild(sheet);
  }

  private toggleAbout(from: HTMLButtonElement): void {
    if (this.aboutOpen) this.closeAbout();
    else this.openAbout(from);
  }

  private openAbout(from: HTMLButtonElement): void {
    const sheet = this.aboutHost;
    if (!sheet || this.aboutOpen) return;
    // On a narrow screen the panel is a folded-away bottom sheet; opening About
    // has to bring it back, or the sheet would slide up inside nothing.
    document.body.classList.remove('panel-collapsed');
    this.aboutOpen = true;
    sheet.classList.add('open');
    sheet.removeAttribute('aria-hidden');
    from.setAttribute('aria-expanded', 'true');
    const close = sheet.querySelector<HTMLButtonElement>('.round.hot');
    close?.focus({ preventScroll: true });
  }

  private closeAbout(): void {
    const sheet = this.aboutHost;
    if (!sheet || !this.aboutOpen) return;
    this.aboutOpen = false;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    this.helpBtn?.setAttribute('aria-expanded', 'false');
    this.helpBtn?.focus({ preventScroll: true });
  }
}

// ---- the About text --------------------------------------------------------
// Everything the panel used to print, in the order you meet it. The colours
// named here are the ones the overlays actually light up in.
const ABOUT: Array<[string, string]> = [
  [
    'The five tools',
    '<b>Pan</b> slides the camera · <b>Orbit</b> turns it · <b>Move</b> drags endpoints and ' +
      'control points, and connected strands follow · <b>Attach</b> grows a new strand from a ' +
      'free endpoint · <b>Weave</b> masks one strand over another.',
  ],
  [
    'Attaching',
    'Pull from a <b class="c-free">green</b> endpoint to grow a new attached strand: it ' +
      'joins the same set and stacks on top. <b class="c-occ">Gray</b> endpoints are already joined.',
  ],
  [
    'Control points',
    'Drag a <b class="c-end">blue</b> endpoint and connected strands follow. Pull the ' +
      '<b class="c-cp">green triangle</b> to bend the strand; that brings out the ' +
      '<b class="c-cp">circle</b> (the far handle) and the <b class="c-cp">square</b> ' +
      '(the middle). Park the circle back on the start to fold them away again. ' +
      '<b>Straighten</b> on a row does the same in one press.',
  ],
  [
    'Masks',
    'Click the strand that goes <b>over</b>, then the one it goes under: they interlock at their ' +
      'crossing, which is the 3D version of an OpenStrand mask. Hovering lights <b>one layer</b>, ' +
      'not the whole arm family, and names it — so on a stitch you can see exactly which of its ' +
      'strands you are about to mask. With no mask on a crossing, the higher layer wins.',
  ],
  [
    'Levels',
    'Counted from <b>0</b>, the ground. One level up is one whole storey — the strand thickness ' +
      'plus the band the weave needs — so a lace up there rests <b>on</b> the woven round below ' +
      'instead of sinking into it. <b>Level</b> adds one at the top of the stack, so everything ' +
      'made from then on is born a storey higher; drag it down with ▼ to lift the layers it ' +
      'passes.',
  ],
  [
    'Depth and lift',
    '<b>Depth</b> is how far a lace lifts over or dips under a crossing — the same either way, ' +
      'however far apart the two layers are. <b>Layer lift</b> is the smaller step between ' +
      'consecutive layers, which is what separates strands that overlap without crossing.',
  ],
  [
    'Files',
    'Opens OpenStrand Studio and OpenStrandJS saves, and scenes saved here. <b>Save</b> keeps the ' +
      'current scene in this browser so it survives a refresh; <b>JSON</b> gives you the text to ' +
      'share or paste into a source file. Nothing leaves your machine.',
  ],
];

// ---- theme -----------------------------------------------------------------
// The site is cream paper; a dark canvas is a real need at night and the panel
// has to follow it. The choice is remembered, and it overrides the OS in either
// direction — a light-mode phone at 2am is exactly the case a media query alone
// cannot answer.

const THEME_KEY = 'scoubidou3d-theme';
const themeButtons: HTMLButtonElement[] = [];
// The canvas is the biggest surface on the page and three.js owns its clear
// colour, so the theme has to reach in there too.
let themedView: StrandScene | null = null;

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function initTheme(view: StrandScene): void {
  themedView = view;
  // app/index.html sets the attribute inline, before the first paint — otherwise a
  // dark-theme visitor gets a flash of cream while this module loads. Trust it if
  // it is there, and work it out only if the page was opened without it.
  let name = document.documentElement.dataset.theme;
  if (name !== 'dark' && name !== 'light') {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // A sandboxed frame can refuse storage; the OS preference still applies.
    }
    name = stored === 'dark' || stored === 'light'
      ? stored
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = name;
  }
  view.setTheme(name === 'dark' ? 'dark' : 'light');
}

function setTheme(name: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = name;
  themedView?.setTheme(name);
  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {
    // Not fatal: the attribute is what actually styles the page.
  }
  syncThemeButtons();
}

function syncThemeButtons(): void {
  const dark = currentTheme() === 'dark';
  for (const b of themeButtons) {
    b.innerHTML = dark ? SUN_ICON : MOON_ICON;
    b.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(dark));
  }
}

// ---- icons -----------------------------------------------------------------

const svg = (body: string): string =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

// The brand mark, as on the project site: a gold lace with a coral one over it,
// which is the whole product in three rectangles.
const MARK =
  '<svg class="mark" viewBox="0 0 72 72" aria-hidden="true" focusable="false">' +
  '<path class="ma" d="M9 16h54v16H9z" />' +
  '<path class="mb" d="M28 8h16v56H28z" />' +
  '<path class="mt" d="M28 16h16v16H28z" />' +
  '</svg>';

// The stacked-layers mark used by the "Level" button and by the level badges: a
// slab seen edge-on with a second one showing beneath it — one storey above
// another, which is exactly what a level is.
const LAYERS_ICON = svg(
  '<path d="M12 3 22 9.2 12 15.4 2 9.2Z" />' +
    '<path d="M12 17.7 3.7 12.5 2 13.6 12 19.8 22 13.6 20.3 12.5Z" />',
);

// The toolbar's marks. Each one states what the tool acts on rather than naming
// it twice: a hand that takes hold of the view, a four-way drag that takes hold
// of a strand, a strand growing out of a joint, and one band crossing over
// another with the second broken where it passes beneath — which is the whole of
// what a mask says.
const TOOL_ICONS: Record<EditMode, string> = {
  pan: svg(
    '<path d="M18.5 8.2c-.3 0-.6.07-.85.2V6.1a1.65 1.65 0 0 0-2.5-1.42A1.65 1.65 0 0 0 12 3.6a1.63 1.63 0 0 0-.9.27V2.9a1.65 1.65 0 1 0-3.3 0v7.72l-.62-.75a1.75 1.75 0 0 0-2.7 2.22l3.5 4.75A5.9 5.9 0 0 0 12.7 20h1.6a5.85 5.85 0 0 0 5.85-5.85V9.85c0-.91-.74-1.65-1.65-1.65Z" />',
  ),
  orbit: svg(
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z" />' +
      '<circle cx="12" cy="12" r="3.2" />',
  ),
  move: svg(
    '<path d="M12 1.6 8.4 5.2h2.4v4.6H6.2V7.4L2.6 11l3.6 3.6v-2.4h4.6v4.6H8.4L12 20.4l3.6-3.6h-2.4v-4.6h4.6v2.4L21.4 11l-3.6-3.6v2.4h-4.6V5.2h2.4Z" />',
  ),
  attach: svg(
    '<circle cx="5.6" cy="18.4" r="3" />' +
      '<path d="M6.5 15.6a10.4 10.4 0 0 1 9.1-9.1V3.2l5 4.4-5 4.4V9a7.4 7.4 0 0 0-6.1 6.1Z" />',
  ),
  // Diagonally, because upright straps have only the height of the box to run in
  // and end up too stubby to read as straps — the mark came out as a division
  // sign. On the diagonal both have the box's full reach, and the broken one
  // states the whole of what a mask says: this lace passes under that one.
  weave: svg(
    '<g transform="rotate(-45 12 12)">' +
      '<rect x="-1.5" y="9.5" width="10" height="5" rx="2.5" />' +
      '<rect x="15.5" y="9.5" width="10" height="5" rx="2.5" />' +
      '</g>' +
      '<rect x="-1.5" y="9.5" width="27" height="5" rx="2.5" transform="rotate(45 12 12)" />',
  ),
};

// A bin: lid, body, and two staves. Unmistakably "this is thrown away", which is
// the whole point of it not being another ✕.
const BIN_ICON = svg(
  '<path d="M9.2 2.5h5.6l1 1.4H20v2.2H4V3.9h4.2Z" />' +
    '<path d="M5.6 8h12.8l-.9 12.2a1.8 1.8 0 0 1-1.8 1.7H8.3a1.8 1.8 0 0 1-1.8-1.7Z' +
    'm4 2.6v8.2h1.7v-8.2Zm3 0v8.2h1.7v-8.2Z" />',
);

const MOON_ICON = svg('<path d="M12.6 2.1A9.9 9.9 0 1 0 21.9 15 8 8 0 0 1 12.6 2.1Z" />');

const SUN_ICON = svg(
  '<circle cx="12" cy="12" r="4.6" />' +
    '<path d="M11 .8h2v3.6h-2zm0 18.8h2v3.6h-2zM.8 11h3.6v2H.8zm18.8 0h3.6v2h-3.6z' +
    'M3.5 4.9 4.9 3.5l2.6 2.5L6 7.5zm13 13 1.4-1.4 2.6 2.5-1.5 1.5zM4.9 20.5 3.5 19l2.5-2.5 1.5 1.4z' +
    'm13-13L16.5 6 19 3.5l1.5 1.4z" />',
);

const PALETTE: RGBA[] = [
  { r: 245, g: 200, b: 55, a: 255 },
  { r: 226, g: 122, b: 38, a: 255 },
  { r: 60, g: 170, b: 175, a: 255 },
  { r: 210, g: 90, b: 110, a: 255 },
  { r: 120, g: 140, b: 220, a: 255 },
  { r: 240, g: 240, b: 240, a: 255 },
];

// ---- small DOM builders ----------------------------------------------------

function pill(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', 'pill', label) as HTMLButtonElement;
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function iconPill(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'pill') as HTMLButtonElement;
  b.type = 'button';
  b.innerHTML = `${icon}<span>${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

function iconBtn(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'icon-btn', glyph) as HTMLButtonElement;
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** A checkbox as a small square with a tick — the page is geometric, and a
 *  rounded switch reads as a different kit. */
function check(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = el('label', 'check' + (value ? ' on' : ''));
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => {
    wrap.classList.toggle('on', input.checked);
    onChange(input.checked);
  });
  wrap.appendChild(input);
  wrap.appendChild(el('i'));
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
  head.appendChild(el('span', undefined, label));
  const val = el('var', undefined, fmt(value));
  head.appendChild(val);
  wrap.appendChild(head);
  const input = el('input') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  // The filled part of the track is painted from --pct rather than left to the
  // browser's own accent rendering, which does not follow a themed page.
  const paint = (v: number): void => {
    input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
  };
  paint(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    paint(v);
    val.textContent = fmt(v);
    onChange(v);
  });
  wrap.appendChild(input);
  return wrap;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** The scene's own line for the brand bar: name plus what it is made of. */
function sceneTag(scene: Scene3D): string {
  const bits = [plural(scene.strands.length, 'strand')];
  if (scene.masks.length) bits.push(plural(scene.masks.length, 'mask'));
  if (scene.levelBreaks.length) bits.push(plural(scene.levelBreaks.length + 1, 'level'));
  return bits.join(' · ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Names get long — a twist face quotes its whole family. The dock pill wants
 *  the head of it, not the lot. */
function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}
