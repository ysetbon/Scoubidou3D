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
//     than storeys, so they are not in the stack at all: the bar opens with a
//     LAYERS | MASKS switch, and the crossings are the other side of it.
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
//     over the canvas is a single status pill: the camera gesture on a mouse,
//     the weave's pending pick when there is one, and nothing at all on a touch
//     screen until that pick exists.
//
// The panel owns the working Scene3D and pushes changes into the StrandScene.
// Reordering a layer here restacks it in Z — the direct 3D analogue of moving a
// layer in OpenStrand's layer panel.

import { StrandScene, EditMode } from '../scene/StrandScene';
import { MaskLink, Scene3D, Strand3D, RGBA } from '../model/types';
import { SAMPLE_LABELS, TWIST_FAMILY, TWIST_MAX, makeSample } from '../model/samples';
import { GAP, HANDS, TWOFAN_COLUMN_FAMILY, TWOFAN_MAX, columnKey } from '../model/twofan';
import { BOX_FAMILY, BOX_MAX, BOX_ROUNDS, boxColumnKey, column } from '../model/boxmn';
import { parseSceneText, sceneFromFile, sceneToJson } from '../model/sceneIO';
import { History } from '../model/history';
import {
  addLevelBreak,
  levelAt,
  moveLevelBreak,
  removeLevelBreak,
  removeStrandAt,
} from '../model/levels';
import { deleteCustom, getCustom, listCustom, saveCustom, storageAvailable } from '../model/customSamples';
import { controlsAtDefault, resetControlPoints } from '../model/controlPoints';
import { Scope, recolour, setMembers, setOf } from '../model/colour';

// Where the numbers in the reference folder come from. All three live outside the
// studio bundle, so they are plain links rather than samples: relative ones so the
// dev server, a preview build and the project site all resolve them the same way.
const TWIST_DOORS: { href: string; label: string; note: string; title: string }[] = [
  {
    href: '../twist/',
    label: 'All 64 faces',
    note: 'the study',
    title: 'The twist stitch, all 64 faces — what was measured, and what it cost',
  },
  {
    href: '../levels/',
    label: 'The level gallery',
    note: '1,408 views',
    title: 'Every level of every face, top view and orbit, at full resolution',
  },
  {
    href: 'https://claude.ai/code/artifact/dd01aab8-db95-4b72-bcc3-4f2faf6da48b',
    label: 'The write-up',
    note: 'all 64, all levels',
    title: 'The full write-up: every face, every level, with the numbers beside them',
  },
];

// The same 64 faces at k = 0, drawn flat: the starting stitch and the closed box
// side by side, in both hands, with the rules they follow. Outside the bundle,
// so a link rather than a sample.
const BOX_DOORS: { href: string; label: string; note: string; title: string }[] = [
  {
    href: 'https://claude.ai/code/artifact/a733e1f3-9ed4-490d-845d-c6090e89abb4',
    label: 'All 64 faces, drawn',
    note: 'both hands',
    title: 'Box Stitches — the starting stitch and the box it closes into, every m×n face',
  },
];

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

/**
 * The picker works in HSV, not RGB: hue round, saturation across, value down is
 * the one arrangement where "the same colour, paler" is a straight move — which
 * is what someone hunting for a lace colour is actually doing. RGB is the
 * storage format, so the two are converted at the edges.
 */
