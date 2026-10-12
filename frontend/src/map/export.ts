// Rendering the chosen area as an image of any size.
//
// A WebGL canvas cannot be as large as the images this app is for, so a second,
// invisible map draws the area in square chunks, which are assembled elsewhere.
//
// Two things decide the picture, and they are independent:
//   - the detail zoom: what is drawn and how thick, exactly as the map looks at that zoom;
//   - the scale: how many image pixels one CSS pixel of that map gets (MapLibre's
//     pixel ratio). A city at the detail of a street view is simply a large scale-1
//     image; the same city at city detail but 8K wide is a small map at a high scale.
//
// Which names a map draws depends on what is around them, and a map only knows what it
// shows. Where two chunks meet they would decide differently now and then, and a name
// would end at the seam. So a map with labels is drawn with a margin around each chunk,
// which is cut off again: both chunks then know the same surroundings of their seam,
// and the image is the same wherever the seams are.

import { Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import type { Bounds, ImageFormat, Settings } from "../types";
import { googleZoom, latOf, lngOf, toBox, worldSize } from "./geo";

const CHUNK = 2048; // image pixels per chunk side, about
const MIN_CSS_CHUNK = 64;
const MAX_CSS_CHUNK = 4096;
/**
 * A chunk is this many units a side. Chunks and margins are whole units, and a unit is
 * whole pixels, so that a margin can be cut off exactly.
 */
const UNITS = 8;
const MAX_CANVAS = 4096;
/**
 * The margin around a chunk of a map with labels, in CSS pixels: longer than most
 * names. Tried on maps of London: with 60 to 80 the odd name was still cut, with 120
 * and more none.
 */
const MARGIN_CSS = 256;
const MIN_MARGIN_CSS = 128;
const IDLE_TIMEOUT_MS = 180_000;

/** Below this, the map would have to be drawn many times larger than the image. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = CHUNK / MIN_CSS_CHUNK;
/** Enlarged more than this, the simplified shapes of a low zoom start to show. */
const COARSE_SCALE = 6;
/** The vector tiles hold no more detail beyond this (MapLibre) zoom. */
export const DATA_MAX_ZOOM = 14;

export interface ExportPlan {
  width: number;
  height: number;
  megapixels: number;
  /** Image pixels per CSS pixel of the map at the detail zoom. */
  scale: number;
  /** The zoom to render at: the detail zoom, nudged so that a unit is whole pixels. */
  zoom: number;
  pixelRatio: number;
  /** A unit's side in CSS pixels of the invisible map and in image pixels. */
  cssUnit: number;
  unit: number;
}

/** How the image is cut into the chunks that are drawn one after the other. */
export interface Chunking {
  /** A chunk's side in units. */
  side: number;
  /** Units drawn around each chunk and cut off again. */
  margin: number;
  cols: number;
  rows: number;
}

export function planExport(bounds: Bounds, detailZoom: number, size: Settings["size"]): ExportPlan {
  const box = toBox(bounds);
  const world = worldSize(detailZoom);
  const cssWidth = (box.x1 - box.x0) * world;
  const cssHeight = (box.y1 - box.y0) * world;
  const scale = size.pixels / (size.side === "width" ? cssWidth : cssHeight);
  const width = Math.max(1, Math.round(cssWidth * scale));
  const height = Math.max(1, Math.round(cssHeight * scale));

  // MapLibre sizes its canvas as CSS size × pixel ratio, in whole pixels. The scale is
  // rarely such a ratio, so the next lower one is used and the zoom makes up the
  // difference: about a hundredth of a zoom level at most. The zoom must never end up
  // below the detail zoom, however little: what a style first draws at zoom 13
  // (buildings, say) is missing at 12.999.
  const cssUnit = Math.min(Math.max(Math.floor(CHUNK / UNITS / scale), MIN_CSS_CHUNK / UNITS), MAX_CSS_CHUNK / UNITS);
  const unit = Math.max(1, Math.floor(cssUnit * scale));
  const pixelRatio = unit / cssUnit;
  return {
    width,
    height,
    megapixels: (width * height) / 1e6,
    scale,
    zoom: Math.max(detailZoom, detailZoom + Math.log2(scale / pixelRatio)),
    pixelRatio,
    cssUnit,
    unit,
  };
}

/** Whether the style draws names or symbols: what is placed by its surroundings. */
export const drawsLabels = (style: StyleSpecification): boolean =>
  style.layers.some((layer) => layer.type === "symbol" && layer.layout?.visibility !== "none");

/**
 * The chunks of an image. Without labels they are simply laid next to each other.
 * With labels each gets a margin; the more the map is enlarged, the more pixels a
 * margin takes, and the chunks get smaller to leave room for it on the canvas.
 */
export function chunking(plan: Pick<ExportPlan, "width" | "height" | "cssUnit" | "unit">, labels: boolean): Chunking {
  const cut = (side: number, margin: number): Chunking => ({
    side,
    margin,
    cols: Math.ceil(plan.width / (side * plan.unit)),
    rows: Math.ceil(plan.height / (side * plan.unit)),
  });
  const plain = cut(UNITS, 0);
  if (!labels || plain.cols * plain.rows === 1) return plain; // nothing is placed, or there are no seams

  const canvas = Math.floor(MAX_CANVAS / plan.unit);
  const room = (side: number) => Math.max(0, Math.floor((canvas - side) / 2));
  const wanted = Math.ceil(MARGIN_CSS / plan.cssUnit);
  const needed = Math.ceil(MIN_MARGIN_CSS / plan.cssUnit);
  for (const side of [UNITS, UNITS / 2]) {
    if (room(side) >= needed) return cut(side, Math.min(wanted, room(side)));
  }
  // enlarged so much that no canvas holds a margin as wide as a name: see `exportIssues`
  return cut(UNITS, room(UNITS));
}

/** Whether names may be cut where chunks meet: the margin is narrower than names are long. */
export const marginTooNarrow = (plan: Pick<ExportPlan, "cssUnit">, chunks: Chunking): boolean =>
  chunks.cols * chunks.rows > 1 && chunks.margin * plan.cssUnit < MIN_MARGIN_CSS;

export interface ExportIssue {
  /** "error": the export cannot be made like this. */
  level: "error" | "warning" | "info";
  text: string;
}

const count = (n: number) => Math.ceil(n).toLocaleString("en");

/** What the user should know about a plan before exporting. `labels`: the style draws names or symbols. */
export function exportIssues(plan: ExportPlan, detailZoom: number, format: ImageFormat, labels = false): ExportIssue[] {
  const issues: ExportIssue[] = [];
  const side = Math.max(plan.width, plan.height);
  if (plan.scale < MIN_SCALE) {
    const factor = MIN_SCALE / plan.scale;
    issues.push({
      level: "error",
      text: `The image is too small for this detail level. Make it at least ${count(plan.width * factor)} × ${count(plan.height * factor)} px, or lower the detail level.`,
    });
  } else if (plan.scale > MAX_SCALE) {
    issues.push({ level: "error", text: "The image is too large for this detail level. Raise the detail level." });
  }
  if (plan.megapixels > 1000 || side > 100_000) {
    issues.push({ level: "error", text: "The image is too large: at most 1,000 megapixels." });
  } else if (format === "jpeg" && side > 65_535) {
    issues.push({ level: "error", text: "A JPEG cannot be larger than 65,535 px. Choose PNG." });
  } else if (plan.megapixels > 256 || side > 32_768) {
    issues.push({
      level: "warning",
      text: "Premiere Pro imports stills up to 256 megapixels and 32,768 px per side. This image is larger.",
    });
  }
  if (plan.scale >= MIN_SCALE && plan.scale < 0.999) {
    issues.push({
      level: "info",
      text: "The detail level asks for more pixels than the image has: fine lines get thinner than drawn.",
    });
  }
  if (plan.scale > COARSE_SCALE && plan.scale <= MAX_SCALE) {
    issues.push({
      level: "info",
      text: "The map is drawn much larger than at this detail level: zoomed in, shapes look coarse. Raise the detail level to see more when zooming in.",
    });
  }
  if (labels && plan.scale <= MAX_SCALE && marginTooNarrow(plan, chunking(plan, true))) {
    issues.push({
      level: "warning",
      text: "Names are drawn so large here that one may be cut off where the parts of the image are joined. Raise the detail level, or switch the labels off.",
    });
  }
  if (detailZoom > DATA_MAX_ZOOM + 0.001) {
    issues.push({
      level: "info",
      text: `The map data ends at zoom ${googleZoom(DATA_MAX_ZOOM)}. Above it, things are drawn larger but nothing new appears.`,
    });
  }
  return issues;
}

const FRAMES = [
  { name: "1080p", long: 1920, short: 1080 },
  { name: "4K", long: 3840, short: 2160 },
];

/**
 * How far a video frame can zoom into the image before it shows fewer pixels than
 * the frame has. The frame lies as the image does (upright for an upright image).
 */
export function zoomRoom(plan: Pick<ExportPlan, "width" | "height">, frame: { long: number; short: number }): number {
  const [long, short] = plan.width >= plan.height ? [plan.width, plan.height] : [plan.height, plan.width];
  return Math.min(long / frame.long, short / frame.short);
}

/** What the size of the image is good for in a film: "lossless 4× zoom at 1080p, 2× at 4K". */
export function zoomSummary(plan: Pick<ExportPlan, "width" | "height">): string {
  // rounded down: never more than there is
  const rooms = FRAMES.map((frame) => ({ name: frame.name, room: Math.floor(zoomRoom(plan, frame) * 10 + 1e-6) / 10 }));
  const factor = (room: number) => (room >= 10 ? String(Math.floor(room)) : String(room));
  if (rooms[0].room < 1) return `smaller than a ${rooms[0].name} frame`;
  const parts = rooms.filter(({ room }) => room >= 1).map(({ name, room }) => (room === 1 ? `fills ${name}` : `${factor(room)}× zoom at ${name}`));
  const [first, ...others] = parts;
  return [first.startsWith("fills") ? first : `lossless ${first}`, ...others.map((part) => part.replace(" zoom", ""))].join(", ");
}

export class ExportCancelled extends Error {
  constructor() {
    super("The export was cancelled");
  }
}

/**
 * Waits until the map has drawn everything. A minimised window draws nothing (the web
 * view gives it no frames), so the export pauses there; the time limit only runs
 * while the window can be seen.
 */
function untilIdle(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", watch);
      signal.removeEventListener("abort", cancelled);
      if (error) reject(error);
      else resolve();
    };
    const watch = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(
        () => finish(new Error("The map did not finish drawing. Is there an internet connection?")),
        IDLE_TIMEOUT_MS,
      );
    };
    const cancelled = () => finish(new ExportCancelled());
    document.addEventListener("visibilitychange", watch);
    signal.addEventListener("abort", cancelled);
    watch();
    void map.once("idle").then(() => finish());
    map.triggerRepaint();
  });
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("A part of the image could not be read"))), "image/png"),
  );

