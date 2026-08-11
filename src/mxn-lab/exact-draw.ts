// The exact-stage renderer, on its own so more than one panel can draw a ring.
//
// Lived inside weave-studio.tsx until the trace panel needed to draw a weave
// too — importing it from there would have made the studio and the panel each
// other's dependency, since the studio already imports the panel.
export type Point = { x: number; y: number };
export type RGBA = { r: number; g: number; b: number; a?: number };
export type Strand = {
  type: "Strand" | "AttachedStrand" | "MaskedStrand";
  start: Point;
  end: Point;
  width: number;
  color: RGBA;
  stroke_color: RGBA;
  stroke_width: number;
  has_circles?: [boolean, boolean];
  start_line_visible?: boolean;
  end_line_visible?: boolean;
  layer_name: string;
  first_selected_strand?: string;
  second_selected_strand?: string;
  is_hidden?: boolean;
};
export type Stage = { level: number; k: number | null; label: string; strands: Strand[] };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function cssColor(color: RGBA | undefined, fallback = "#ffffff") {
  if (!color) return fallback;
  return `rgba(${color.r},${color.g},${color.b},${(color.a ?? 255) / 255})`;
}

export function allBounds(stages: Stage[]): Bounds {
  const finalStage = stages.at(-1);
  const points = (finalStage?.strands ?? [])
    .filter(strand => strand.type !== "MaskedStrand" && !strand.is_hidden)
    .flatMap(strand => [strand.start, strand.end]);
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map(p => p.x)) - 80,
    minY: Math.min(...points.map(p => p.y)) - 80,
    maxX: Math.max(...points.map(p => p.x)) + 80,
    maxY: Math.max(...points.map(p => p.y)) + 80,
  };
}

function layerLevel(layerName: string) {
  const suffix = Number.parseInt(layerName.slice(layerName.lastIndexOf("_") + 1), 10);
  if (!Number.isFinite(suffix) || suffix <= 3) return 0;
  return Math.floor((suffix - 2) / 2);
}

function strandLevel(strand: Strand) {
  if (strand.type !== "MaskedStrand") return layerLevel(strand.layer_name);
  return Math.max(
    layerLevel(strand.first_selected_strand ?? ""),
    layerLevel(strand.second_selected_strand ?? ""),
  );
}