interface HSV {
  /** 0–360, and 0 for a grey — which has no hue to keep. */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

function rgbToHsv(c: RGBA): HSV {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgba(c: HSV, a: number): RGBA {
  const f = (n: number): number => {
    const k = (n + c.h / 60) % 6;
    return Math.round(255 * (c.v - c.v * c.s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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

/**
 * What the stack is showing. The panel used to title itself "Layers" and print
 * TOP = FRONT beside it, with the masks riding in a card pinned above the stack.
 * The word only ever named what the panel already was, and the note is a fact
 * you learn once and then read forever — so both are gone, and the space went to
 * a switch that says what is on screen AND changes it. Masks are a different
 * kind of thing from layers (a crossing, not a storey), and now they get a view
 * of their own rather than a card in someone else's.
 */
type StackView = 'layers' | 'masks';

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
  // Which side of the stack bar's switch is down. Panel-side only, and kept
  // across redraws: adding a strand should not throw you back out of the masks.
  private stackView: StackView = 'layers';
  // Every state the scene has been in, recorded off its own JSON. See history.ts
  // for the rule; every edit in this file reaches it through `record` below.
  private history = new History();

  constructor(private root: HTMLElement, private view: StrandScene, openKey = 'two-crossing') {
    this.sceneSource = openKey;
    this.scene = view.getScene();
    this.history.reset({ scene: this.scene, source: this.sceneSource });
    // Attach/finalize adds a strand layer, a weave pick adds a mask layer — both
    // land in the layer stack, and the status pill tracks the pending weave pick.
    // `committed` names the gesture for the history, or is null while one is
    // still in flight; see StrandScene.onSceneChanged.
    this.view.onSceneChanged = (committed) => {
      this.scene = this.view.getScene();
      if (committed) this.record(committed);
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
    // Empty until the weave has a half-made pick, which is the only thing it
    // ever says; most of a session it stays exactly like this.
    status.hidden = true;
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

    // The shortcuts every editor has, on the same history the arrows drive.
    // Ctrl+Y is here because Windows still expects it as redo.
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // Not while typing: the JSON box and the name field have an undo of their
      // own, and taking it off them to step the scene back would be a trap.
      if (isTypingIn(e.target)) return;
      e.preventDefault();
      this.travel(key === 'y' || e.shiftKey ? 1 : -1);
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
   * The one line of text over the canvas, and it speaks for one thing only: the
   * weave's half-made pick, the single moment in the app where a mode is holding
   * something for you. The camera gesture used to sit here whenever nothing else
   * did; it is gone, because it never changed and so never earned the canvas —
   * drag/scroll/right-drag is what every 3D view does, and About states it in
   * words for anyone who wants them.
   */
  private syncStatus(): void {
    const host = this.statusHost;
    if (!host) return;
    const pending = this.view.getWeavePending();
    if (!pending) {
      host.textContent = '';
      host.hidden = true;
      return;
    }
    host.innerHTML = `<b>${pending}</b> rides over — now click the strand it crosses`;
    host.hidden = false;
  }

  setScene(scene: Scene3D, label = 'open a scene'): void {
    this.scene = scene;
    this.selectedId = null;
    this.view.setScene(scene, true);
    this.record(label);
    this.render();
  }

  /**
   * Push the working scene into the view, record what it was, and redraw the
   * panel — the one funnel every panel-side edit goes through.
   *
   * @param label what the edit is called in the history
   * @param tag groups a RUN of edits from a single control into one step; see
   *   History.record. A range input fires on every `input` event, so without this
   *   a drag of the width slider would be forty presses of undo.
   */
  private apply(label: string, tag?: string, refit = false): void {
    this.view.setScene(this.scene, refit);
    this.record(label, tag);
    this.renderPanelBody();
  }

  /** Offer the scene as it now stands to the history. Whether that is a step is
   *  the history's call, not this one's: it records only what does not look like
   *  what it already holds. */
  private record(label: string, tag?: string): void {
    this.history.record({ scene: this.scene, source: this.sceneSource }, label, tag);
    this.syncHistory();
  }

  /**
   * One step back (-1) or forward (+1) through the recordings.
   *
   * The camera stays exactly where it is — `setScene(…, false)` skips the refit —
   * because orbiting was never an edit and undo has no business un-orbiting it.
   * And this is a full redraw short of `render()`: the About sheet may be open
   * over the panel, and rebuilding the root would pull it out from under itself.
   */
  private travel(dir: -1 | 1): void {
    const step = dir < 0 ? this.history.undo() : this.history.redo();
    if (!step) return;
    this.scene = step.scene;
    this.sceneSource = step.source;
    // The row whose inspector was open need not exist in the state we land in.
    if (!this.scene.strands.some((s) => s.id === this.selectedId)) this.selectedId = null;
    this.view.setScene(this.scene, false);
    this.renderDock(); // -> renderPanelBody -> the brand line and the stack
    this.syncToolbar();
    this.syncStatus();
    this.flash(`${dir < 0 ? 'Undone' : 'Redone'}: ${step.label}.`);
  }

  /** Just the two arrows. An edit changes what they can do a great deal more
   *  often than it changes the tools beside them, and rebuilding the whole strip
   *  for that would take the button out from under the pointer. */
  private syncHistory(): void {
    const back = this.history.undoLabel();
    const forward = this.history.redoLabel();
    if (this.undoBtn) {
      this.undoBtn.disabled = !back;
      this.undoBtn.title = back ? `Undo ${back} — ⌘/Ctrl+Z` : 'Nothing to undo';
    }
    if (this.redoBtn) {
      this.redoBtn.disabled = !forward;
      this.redoBtn.title = forward ? `Redo ${forward} — ⇧⌘/Ctrl+Shift+Z` : 'Nothing to redo';
    }
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
    // headers their layers, the switch its crossings.
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

    // Only the layer stack hangs from the floor (renderStack puts it back): a
    // dock card is not a stack, and neither is a list of crossings.
    host.classList.remove('from-bottom');

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

    bar.appendChild(this.viewSwitch());
    // Both adders make a LAYER, so either one takes you back to the layers if you
    // were in the masks — otherwise the press appears to do nothing at all.
    // "Level" drops a storey marker at the top of the stack, so everything added
    // from here on rests a full storey higher. See levels.ts.
    const addLevel = iconPill(LAYERS_ICON, 'Level', () => {
      this.stackView = 'layers';
      addLevelBreak(this.scene);
      this.apply('add a level');
    });
    addLevel.classList.add('coral');
    addLevel.title = 'Add a level: from now on, new layers rest one storey higher';
    bar.appendChild(addLevel);
    bar.appendChild(
      pill(
        'Strand',
        () => {
          this.stackView = 'layers';
          this.addStrand();
        },
        'Drop a new straight strand into the scene',
      ),
    );
    this.renderStack();
  }

  /** Which dock card the PANEL is showing, if any — only ever set on a narrow
   *  screen, where a popover would cover the scene it belongs to. */
  private inlineDock(): DockKey | null {
    return this.dockOpen && isNarrow() ? this.dockOpen : null;
  }

  // ---- Layers / Masks ------------------------------------------------------
  // The switch is held so a press can move the thumb and swap the body without a
  // full redraw: rebuilding the bar would put a new thumb on screen already in
  // its final place, and the slide is what says the two views are one panel.
  private switchHost: HTMLElement | null = null;
  private viewTabs: Partial<Record<StackView, HTMLButtonElement>> = {};

  /**
   * The stack bar's switch: two tabs and a filled thumb between them.
   *
   * Each side carries the mark the app already uses for that thing — the Level
   * button's stacked slabs, and one band crossing over another with the lower
   * one broken where it passes beneath, which is the whole of what a mask says.
   * Two words and two marks, and nothing else: the Masks side used to print the
   * count, which is three digits on a woven mat and pushed the switch into the
   * Level and Strand pills beside it. The number is in the tooltip instead — a
   * switch is a control, not a readout.
   */
  private viewSwitch(): HTMLElement {
    const sw = el('div', 'viewswitch');
    sw.dataset.view = this.stackView;
    sw.setAttribute('role', 'tablist');
    sw.setAttribute('aria-label', 'What the panel is showing');
    sw.appendChild(el('span', 'viewswitch-thumb'));
    this.switchHost = sw;
    this.viewTabs = {};
    sw.appendChild(
      this.viewTab(
        'layers',
        LAYERS_ICON,
        'Layers',
        'Show the layer stack — the top of the panel is the front of the scene',
      ),
    );
    const masks = this.scene.masks.length;
    sw.appendChild(
      this.viewTab(
        'masks',
        MASK_ICON,
        'Masks',
        masks
          ? `Show the mask layers — ${plural(masks, 'crossing')}, over above under`
          : 'Show the mask layers — none yet',
      ),
    );
    return sw;
  }

  private viewTab(view: StackView, icon: string, label: string, title: string): HTMLButtonElement {
    const b = el('button') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(this.stackView === view));
    b.innerHTML = `${icon}<span>${label}</span>`;
    b.title = title;
    b.addEventListener('click', () => this.showStackView(view));
    this.viewTabs[view] = b;
    return b;
  }

  /** Flip the switch: the bar stays where it is and only the body is rebuilt. */
  private showStackView(view: StackView): void {
    if (this.stackView === view) return;
    this.stackView = view;
    if (this.switchHost) this.switchHost.dataset.view = view;
    for (const key of ['layers', 'masks'] as StackView[]) {
      this.viewTabs[key]?.setAttribute('aria-selected', String(key === view));
    }
    this.selectedId = null;
    this.renderStack();
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

  // The undo pair, held so an edit can grey them out without redrawing the strip.
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;

  /** The toolbar's buttons, wired to the current mode — with the undo pair ahead
   *  of them, behind a rule. They are not tools (nothing is armed by pressing
   *  one, and neither is ever "on"), so they read as a group of their own, and
   *  they go FIRST because that is where every editor keeps them. */
  private syncToolbar(): void {
    const bar = this.toolbarHost;
    if (!bar) return;
    const mode = this.view.getMode();
    bar.innerHTML = '';
    this.undoBtn = actBtn(UNDO_ICON, 'Undo', () => this.travel(-1));
    this.redoBtn = actBtn(REDO_ICON, 'Redo', () => this.travel(+1));
    bar.append(this.undoBtn, this.redoBtn, el('span', 'tool-sep'));
    this.syncHistory();
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
  // anything — which is what most of the old panel's scrolling was for. And a
  // card that has been used shuts itself: see commitDock for which presses count.
  private dockHost: HTMLElement | null = null;
  private popHost: HTMLElement | null = null;
  private dockOpen: DockKey | null = null;
  // Whether the Scene card's JSON box, paste box and name field are showing.
  private dataOpen = false;
  private pasteOpen = false;
  private namingOpen = false;
  // "Straighten all" hits every layer at once, so it takes two presses: the first
  // arms it, the second does it. Undo will now take it back, but a press that
  // silently rebuilds forty strands still deserves to be asked about first.
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

  /**
   * Close the open card, the way pressing its own pill again would.
   *
   * A floating card sits over the very scene it is changing, so once a press has
   * committed — Fit, a sample loaded, Grid ticked — the card has nothing left to
   * say and is only in the way. So every control that finishes something calls
   * this, and the toast reports what happened over the closed card (see flash).
   *
   * Two kinds of control deliberately do NOT: the sliders, which you hold and
   * tune rather than commit and which would be undraggable if the card went
   * with the first pixel; and the Scene card's own expanders — Save, JSON,
   * Paste — which reveal a field INSIDE this card, so closing over them would
   * be closing over the thing they just opened. Their follow-up press commits.
   *
   * Only the floating case. On a narrow screen the card IS the panel body (see
   * renderPanelBody), where it covers nothing and there is nothing to get out
   * of the way of — closing there would throw you back to the layer stack on
   * every tick.
   *
   * @returns whether the card was closed — a caller that also has to redraw the
   * dock can skip its own render when this one has already done it.
   */
  private commitDock(): boolean {
    if (!this.dockOpen || isNarrow()) return false;
    // openDock(null) always closes: null can never be the already-open key.
    this.openDock(null);
    return true;
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
      check('Outline', p.outline, (v) => {
        this.view.setParams({ outline: v });
        this.commitDock();
      }),
      check('Round ends', p.roundCaps, (v) => {
        this.view.setParams({ roundCaps: v });
        this.commitDock();
      }),
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
        // Closing redraws the pill's on/off with it; on a phone it stays open.
        if (!this.commitDock()) this.syncDockValues();
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
    // Both of these move the camera to show you the whole scene, which is the one
    // thing the card is standing in front of — so they take it away with them.
    shots.append(
      pill('Fit', () => {
        this.view.fitView();
        this.commitDock();
      }),
      pill('Top', () => {
        this.view.topView();
        this.commitDock();
      }),
    );
    pop.appendChild(shots);
    const toggles = el('div', 'check-row');
    toggles.appendChild(
      check('Grid', p.showGrid, (v) => {
        this.view.setParams({ showGrid: v });
        this.commitDock();
      }),
    );
    // OSS's `enable_third_control_point`: with it off a strand has the classic
    // two handles, and a centre already placed by hand is ignored — by the
    // handles and by the curve alike — rather than lost. It belongs to Move, so
    // it only appears while Move is the live tool.
    if (this.view.getMode() === 'move') {
      toggles.appendChild(
        check('Middle handle', p.thirdControlPoint, (v) => {
          this.view.setParams({ thirdControlPoint: v });
          if (!this.commitDock()) this.renderDock();
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
    select.addEventListener('change', () => {
      this.commitDock();
      this.loadSource(select.value);
    });
    sampleRow.appendChild(select);
    pop.appendChild(sampleRow);

    // The dropdown names a dozen scenes; the m x n twist family is 64 more, which
    // is a grid rather than a list. Browse… opens both.
    const browse = el('div', 'pill-row');
    // The browser is a full overlay, so the card would only be sitting behind it
    // waiting to be found again once a scene had been picked.
    const browseBtn = pill('Browse samples…', () => {
      this.commitDock();
      this.openBrowser();
    });
    browseBtn.classList.add('coral');
    browse.appendChild(browseBtn);
    pop.appendChild(browse);

    // None of these three commits anything — Import raises the file picker, and
    // Save and JSON reveal a field further down this same card. So none of them
    // closes it; what they lead to does. See commitDock.
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
        ? 'Press again to straighten every strand — undo takes it back'
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
            this.commitDock();
            this.setScene(scene, 'paste a scene');
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
          this.commitDock();
          // Named for the scene that lands, not for the delete: undo can put the
          // strands back on screen, but nothing brings the saved entry back.
          const fallback = makeSample('two-crossing');
          this.setScene(fallback, `open “${fallback.name}”`);
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
        // Parse first: a file that cannot be read leaves the card up, with the
        // toast next to the button that would try again.
        const scene = parseSceneText(text, f.name.replace(/\.json$/i, ''));
        this.sceneSource = 'imported';
        this.commitDock();
        this.setScene(scene, `open “${scene.name}”`);
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
    this.apply('straighten every strand');
    // Only this second press commits, so only this one closes: the first press
    // arms and returns above, and the card has to stay for the press that answers it.
    if (!this.commitDock()) this.renderDock();
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
          const most = 8 * Math.max(m, n);
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
    // The grid below quotes the numbers. These three are what the numbers came from:
    // the write-up, the 1,408 renders behind it, and the study's own front door.
    body.appendChild(
      el(
        'p',
        'browser-note',
        'Each cell quotes its turn and its overhang. To see them — every level of ' +
          'every face, top view and orbit, at full resolution — take one of these:',
      ),
    );
    const doors = el('div', 'browser-doors');
    for (const d of TWIST_DOORS) {
      const a = el('a', 'browser-door');
      a.href = d.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = d.title;
      a.appendChild(el('b', undefined, d.label));
      a.appendChild(el('small', undefined, d.note));
      doors.appendChild(a);
    }
    body.appendChild(doors);
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
          'out to overlap the laces. Each cell quotes its turn, and its tooltip the two ' +
          'angles a lopsided face is caught between: the smaller fan’s, which its few ' +
          'laces can always reach across, and the larger fan’s, which lays the family ' +
          'you see tight. It takes a point between them and pays for it by opening the gap ' +
          'inside a lace — never between laces, which stay at the floor — so every face ' +
          'weaves whole, every crossing real. The shading off the diagonal is the slack ' +
          'that remains: real, and not something the turn can spend away. On the diagonal ' +
          'the two fans are one angle, so those eight faces pay nothing and are untouched.',
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
            `between laces 1.217 widths — the reference's floor, w + 10\n` +
            (Math.abs(s.wanted - s.ceiling) < 0.005
              ? `m = n, so the reference's two fans coincide and this IS its angle`
              : `its two fans want ${s.ceiling.toFixed(2)}° and ${s.wanted.toFixed(2)}°; ` +
                `this sits between them, bought by opening a lace to ` +
                `${(Math.max(s.innerWeft, s.innerWarp) / 46).toFixed(2)} widths inside`) +
            `\nloosest arm hangs ${s.slack.toFixed(2)} widths past the weave`;
          if (key === this.sceneSource) b.classList.add('browser-on');
          g2.appendChild(b);
        }
      }
      body.appendChild(g2);
    }

    // Columns only. A box stitch is not one round — one round is only where it
    // starts, and it is not what anyone is after. The twist family's grid offers
    // the worked column, so this one does too; a single-round grid alongside it
    // only invited someone to click a face and wonder why what opened was flat.
    // The single round is still reachable by key (box-<hand>-<m>x<n>) and is what
    // the drawn sheet behind the door below measures.
    body.appendChild(
      el(
        'h4',
        'browser-group',
        `Box family — every m×n face worked ${BOX_ROUNDS} rounds, both hands`,
      ),
    );
    body.appendChild(
      el(
        'p',
        'browser-note',
        `Each cell opens that face as a column of ${BOX_ROUNDS} rounds. The starting ` +
          'stitch is the twist family’s, closed instead of twisted: at k = 0 the pointer ' +
          'does not move, so every end pairs with the end straight opposite and each arm ' +
          'carries on along its own line. Every round after is that same move again — ' +
          'each arm folds at its own free end and ' +
          'runs back along its own line, the same distance past the weave as the round ' +
          'below, so the column rises straight and keeps the width it started with. Only ' +
          'the last round runs on — those are the ends you would tie off. What makes it ' +
          'the BOX stitch rather than the round one is that the over/unders flip every ' +
          'round: a ribbon over here now is under here next, so the pattern repeats with ' +
          `period two rather than every round. Cells quote the strand count at ${BOX_ROUNDS} ` +
          'rounds; the shading is how much more of the weave one ribbon does than another, ' +
          'all 64 crossings for a 1×8’s single warp against 8 for each of its wefts. To see ' +
          'a face drawn flat as one round instead — the starting stitch beside the box it ' +
          'closes into, every arm named, in both hands:',
      ),
    );
    const boxDoors = el('div', 'browser-doors');
    for (const d of BOX_DOORS) {
      const a = el('a', 'browser-door');
      a.href = d.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = d.title;
      a.appendChild(el('b', undefined, d.label));
      a.appendChild(el('small', undefined, d.note));
      boxDoors.appendChild(a);
    }
    body.appendChild(boxDoors);
    for (const { hand, label, sense } of HANDS) {
      body.appendChild(el('h5', 'browser-subgroup', `${label} — ${sense}`));
      const g4 = el('div', 'browser-grid');
      g4.style.gridTemplateColumns = `auto repeat(${BOX_MAX}, 1fr)`;
      g4.appendChild(el('span', 'browser-axis', ''));
      for (let n = 1; n <= BOX_MAX; n++) g4.appendChild(el('span', 'browser-axis', `n=${n}`));
      for (let m = 1; m <= BOX_MAX; m++) {
        g4.appendChild(el('span', 'browser-axis', `m=${m}`));
        for (let n = 1; n <= BOX_MAX; n++) {
          const s = BOX_FAMILY.find((x) => x.m === m && x.n === n)!;
          const c = column(s);
          const key = boxColumnKey(hand, m, n);
          const b = pill('', () => pick(key));
          b.classList.add('browser-cell');
          b.style.setProperty('--slack', String((s.load - 1) / (BOX_MAX - 1)));
          b.appendChild(el('b', undefined, `${m}×${n}`));
          b.appendChild(el('small', undefined, `${c.strands}`));
          b.appendChild(
            el('small', 'browser-slack', s.load === 1 ? 'even' : `${s.load.toFixed(1)}×`),
          );
          const most = 8 * Math.max(m, n);
          b.title =
            `${m}×${n} ${hand.toUpperCase()} — ${BOX_ROUNDS} rounds, ${c.strands} strands, ` +
            `${c.masks} masks, on a ${s.width}×${s.height} px footprint\n` +
            `bars ${2 * GAP * m + 60} px across and ${2 * GAP * n + 60} px down; ` +
            `angles are 0° / 180° / ±90°, always\n` +
            `every round folds POKE past the weave; only the last runs out to a loose end\n` +
            `the over/unders repeat with period two — that is what makes it a box, not a spiral\n` +
            (s.load === 1
              ? `every ribbon is in ${most} of the ${s.crossings} crossings — balanced`
              : `a ${Math.min(m, n) === m ? 'warp' : 'weft'} ribbon is in ${most} of the ` +
                `${s.crossings} crossings against ${8 * Math.min(m, n)} for the others — ` +
                `${s.load.toFixed(1)}× the load`) +
            `\none round alone is the key box-${hand}-${m}x${n}`;
          if (key === this.sceneSource) b.classList.add('browser-on');
          g4.appendChild(b);
        }
      }
      body.appendChild(g4);
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
        this.setScene(sceneFromFile(custom.scene, custom.scene.name), `open “${custom.scene.name}”`);
        return;
      } catch (e) {
        this.flash('That saved sample could not be opened: ' + (e as Error).message, true);
      }
    }
    const scene = makeSample(key);
    this.setScene(scene, `open “${scene.name}”`);
  }

  private saveSample(rawName: string): void {
    const name = rawName.trim();
    if (!name) return;
    const entry = saveCustom(this.scene, name);
    this.scene.name = name;
    this.namingOpen = false;
    if (!entry) {
      // Storage refused (sandboxed or private-mode view, or a full quota). Don't
      // pretend it saved — open the JSON so the work can still be kept. The name
      // did land on the scene, and the name is in the JSON, so it is a step.
      this.dataOpen = true;
      this.record(`name it “${name}”`);
      this.renderDock();
      this.flash('Could not save here — local storage is blocked. Copy the JSON instead.', true);
      return;
    }
    this.sceneSource = entry.id;
    this.record(`name it “${name}”`);
    // The save is what the naming field was opened for, so the card goes: the
    // toast below carries the name it went under. On a phone the card stays and
    // render() redraws it with the new name already in the dropdown.
    this.commitDock();
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
    this.apply('add a strand');
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

    // Masks are crossings rather than storeys: they have no ground and no order
    // worth reading, so their view is an ordinary list from the top down. The
    // stack proper is the one that hangs from the floor.
    host.classList.toggle('from-bottom', this.stackView === 'layers');
    if (this.stackView === 'masks') {
      host.appendChild(this.maskList());
      return;
    }

    const back = this.hiddenBanner();
    if (back) host.appendChild(back);

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
        this.apply('move a level up');
      });
      up.disabled = at >= this.scene.strands.length;
      controls.appendChild(up);

      const down = iconBtn('▼', 'Move down (lift one more layer)', () => {
        moveLevelBreak(this.scene, index, -1);
        this.apply('move a level down');
      });
      down.disabled = at <= 0;
      controls.appendChild(down);

      const del = iconBtn('✕', 'Remove this level', () => {
        removeLevelBreak(this.scene, index);
        this.apply('remove a level');
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

  /**
   * The masks side of the switch: one row per crossing, and nothing else.
   *
   * No card and no header — the switch has just said what these are, and the
   * dashed frame they used to sit in was only there to mark them off from the
   * stack they were sitting in. OSS appends a MaskedStrand to the end of the
   * strand list, which is the top of its layer panel; here they are a kind of
   * their own, so they keep their own order and their own view.
   */
  private maskList(): HTMLElement {
    const list = el('section', 'mask-list');
    list.setAttribute('aria-label', 'Mask layers');
    if (!this.scene.masks.length) {
      list.appendChild(
        el(
          'p',
          'empty',
          'No mask layers yet. Pick Weave in the toolbar, then click the strand that goes over ' +
            'and the one it goes under.',
        ),
      );
      return list;
    }
    this.scene.masks.forEach((m, i) => list.appendChild(this.maskRow(m, i)));
    return list;
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

  /**
   * How many layers are off, and the one press that brings them all back.
   *
   * It lives on the stack rather than in the inspector, and sticks to the top of
   * it, because `Hide others` hides the very rows you would have to find to undo
   * it by hand — two hundred of them on a twist — and the inspector that did it
   * can be closed with the scene still soloed. Undo reaches it too; this is the
   * way back that does not depend on the press being the last thing you did.
   */
  private hiddenBanner(): HTMLElement | null {
    const hidden = this.scene.strands.filter((s) => !s.isMask && !s.visible);
    if (hidden.length === 0) return null;

    const box = el('div', 'hidden-banner');
    box.appendChild(
      el('b', undefined, `${hidden.length} ${hidden.length === 1 ? 'layer' : 'layers'} hidden`),
    );
    const show = pill(
      'Show all',
      () => {
        for (const s of hidden) s.visible = true;
        this.apply('show every layer');
      },
      'Bring every hidden layer back',
    );
    show.classList.add('coral');
    box.appendChild(show);
    return box;
  }

  private layerRow(index: number): HTMLElement {
    const strand = this.scene.strands[index];
    const selected = strand.id === this.selectedId;
    // `off` dims the whole row. One hidden layer reads well enough as a hollow
    // dot; two hundred of them, after a solo, have to be legible as a block —
    // which is the difference between a stack you can scan and a column of rows
    // whose state is in a 10px glyph at the far end of each one.
    const row = el(
      'div',
      'row' +
        (selected ? ' sel' : '') +
        (strand.isMask ? ' row-mask' : '') +
        (!strand.isMask && !strand.visible ? ' off' : ''),
    );

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
        this.apply(strand.visible ? 'show a strand' : 'hide a strand');
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
      chip.addEventListener('click', () => this.paint(strand, c));
      chips.appendChild(chip);
    }
    // The palette is six laces; anything else comes out of the picker, which is
    // also how a colour read off a file gets edited rather than replaced. Drawn
    // as a wheel rather than as a swatch of the current colour: the six beside it
    // are colours, and this one is the door to all the rest.
    const custom = el('button', 'chip wheel') as HTMLButtonElement;
    custom.type = 'button';
    custom.title = 'Any colour…';
    custom.setAttribute('aria-label', 'Choose any colour');
    custom.setAttribute('aria-haspopup', 'dialog');
    // Lit when the strand is wearing something the six chips cannot show, so the
    // row always says where its colour came from.
    if (!PALETTE.some((c) => hex(c) === hex(strand.color))) custom.classList.add('on');
    custom.addEventListener('click', () => this.openColourPicker(strand));
    chips.appendChild(custom);
    colours.appendChild(chips);
    box.appendChild(colours);

    const scope = this.scopeRow(strand);
    if (scope) box.appendChild(scope);

    box.appendChild(
      slider('Width', strand.width, 6, 140, 1, (v) => {
        strand.width = v;
        // Tagged: a drag arrives as a run of `input` events, and the whole run is
        // one step rather than one per pixel the handle travelled.
        this.apply('change a strand’s width', `width:${strand.id}`);
      }),
    );

    // A hairline between what this layer LOOKS like and what to DO with it. The
    // three action rows below carry a reach each, and without the rule they read
    // as three more properties of the strand.
    box.appendChild(el('div', 'insp-split'));
    for (const row of this.actionRows(strand)) box.appendChild(row);
    box.appendChild(el('div', 'insp-split'));

    const acts = el('div', 'pill-row');

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
      this.apply('delete a strand');
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
   * The four things you can do to a layer, one per row, each with a reach.
   *
   * They were two pills sharing a row with the bin, and both acted on the one
   * open layer always — so colouring a lace whole was a press and hiding it was
   * one press per length. A row each buys them the switch the colour chips
   * already had, and the room for two more: **Show**, which is Hide's own verb
   * standing on its own so a part-hidden set has a press that finishes the job,
   * and **Hide others**, which reads the same switch the other way round, as
   * what to KEEP.
   *
   * Every pill says what it will do at the reach shown beside it, and a pill
   * with nothing left to do is disabled and says why — so a row can be read
   * before it is pressed rather than after.
   */
  private actionRows(strand: Strand3D): HTMLElement[] {
    const mates = setMembers(this.scene, strand.id);
    const set = setOf(strand.id);
    // Masks are not layers you can hide — they are a crossing between two of
    // them — so they are never a target and never counted.
    const layers = this.scene.strands.filter((s) => !s.isMask);
    const rows: HTMLElement[] = [];

    const row = (
      key: ReachKey,
      label: string,
      titles: [string, string],
      act: () => void,
      disabled?: string,
    ): void => {
      const line = el('div', 'insp-row act-row');
      const reach = this.reachOf(strand, key);
      const b = pill(label, act, disabled ?? titles[reach === 'set' ? 1 : 0]);
      b.disabled = disabled !== undefined;
      line.appendChild(b);
      const toggle = this.reachToggle(key, titles, mates.length > 1);
      if (toggle) line.appendChild(toggle);
      rows.push(line);
    };

    // ---- Straighten ---------------------------------------------------------
    const bendable = this.reachTargets(strand, 'straighten');
    const atDefault = bendable.every((s) => controlsAtDefault(s));
    row(
      'straighten',
      'Straighten',
      [
        `Reset control points (straighten ${strand.id})`,
        `Straighten the whole set — all ${mates.length} layers of ${set}_x`,
      ],
      () => {
        for (const s of bendable) resetControlPoints(s);
        this.apply(bendable.length > 1 ? `straighten set ${set}` : 'straighten a strand');
      },
      atDefault
        ? bendable.length > 1
          ? 'Every layer of this set is already straight'
          : 'Control points are already at their default'
        : undefined,
    );

    // ---- Hide, and Show ------------------------------------------------------
    // Two rows rather than one pill that changes its word, because a set is not
    // all one thing: hide the whole of 3_x, bring one length back to look at it,
    // and a toggle reads "Hide" again — the only reading left once anything is
    // showing — so the twenty-two still gone had no press that would return
    // them. Split, each verb always does what it says: Hide hides, Show shows,
    // and whichever has nothing left to do says so and goes quiet.
    //
    // They share ONE reach between them, and it is the pair's, not each row's.
    // Two switches that could disagree is a trap with only one way to fall:
    // hiding a lace whole and then reaching for Show, which would be sitting on
    // This layer and hand back one length of the twenty-three.
    const targets = this.reachTargets(strand, 'hide');
    const shown = targets.filter((s) => s.visible).length;
    const whole = targets.length > 1 ? `the whole set — all ${targets.length} layers of ${set}_x` : '';
    row(
      'hide',
      'Hide',
      [`Hide ${strand.id}`, `Hide ${whole}`],
      () => {
        for (const s of targets) s.visible = false;
        this.apply(targets.length > 1 ? `hide set ${set}` : 'hide a strand');
      },
      shown === 0
        ? targets.length > 1
          ? 'Every layer of this set is already hidden'
          : 'This layer is already hidden'
        : undefined,
    );
    row(
      'hide',
      'Show',
      [`Show ${strand.id}`, `Show ${whole}`],
      () => {
        for (const s of targets) s.visible = true;
        this.apply(targets.length > 1 ? `show set ${set}` : 'show a strand');
      },
      shown === targets.length
        ? targets.length > 1
          ? 'Every layer of this set is already showing'
          : 'This layer is already showing'
        : undefined,
    );

    // ---- Hide others --------------------------------------------------------
    // The solo. On a woven mat this is the only way to look at one lace, and on
    // a 230-layer twist it is 207 rows in a press — so the stack grows a way
    // back (see `hiddenBanner`) the moment anything is off.
    const keep = new Set(this.reachTargets(strand, 'others'));
    const doomed = layers.filter((s) => !keep.has(s) && s.visible);
    const raising = [...keep].filter((s) => !s.visible).length;
    row(
      'others',
      'Hide others',
      [
        `Hide every layer except ${strand.id} — ${layers.length - 1} of them`,
        `Hide every layer except the ${mates.length} of ${set}_x — ` +
          `${layers.length - mates.length} of them`,
      ],
      () => {
        for (const s of layers) s.visible = keep.has(s);
        this.apply('hide the other layers');
      },
      doomed.length === 0 && raising === 0
        ? 'Nothing else is showing — this layer is already the only one'
        : undefined,
    );

    return rows;
  }

  /**
   * How far each action reaches: this layer alone, or its whole set.
   *
   * The choice is the panel's, not the strand's — it is how you are working, so
   * it stays put as you move down the stack rather than resetting on every row —
   * and it is remembered between visits, like the theme.
   */
  private reaches: Reaches = loadReaches();

  /**
   * The reach an action would actually use on this strand.
   *
   * A layer with no set of its own — a hand-named `s7`, or the only length of
   * its lace — has one reach whatever the switch says, and its row is drawn
   * without a switch at all (see `reachToggle`). Asking here rather than at each
   * call site keeps the two from ever disagreeing.
   */
  private reachOf(strand: Strand3D, key: ReachKey): Scope {
    return setMembers(this.scene, strand.id).length > 1 ? this.reaches[key] : 'layer';
  }

  /** The layers an action would land on: this one, or every length of its lace. */
  private reachTargets(strand: Strand3D, key: ReachKey): Strand3D[] {
    return this.reachOf(strand, key) === 'set' ? setMembers(this.scene, strand.id) : [strand];
  }

  /**
   * Spend a colour under the current scope, and name the edit for what it did.
   *
   * Untagged, unlike the width slider: every colour that reaches here is now one
   * deliberate press — a chip, or an OK — and two of them are two edits. The tag
   * was here for the old live well, which streamed a colour per pixel of a drag
   * and needed the whole run folded into one step; it also quietly folded two
   * chip presses into one, so undo after picking gold and then teal landed on
   * neither. The picker holds its own drag now, and spends nothing until OK.
   */
  private paint(strand: Strand3D, colour: RGBA): void {
    const n = recolour(this.scene, strand.id, colour, this.reachOf(strand, 'colour'));
    const set = setOf(strand.id);
    this.apply(n > 1 ? `recolour set ${set}` : 'recolour a strand');
  }

  /**
   * The picker window: every colour there is, and none of them spent until OK.
   *
   * A chip paints on the press, which is right for six known laces. Hunting for a
   * colour is a different act — it is a drag across a whole square of them — and
   * done live that put a hundred colours through the scene on the way to the one
   * you wanted. So this is a window with a decision at the end: OK spends the
   * colour under the current scope, Cancel and Escape spend nothing, and the
   * scene is untouched the whole time it is open.
   */
  private openColourPicker(strand: Strand3D): void {
    const before = strand.color;
    let hsv = rgbToHsv(before);

    const back = el('div', 'picker-back');
    const close = (): void => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const commit = (): void => {
      close();
      this.paint(strand, hsvToRgba(hsv, before.a));
    };
    // Capture, so the window answers Escape and Enter before the app's own
    // shortcuts see them: while this is open it is the only thing on screen.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        commit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });

    const box = el('div', 'picker');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Pick a colour');
    const head = el('div', 'picker-head');
    head.appendChild(el('h3', undefined, 'Colour'));
    box.appendChild(head);
    // Where the OK will land — the scope switch is in the row behind this window,
    // and a whole-lace repaint is not something to discover afterwards.
    const mates = setMembers(this.scene, strand.id).length;
    head.appendChild(
      el(
        'span',
        'picker-note',
        this.reachOf(strand, 'colour') === 'set'
          ? `all ${mates} layers of ${setOf(strand.id)}_x`
          : strand.id,
      ),
    );

    // Saturation across, value down, at the hue the strip below is holding.
    const sv = el('div', 'picker-sv');
    sv.tabIndex = 0;
    sv.setAttribute('role', 'group');
    sv.setAttribute('aria-label', 'Saturation and brightness — arrow keys to move');
    const svDot = el('i', 'picker-dot');
    sv.appendChild(svDot);
    box.appendChild(sv);

    const hue = el('div', 'picker-hue');
    hue.tabIndex = 0;
    hue.setAttribute('role', 'slider');
    hue.setAttribute('aria-label', 'Hue');
    hue.setAttribute('aria-valuemin', '0');
    hue.setAttribute('aria-valuemax', '360');
    const hueDot = el('i', 'picker-dot');
    hue.appendChild(hueDot);
    box.appendChild(hue);

    const foot = el('div', 'picker-foot');
    const swatch = el('span', 'picker-swatch');
    const field = el('input', 'picker-hex') as HTMLInputElement;
    field.type = 'text';
    field.spellcheck = false;
    field.maxLength = 7;
    field.setAttribute('aria-label', 'Hex colour');
    foot.append(swatch, field);
    box.appendChild(foot);

    const draw = (typing = false): void => {
      const c = hsvToRgba(hsv, before.a);
      const h = hex(c);
      sv.style.setProperty('--hue', String(Math.round(hsv.h)));
      svDot.style.left = `${hsv.s * 100}%`;
      svDot.style.top = `${(1 - hsv.v) * 100}%`;
      svDot.style.background = h;
      hueDot.style.left = `${(hsv.h / 360) * 100}%`;
      hueDot.style.background = `hsl(${hsv.h} 100% 50%)`;
      hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
      swatch.style.background = h;
      // Not while it is being typed in: rewriting the field under the caret turns
      // a half-finished `#ff5` into something you did not type.
      if (!typing) field.value = h;
    };

    // One drag handler for both fields: press anywhere to jump there, and keep
    // reading until the finger lifts — captured, so a drag off the edge of the
    // square still tracks instead of stopping at the border.
    const track = (host: HTMLElement, at: (x: number, y: number) => void): void => {
      const read = (e: PointerEvent): void => {
        const r = host.getBoundingClientRect();
        at(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
        draw();
      };
      host.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        host.focus();
        host.setPointerCapture(e.pointerId);
        read(e);
      });
      host.addEventListener('pointermove', (e) => {
        if (host.hasPointerCapture(e.pointerId)) read(e);
      });
      host.addEventListener('pointerup', (e) => {
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      });
    };
    track(sv, (x, y) => {
      hsv = { ...hsv, s: x, v: 1 - y };
    });
    track(hue, (x) => {
      hsv = { ...hsv, h: x * 360 };
    });

    // The keyboard reaches the same two fields. Shift is the coarse step, as on a
    // range input.
    sv.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 0.1 : 0.02;
      const x = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0;
      const y = e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0;
      if (!x && !y) return;
      e.preventDefault();
      hsv = { ...hsv, s: clamp01(hsv.s + x), v: clamp01(hsv.v + y) };
      draw();
    });
    hue.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 20 : 4;
      const x = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0;
      if (!x) return;
      e.preventDefault();
      hsv = { ...hsv, h: (hsv.h + x + 360) % 360 };
      draw();
    });

    field.addEventListener('input', () => {
      const text = field.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(text)) return;
      hsv = rgbToHsv(rgbaFromHex(text, before.a));
      draw(true);
    });
    // Whatever it was left as, the field goes back to saying what the window holds.
    field.addEventListener('blur', () => draw());

    const acts = el('div', 'pill-row picker-acts');
    const cancel = pill('Cancel', close, 'Close without changing the colour');
    cancel.classList.add('ghost');
    const ok = pill('OK', commit, 'Apply this colour');
    ok.classList.add('coral');
    acts.append(cancel, ok);
    box.appendChild(acts);

    draw();
    back.appendChild(box);
    document.body.appendChild(back);
    sv.focus();
  }

  /**
   * The colour reach, drawn under the palette — and only when there is a choice
   * to make. A strand whose name is outside the `N_M` convention has no set, and
   * one that is the only length of its own has a set of one: either way both
   * halves would do the same thing, so the row stays away.
   *
   * It keeps a row and a label of its own where the three action rows carry
   * their verb instead, because the chips above are its button: there is nothing
   * on the row itself to press.
   */
  private scopeRow(strand: Strand3D): HTMLElement | null {
    const set = setOf(strand.id);
    const mates = setMembers(this.scene, strand.id);
    const toggle = this.reachToggle(
      'colour',
      [
        `Colour ${strand.id} alone`,
        `Colour the whole set — all ${mates.length} layers of ${set}_x, this one included`,
      ],
      mates.length > 1,
    );
    if (!toggle) return null;

    const row = el('div', 'insp-row');
    row.appendChild(el('span', 'insp-label', 'Applies to'));
    row.appendChild(toggle);
    return row;
  }

  /**
   * One reach switch: `This layer | All layers`, for whichever action asked.
   *
   * `null` when the strand has no set to spread to, which is what keeps the
   * switch off a row where both halves would do the same thing — and off every
   * row of a scene of hand-named strands, where none of them has one.
   */
  private reachToggle(
    key: ReachKey,
    titles: [string, string],
    offer: boolean,
  ): HTMLElement | null {
    if (!offer) return null;

    const group = el('span', 'scope-toggle');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'How far this reaches');

    const choice = (scope: Scope, label: string, title: string): void => {
      const b = el('button', 'scope-btn', label) as HTMLButtonElement;
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-pressed', String(this.reaches[key] === scope));
      b.addEventListener('click', () => {
        if (this.reaches[key] === scope) return;
        this.reaches[key] = scope;
        saveReaches(this.reaches);
        // No scene edit here: a reach is what the NEXT press will do, so this
        // redraws the panel — the verbs and their tooltips change with it — and
        // stays out of the history.
        this.renderStack();
      });
      group.appendChild(b);
    };

    // "All layers" rather than the set's own name and count: `7_x · 23` is the
    // exact truth, and it reads as a layer id — the one thing on this row that is
    // NOT a place to press. The count belongs in the tooltip, where a number is
    // read once out of curiosity instead of parsed on every glance.
    choice('layer', 'This layer', titles[0]);
    choice('set', 'All layers', titles[1]);
    return group;
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
      this.apply('move a layer past a level');
      return;
    }
    const j = index + dir;
    if (j < 0 || j >= this.scene.strands.length) return;
    const arr = this.scene.strands;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    this.apply(dir === 1 ? 'move a layer up' : 'move a layer down');
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
    'Undo',
    'Every edit that changes the scene is recorded: the <b>↩ ↪</b> pair on the toolbar steps ' +
      'back and forward through them, and so do <b>⌘/Ctrl+Z</b> and <b>⇧⌘/Ctrl+Shift+Z</b>. The ' +
      'camera is not an edit — orbiting, panning, zooming and <b>Fit</b> change nothing in the ' +
      'scene, so they are never recorded and undo leaves you looking from wherever you got to.',
  ],
  [
    'The camera',
    'With a mouse: <b>drag</b> to orbit · <b>scroll</b> to zoom · <b>right-drag</b> to pan. On a ' +
      'touch screen, where there is no wheel and no right button: <b>one finger</b> orbits · ' +
      '<b>pinch</b> zooms · <b>two fingers</b> pan. <b>Pan</b> and <b>Orbit</b> in the toolbar put ' +
      'the same two on a plain drag, so either is reachable one-handed.',
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
    'Colour',
    'The six chips paint on the press; the <b>wheel</b> beside them opens a picker window, ' +
      'where any colour at all is reachable and nothing lands until you press <b>OK</b>. ' +
      'A layer name is <b>set_length</b>: <b>1_2</b> is the second length of lace <b>1</b>. So a ' +
      'picked colour has two places to land, and the switch under the palette says which: ' +
      '<b>This layer</b> paints <b>1_2</b> alone, <b>All layers</b> paints every length of that ' +
      'lace at once. Either way it is one press of undo. The choice is remembered, and it is ' +
      'offered only where it means something — a lace with one length has nothing to spread to.',
  ],
  [
    'Hiding, and how far a press reaches',
    'Every action in a row’s controls carries that same <b>This layer / All layers</b> switch, ' +
      'and each remembers its own: you can be colouring a lace whole while straightening one ' +
      'length of it. <b>Hide</b> and <b>Show</b> are a row each and share one switch between ' +
      'them, so a lace hidden whole comes back whole. Hide takes a layer out of the picture and ' +
      'leaves it in the stack, ' +
      'dimmed — its crossings stay, so the strands it ran under keep their over and under. ' +
      '<b>Hide others</b> reads the switch the other way round, as what to <i>keep</i>: it hides ' +
      'everything that is not this layer, or everything that is not its lace, which is how you ' +
      'look at one lace of a stitch on its own. Nothing is deleted by any of it — while anything ' +
      'is hidden the stack carries a <b>Show all</b> at the top, and undo reaches it too.',
  ],
  [
    'Masks',
    'Click the strand that goes <b>over</b>, then the one it goes under: they interlock at their ' +
      'crossing, which is the 3D version of an OpenStrand mask. Hovering lights <b>one layer</b>, ' +
      'not the whole arm family, and names it — so on a stitch you can see exactly which of its ' +
      'strands you are about to mask. With no mask on a crossing, the higher layer wins. The ' +
      'crossings you have made are a view of their own: the switch at the top of the panel puts ' +
      '<b>Masks</b> in place of the stack.',
  ],
  [
    'The stack',
    'The panel is the scene’s layers, and it reads <b>top = front</b>: the row at the top of ' +
      'the stack is the one nearest you. It is built the other way up — level <b>0</b> is the ' +
      'ground, so the stack hangs from the floor of the panel, where the ground belongs.',
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

// ---- the reaches -----------------------------------------------------------
// Layer or set (see model/colour.ts), one per action that has a reach: the
// colour chips, Straighten, Hide, and Hide others. Remembered for the same
// reason the theme is — it is a way of working rather than a property of a
// scene, so it belongs to the person and not to the file, and someone working
// lace by lace should not have to say so again on every strand or after every
// refresh.
//
// One per action rather than one for the panel because they are genuinely
// independent: fixing the bend in a single length of a lace you are colouring
// whole is an ordinary thing to be doing.

/**
 * The actions that carry a reach of their own.
 *
 * `hide` is shared by the Hide row and the Show row: they are one axis worked
 * from either end, and two switches that could disagree only ever fall one way
 * — hide a lace whole, reach for Show, and get back one length of twenty-three.
 */
type ReachKey = 'colour' | 'straighten' | 'hide' | 'others';

const REACH_KEYS: ReachKey[] = ['colour', 'straighten', 'hide', 'others'];
const REACH_STORE = 'scoubidou3d-reaches';
// What colour's reach was stored under when it was the only one. Read once, so
// that a returning user's choice survives the change instead of silently
// resetting to This layer.
const LEGACY_COLOUR_KEY = 'scoubidou3d-colour-scope';

type Reaches = Record<ReachKey, Scope>;

function loadReaches(): Reaches {
  const out = { colour: 'layer', straighten: 'layer', hide: 'layer', others: 'layer' } as Reaches;
  try {
    if (localStorage.getItem(LEGACY_COLOUR_KEY) === 'set') out.colour = 'set';
    const raw = localStorage.getItem(REACH_STORE);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
      for (const k of REACH_KEYS) if (saved[k] === 'set') out[k] = 'set';
    }
  } catch {
    // A sandboxed frame can refuse storage, and a hand-edited value can refuse
    // to parse; the layer is the safer default anyway, being the smaller of the
    // two edits in every case — and, for Hide others, by two hundred rows.
  }
  return out;
}

function saveReaches(reaches: Reaches): void {
  try {
    localStorage.setItem(REACH_STORE, JSON.stringify(reaches));
  } catch {
    // Not fatal: the choice still holds for this session.
  }
}

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

// The brand mark, as on the project site and in the browser tab: a three-round
// box stitch, rendered by this very app (scripts/icon-shot.mjs) and cut out of
// its paper. BASE_URL rather than a relative path — the icon sits at the root of
// the site while this page is served from /app/, and the root moves when the
// build is based somewhere else.
const MARK =
  `<img class="mark" src="${import.meta.env.BASE_URL}icon-192.png" alt="" aria-hidden="true" />`;

// The stacked-layers mark used by the "Level" button and by the level badges: a
// slab seen edge-on with a second one showing beneath it — one storey above
// another, which is exactly what a level is.
const LAYERS_ICON = svg(
  '<path d="M12 3 22 9.2 12 15.4 2 9.2Z" />' +
    '<path d="M12 17.7 3.7 12.5 2 13.6 12 19.8 22 13.6 20.3 12.5Z" />',
);

// The masks side of the stack bar's switch: one band whole, the other broken
// behind it — the same thing the Weave tool's mark says, stood upright. The
// tool's own mark is drawn on the diagonal for a 24px button and shrinks to a
// bare ✕ beside a label, which is why this one is not simply that one reused.
const MASK_ICON = svg(
  '<rect x="9.7" y="0.6" width="4.6" height="6.6" rx="2.3" />' +
    '<rect x="9.7" y="16.8" width="4.6" height="6.6" rx="2.3" />' +
    '<rect x="0.6" y="9.7" width="22.8" height="4.6" rx="2.3" />',
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

// Undo, and redo as its mirror image so the pair is exactly symmetrical: a flat
// arrowhead pointing back, and the band it came along hooking round and under.
// Two subpaths rather than one — the head is solid, the hook is a band with a
// hole, and keeping them apart means neither has to wind around the other.
const UNDO_ARROW =
  '<path d="M8.6 3.4 1.5 9.9l7.1 6.5Z" />' +
  '<path d="M8 8.4h4.6a6.4 6.4 0 0 1 0 12.8H8.8v-3h3.8a3.4 3.4 0 0 0 0-6.8H8Z" />';

const UNDO_ICON = svg(UNDO_ARROW);
// Mirrored about the middle of the 24-box, so redo is undo seen the other way.
const REDO_ICON = svg(`<g transform="translate(24 0) scale(-1 1)">${UNDO_ARROW}</g>`);

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

/** A toolbar button that DOES something rather than arming a mode: the undo pair.
 *  Icon only — they carry no label because nothing about ↩ needs one, and the
 *  strip already holds five named tools. */
function actBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'tool-btn tool-act') as HTMLButtonElement;
  b.type = 'button';
  b.innerHTML = icon;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/** Fields the browser gives an undo of its own — the JSON paste box, the name
 *  field, the picker's hex box. A range is not one of them: Ctrl+Z with a slider
 *  focused means the scene. */
const TYPED_INPUTS = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel']);

function isTypingIn(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TYPED_INPUTS.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
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
