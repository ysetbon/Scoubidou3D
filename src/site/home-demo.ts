import { StrandScene } from "../scene/StrandScene";
import { twistStitchMN } from "../model/samples";
import type { Strand3D } from "../model/types";

export function mountDemo(root: HTMLElement) {
  const get = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const canvas = get<HTMLCanvasElement>("[data-demo-canvas]");
  const view = new StrandScene(canvas);
  const layerList = get("[data-demo-layers]");
  const slider = get<HTMLInputElement>("#demo-level");
  const play = get<HTMLButtonElement>("[data-demo-play]");
  const help = get("[data-demo-help]");
  const status = get("[data-demo-status]");
  const modes = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-demo-mode]"),
  ];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let level = 0;
  let playing = false;
  let visible = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let newId = 0;
  let selected: string | null = null;
  const theme = () =>
    view.setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  theme();
  new MutationObserver(theme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  view.setParams({ showNames: false });
  get("[data-demo-loading]").hidden = true;
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")
    .forEach((el) => (el.disabled = false));

  function layers() {
    const scene = view.getScene();
    layerList.replaceChildren();
    get("[data-demo-count]").textContent = `${scene.strands.length} strands`;
    const starts = [0, ...scene.levelBreaks];
    for (let group = starts.length - 1; group >= 0; group--) {
      const details = document.createElement("details");
      details.open = group === starts.length - 1;
      const summary = document.createElement("summary");
      summary.textContent = group === 0 ? "Starting stitch" : `Level ${group}`;
      details.append(summary);
      for (const strand of scene.strands
        .slice(starts[group], starts[group + 1] ?? scene.strands.length)
        .reverse()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "strand-row";
        button.setAttribute("aria-pressed", String(selected === strand.id));
        const dot = document.createElement("i");
        dot.style.background = `rgb(${strand.color.r},${strand.color.g},${strand.color.b})`;
        const label = document.createElement("span");
        label.textContent = strand.id;
        button.append(dot, label);
        button.addEventListener("click", () => {
          pause();
          selected = strand.id;
          view.selectStrand(strand.id);
          layerList
            .querySelectorAll("button")
            .forEach((row) =>
              row.setAttribute("aria-pressed", String(row === button)),
            );
          status.textContent = `Selected ${strand.id}`;
        });
        details.append(button);
      }
      layerList.append(details);
    }
  }
  function mode(name: string) {
    view.disarmDraw();
    modes.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.demoMode === name),
      ),
    );
    if (name === "create") {
      view.setMode("orbit");
      view.topView();
      const template = structuredClone(view.getScene().strands[0]);
      view.armDraw(
        (at) =>
          ({
            ...structuredClone(template),
            id: `demo${++newId}_1`,
            start: { ...at },
            end: { ...at },
            control_points: [{ ...at }, { ...at }],
            control_point_center: null,
            parentId: null,
            parentSide: null,
            hasCircles: [false, false],
            triangleHasMoved: false,
            cp2Activated: false,
          }) as Strand3D,
        (drawn) => {
          layers();
          if (drawn) {
            mode("move");
            status.textContent = "New strand created";
          }
        },
      );
      help.textContent =
        "Create: drag on an empty area of the canvas to draw a new strand.";
    } else {
      view.setMode(name as "orbit" | "move" | "attach" | "weave");
      if (name !== "orbit") view.topView();
      help.textContent =
        name === "move"
          ? "Move: drag an endpoint or control handle to reshape a strand."
          : name === "attach"
            ? "Attach: drag from a free endpoint to grow a connected strand."
            : name === "weave"
              ? "Weave: click the strand that goes over, then the strand that goes under. Click the first strand again to cancel."
              : "Orbit: drag to rotate, scroll to zoom. Play builds the example again; Reset restores it.";
    }
  }
  function show(next: number) {
    level = next;
    selected = null;
    mode("orbit");
    view.setScene(twistStitchMN(1, 1, level, "1×1 twist preview"));
    slider.value = String(level);
    get("[data-demo-level]").textContent = String(level);
    status.textContent =
      level === 0 ? "Starting stitch" : `Level ${level} · next 45° turn`;
    layers();
  }
  function updateTimer() {
    clearInterval(timer);
    view.controls.autoRotate =
      playing && visible && !document.hidden && !reduced.matches;
    view.controls.autoRotateSpeed = 0.5;
    if (playing && visible && !document.hidden)
      timer = setInterval(() => {
        if (level === 6) {
          pause();
          status.textContent = "Six levels complete — replay or try the tools";
        } else show(level + 1);
      }, 2400);
  }
  function pause() {
    playing = false;
    play.textContent = "Play build";
    updateTimer();
  }
  function run() {
    // Always restore generated geometry before resuming, so edits cannot leak into the guided build.
    show(level === 6 ? 0 : level);
    playing = true;
    play.textContent = "Pause build";
    updateTimer();
  }
  play.addEventListener("click", () => (playing ? pause() : run()));
  slider.addEventListener("input", () => {
    pause();
    show(Number(slider.value));
  });
  modes.forEach((button) =>
    button.addEventListener("click", () => {
      pause();
      mode(button.dataset.demoMode!);
    }),
  );
  get("[data-demo-top]").addEventListener("click", () => {
    pause();
    view.topView();
  });
  get("[data-demo-reset]").addEventListener("click", () => {
    pause();
    show(0);
  });
  canvas.addEventListener("pointerdown", pause);
  view.onSceneChanged = (committed) => {
    if (committed) {
      layers();
      status.textContent = "Your edit · Reset to restore the example";
    }
  };
  document.addEventListener("visibilitychange", updateTimer);
  reduced.addEventListener("change", () => {
    if (reduced.matches) pause();
  });
  show(0);
  if ("IntersectionObserver" in window) {
    let started = false;
    new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (visible && !started) {
          started = true;
          if (!reduced.matches) run();
        }
        updateTimer();
      },
      { threshold: 0.15 },
    ).observe(root);
  } else {
    visible = true;
    if (!reduced.matches) run();
  }
}
