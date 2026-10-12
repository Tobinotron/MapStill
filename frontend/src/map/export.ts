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

import { Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import type { Bounds, ImageFormat, Settings } from "../types";
import { googleZoom, latOf, lngOf, toBox, worldSize } from "./geo";

const CHUNK = 2048; // image pixels per chunk side, about
const MIN_CSS_CHUNK = 64;
const MAX_CSS_CHUNK = 4096;
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
  /** The zoom to render at: the detail zoom, nudged so that a chunk is whole pixels. */
  zoom: number;
  pixelRatio: number;
  /** A chunk's side in CSS pixels (the size of the invisible map) and in image pixels. */
  cssChunk: number;
  chunk: number;
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
  // difference: less than a thousandth of a zoom level. The zoom must never end up
  // below the detail zoom, however little: what a style first draws at zoom 13
  // (buildings, say) is missing at 12.999.
  const cssChunk = Math.min(Math.max(Math.round(CHUNK / scale), MIN_CSS_CHUNK), MAX_CSS_CHUNK);
  const chunk = Math.max(1, Math.floor(cssChunk * scale));
  const pixelRatio = chunk / cssChunk;
  return {
    width,
    height,
    megapixels: (width * height) / 1e6,
    scale,
    zoom: Math.max(detailZoom, detailZoom + Math.log2(scale / pixelRatio)),
    pixelRatio,
    cssChunk,
    chunk,
    cols: Math.ceil(width / chunk),
    rows: Math.ceil(height / chunk),
  };
}

export interface ExportIssue {
  /** "error": the export cannot be made like this. */
  level: "error" | "warning" | "info";
  text: string;
}

const count = (n: number) => Math.ceil(n).toLocaleString("en");

/** What the user should know about a plan before exporting. */
export function exportIssues(plan: ExportPlan, detailZoom: number, format: ImageFormat): ExportIssue[] {
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

export interface RenderOptions {
  style: StyleSpecification;
  bounds: Bounds;
  plan: ExportPlan;
  /** Receives each chunk with the position of its top left corner in the image. */
  onChunk(png: Blob, x: number, y: number): Promise<void>;
  onProgress(done: number, total: number): void;
  signal: AbortSignal;
}

/** Draws the area chunk by chunk. Resolves with the number of map tiles that failed to load. */
export async function renderExport({ style, bounds, plan, onChunk, onProgress, signal }: RenderOptions): Promise<number> {
  const stage = document.createElement("div");
  stage.className = "export-stage";
  stage.style.width = stage.style.height = `${plan.cssChunk}px`;
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
    maxCanvasSize: [4096, 4096],
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
    if (canvas.width !== plan.chunk || canvas.height !== plan.chunk) {
      throw new Error(`The map could not be drawn at this size (${canvas.width} px instead of ${plan.chunk} px)`);
    }
    const box = toBox(bounds);
    const world = worldSize(plan.zoom);
    const total = plan.cols * plan.rows;
    onProgress(0, total);
    for (let row = 0; row < plan.rows; row++) {
      for (let col = 0; col < plan.cols; col++) {
        if (signal.aborted) throw new ExportCancelled();
        const x = (box.x0 * world + (col + 0.5) * plan.cssChunk) / world;
        const y = (box.y0 * world + (row + 0.5) * plan.cssChunk) / world;
        map.jumpTo({ center: [lngOf(x), latOf(y)], zoom: plan.zoom });
        await untilIdle(map, signal);
        await onChunk(await toPng(canvas), col * plan.chunk, row * plan.chunk);
        onProgress(row * plan.cols + col + 1, total);
      }
    }
    return failedTiles;
  } finally {
    map.remove();
    stage.remove();
  }
}