/** Reads the square of `size` pixels that lies `offset` pixels inside a canvas. */
function cutter(size: number): (from: HTMLCanvasElement, offset: number) => Promise<Blob> {
  const part = document.createElement("canvas");
  part.width = part.height = size;
  const context = part.getContext("2d");
  if (!context) throw new Error("A part of the image could not be read");
  return (from, offset) => {
    context.clearRect(0, 0, size, size);
    context.drawImage(from, offset, offset, size, size, 0, 0, size, size);
    return toPng(part);
  };
}

export interface RenderOptions {
  style: StyleSpecification;
  bounds: Bounds;
  plan: ExportPlan;
  chunks: Chunking;
  /** Receives each chunk with the position of its top left corner in the image. */
  onChunk(png: Blob, x: number, y: number): Promise<void>;
  onProgress(done: number, total: number): void;
  signal: AbortSignal;
}

/** Draws the area chunk by chunk. Resolves with the number of map tiles that failed to load. */
export async function renderExport({ style, bounds, plan, chunks, onChunk, onProgress, signal }: RenderOptions): Promise<number> {
  // the invisible map shows a chunk and the margin around it
  const cssChunk = chunks.side * plan.cssUnit;
  const chunk = chunks.side * plan.unit;
  const margin = chunks.margin * plan.unit;
  const canvasSide = chunk + 2 * margin;
  const stage = document.createElement("div");
  stage.className = "export-stage";
  stage.style.width = stage.style.height = `${cssChunk + 2 * chunks.margin * plan.cssUnit}px`;
  document.body.append(stage);

  let failedTiles = 0;
  const map = new MapLibreMap({
    container: stage,
    style,
    center: [0, 0],
    zoom: plan.zoom,
    maxZoom: 24,
    // a hair more than the ratio: the canvas size is rounded down, and must not lose a pixel
    pixelRatio: plan.pixelRatio + 1e-6,
    // a little more than is ever asked for: at exactly the limit, the hair above would count as too much
    maxCanvasSize: [MAX_CANVAS + 16, MAX_CANVAS + 16],
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    interactive: false,
    attributionControl: false,
    trackResize: false,
    fadeDuration: 0, // labels appear at once, not over several frames
    // chunks at the edge of the image reach beyond the area, and may reach beyond the world
    transformConstrain: (center, zoom) => ({ center, zoom }),
  });
  map.on("error", () => (failedTiles += 1));

  try {
    const canvas = map.getCanvas();
    if (canvas.width !== canvasSide || canvas.height !== canvasSide) {
      throw new Error(`The map could not be drawn at this size (${canvas.width} px instead of ${canvasSide} px)`);
    }
    const cut = margin > 0 ? cutter(chunk) : null;
    const box = toBox(bounds);
    const world = worldSize(plan.zoom);
    const total = chunks.cols * chunks.rows;
    onProgress(0, total);
    for (let row = 0; row < chunks.rows; row++) {
      for (let col = 0; col < chunks.cols; col++) {
        if (signal.aborted) throw new ExportCancelled();
        const x = (box.x0 * world + (col + 0.5) * cssChunk) / world;
        const y = (box.y0 * world + (row + 0.5) * cssChunk) / world;
        map.jumpTo({ center: [lngOf(x), latOf(y)], zoom: plan.zoom });
        await untilIdle(map, signal);
        await onChunk(await (cut ? cut(canvas, margin) : toPng(canvas)), col * chunk, row * chunk);
        onProgress(row * chunks.cols + col + 1, total);
      }
    }
    return failedTiles;
  } finally {
    map.remove();
    stage.remove();
  }
}