function bandPolygon(start: Point, end: Point, width: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length * width / 2;
  const ny = dx / length * width / 2;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

export function drawExactStage(canvas: HTMLCanvasElement, stage: Stage, bounds: Bounds, showLabels = true, fixedSize?: number, background = "#f2f2f7") {
  const rect = canvas.getBoundingClientRect();
  const dpr = fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const width = fixedSize ?? Math.max(1, rect.width);
  const height = fixedSize ?? Math.max(1, rect.height);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const pad = 8;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  // ResizeObserver can fire while a card is between layouts and report a
  // width/height smaller than the padding. Keep the transform positive so
  // endpoint circles never receive a negative canvas radius.
  const usableWidth = Math.max(1, width - pad * 2);
  const usableHeight = Math.max(1, height - pad * 2);
  const scale = Math.max(0.001, Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight));
  const offsetX = (width - sourceWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - sourceHeight * scale) / 2 - bounds.minY * scale;
  const point = (p: Point): Point => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

  const regular = stage.strands.filter(s => s.type !== "MaskedStrand" && !s.is_hidden);
  const byName = new Map(regular.map(s => [s.layer_name, s]));

  const strokeSegment = (start: Point, end: Point, color: string, lineWidth: number, cap: CanvasLineCap = "butt") => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, lineWidth);
    ctx.lineCap = cap;
    ctx.stroke();
  };

  const addStrandShape = (target: CanvasRenderingContext2D, strand: Strand, shapeWidth: number) => {
    const start = point(strand.start);
    const end = point(strand.end);
    const polygon = bandPolygon(start, end, shapeWidth);
    target.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach(vertex => target.lineTo(vertex.x, vertex.y));
    target.closePath();
    const radius = shapeWidth / 2;
    if (strand.has_circles?.[0]) {
      target.moveTo(start.x + radius, start.y);
      target.arc(start.x, start.y, radius, 0, Math.PI * 2, true);
    }
    if (strand.has_circles?.[1]) {
      target.moveTo(end.x + radius, end.y);
      target.arc(end.x, end.y, radius, 0, Math.PI * 2, true);
    }
  };

  // OpenStrandStudio paints one combined path for the body and caps. That
  // removes the antialiased join left by separately painting circles/lines.
  const drawStrandBody = (strand: Strand) => {
    const body = strand.width * scale;
    const outline = Math.max(1.25, strand.stroke_width * scale);
    ctx.beginPath();
    addStrandShape(ctx, strand, body + outline * 2);
    ctx.fillStyle = cssColor(strand.stroke_color, "#000000");
    ctx.fill();
    ctx.beginPath();
    addStrandShape(ctx, strand, body);
    ctx.fillStyle = cssColor(strand.color);
    ctx.fill();

    // OpenStrandStudio paints flat side-lines after the combined body path.
    // A regular Strand can show both; an AttachedStrand only shows its free
    // end. Circle endpoints suppress the corresponding side-line.
    const start = point(strand.start);
    const end = point(strand.end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const halfTotalWidth = (strand.width + strand.stroke_width * 2) * scale / 2;
    const outwardShift = strand.stroke_width * scale / 2;
    const drawSideLine = (anchor: Point, direction: -1 | 1) => {
      const center = {
        x: anchor.x + ux * outwardShift * direction,
        y: anchor.y + uy * outwardShift * direction,
      };
      strokeSegment(
        { x: center.x - px * halfTotalWidth, y: center.y - py * halfTotalWidth },
        { x: center.x + px * halfTotalWidth, y: center.y + py * halfTotalWidth },
        cssColor(strand.stroke_color, "#000000"),
        strand.stroke_width * scale,
        "butt",
      );
    };

    if (strand.type === "Strand" && (strand.start_line_visible ?? true) && !strand.has_circles?.[0]) {
      drawSideLine(start, -1);
    }
    if ((strand.end_line_visible ?? true) && !strand.has_circles?.[1]) {
      drawSideLine(end, 1);
    }
  };

  const scratch = document.createElement("canvas");
  scratch.width = pixelWidth;
  scratch.height = pixelHeight;
  const scratchContext = scratch.getContext("2d");

  const paintShapeIntersection = (first: Strand, firstWidth: number, second: Strand, secondWidth: number, color: string) => {
    if (!scratchContext) return;
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.clearRect(0, 0, pixelWidth, pixelHeight);
    scratchContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    scratchContext.globalCompositeOperation = "source-over";
    scratchContext.beginPath();
    addStrandShape(scratchContext, first, firstWidth);
    scratchContext.fillStyle = color;
    scratchContext.fill();
    scratchContext.globalCompositeOperation = "destination-in";
    scratchContext.beginPath();
    addStrandShape(scratchContext, second, secondWidth);
    scratchContext.fillStyle = "#000";
    scratchContext.fill();
    scratchContext.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0, pixelWidth, pixelHeight, 0, 0, width, height);
  };

  // Match MaskedStrand.paint: intersect complete body/cap shapes for the two
  // outer strokes (with a 2px raster guard that emulates vector boolean edges),
  // then intersect the first fill with the second strand's
  // +4 source-pixel safety expansion. Circles therefore participate too.
  const drawStrandMask = (mask: Strand) => {
    const first = mask.first_selected_strand ? byName.get(mask.first_selected_strand) : undefined;
    const second = mask.second_selected_strand ? byName.get(mask.second_selected_strand) : undefined;
    if (!first || !second) return;
    paintShapeIntersection(
      first,
      (first.width + first.stroke_width * 2) * scale,
      second,
      (second.width + second.stroke_width * 2) * scale + 2,
      cssColor(first.stroke_color, "#000000"),
    );
    paintShapeIntersection(
      first,
      first.width * scale,
      second,
      (second.width + second.stroke_width * 2 + 4) * scale,
      cssColor(first.color),
    );
  };

  // Complete each level before moving outward: its strands first, then its
  // crossing masks. Newer-level strands therefore cover every older mask.
  const masks = stage.strands.filter(s => s.type === "MaskedStrand" && !s.is_hidden);
  for (let level = 0; level <= stage.level; level += 1) {
    regular.filter(strand => strandLevel(strand) === level).forEach(drawStrandBody);
    masks.filter(mask => strandLevel(mask) === level).forEach(drawStrandMask);
  }

  if (!showLabels) return;

  // Label the newest ring exactly by its layer_name, as in the source diagrams.
  const suffixes = stage.level === 0 ? [2, 3] : [stage.level * 2 + 2, stage.level * 2 + 3];
  const newest = regular.filter(s => s.type === "AttachedStrand" &&
    suffixes.some(suffix => s.layer_name.endsWith(`_${suffix}`)));
  const sourceFontSize = sourceWidth / 30;
  const fontSize = sourceFontSize * scale;
  ctx.font = `700 ${fontSize}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  newest.forEach(strand => {
    const dx = strand.end.x - strand.start.x;
    const dy = strand.end.y - strand.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const labelPoint = point({
      x: strand.end.x + (dx / length) * sourceFontSize * 1.4,
      y: strand.end.y + (dy / length) * sourceFontSize * 1.4,
    });
    ctx.lineWidth = sourceFontSize * .28 * scale;
    ctx.strokeStyle = "rgba(255,255,255,.96)";
    ctx.strokeText(strand.layer_name, labelPoint.x, labelPoint.y);
    ctx.fillStyle = "#11110f";
    ctx.fillText(strand.layer_name, labelPoint.x, labelPoint.y);
  });
}
