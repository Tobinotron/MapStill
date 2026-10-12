// Web Mercator arithmetic. Areas are handled as boxes in "world units": the whole
// world is 1 × 1, x grows to the east and y to the south, as on the screen.

import type { Bounds } from "../types";

/** MapLibre's tile size: at zoom z the world is TILE × 2^z CSS pixels wide. */
export const TILE = 512;
const MAX_LAT = 85.051129;
const AREA_MAX_LAT = 85; // areas stay a little inside the edge of the world

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const worldSize = (zoom: number) => TILE * 2 ** zoom;

/**
 * Google Maps (and so Snazzy Maps, and Leaflet) count zoom with 256 px tiles: the same
 * view has a zoom one higher than in MapLibre. The UI shows Google's numbers.
 */
export const googleZoom = (zoom: number) => zoom + 1;
export const fromGoogleZoom = (zoom: number) => zoom - 1;

export const mercX = (lng: number) => (lng + 180) / 360;
export const mercY = (lat: number) => {
  const sin = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};
export const lngOf = (x: number) => x * 360 - 180;
export const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export const toBox = ([west, south, east, north]: Bounds): Box => ({
  x0: mercX(west),
  y0: mercY(north),
  x1: mercX(east),
  y1: mercY(south),
});

export const toBounds = ({ x0, y0, x1, y1 }: Box): Bounds => [lngOf(x0), latOf(y1), lngOf(x1), latOf(y0)];

/** Width divided by height, as the area appears on the map. */
export const aspectOf = (bounds: Bounds) => {
  const box = toBox(bounds);
  return (box.x1 - box.x0) / (box.y1 - box.y0);
};

/** "16:9" → 1.777…; "free" (or anything else) → null. */
export function parseAspect(aspect: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

const MIN_SIDE = 1e-7; // about 4 m at the equator

/** A box with these sides around a centre, moved back inside the world if it left it. */
function boxAround(cx: number, cy: number, width: number, height: number): Box {
  const top = mercY(AREA_MAX_LAT);
  const w = Math.min(Math.max(width, MIN_SIDE), 1);
  const h = Math.min(Math.max(height, MIN_SIDE), 1 - 2 * top);
  const x0 = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y0 = Math.min(Math.max(cy - h / 2, top), 1 - top - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** The same centre and area, with another shape. */
export function reshape(bounds: Bounds, ratio: number): Bounds {
  const box = toBox(bounds);
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  return toBounds(
    boxAround((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, Math.sqrt(area * ratio), Math.sqrt(area / ratio)),
  );
}

/** The smallest area of this shape that contains `bounds`. */
export function cover(bounds: Bounds, ratio: number): Bounds {
  const box = toBox(bounds);
  let width = box.x1 - box.x0;
  let height = box.y1 - box.y0;
  if (width / height > ratio) height = width / ratio;
  else width = height * ratio;
  return toBounds(boxAround((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, width, height));
}

/** The area, grown around its centre until neither side is shorter than `side` (in world units). */
export function atLeast(bounds: Bounds, side: number): Bounds {
  const box = toBox(bounds);
  const width = Math.max(box.x1 - box.x0, side);
  const height = Math.max(box.y1 - box.y0, side);
  return toBounds(boxAround((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, width, height));
}

/** The largest area of this shape inside `bounds`. */
export function inside(bounds: Bounds, ratio: number): Bounds {
  const box = toBox(bounds);
  let width = box.x1 - box.x0;
  let height = box.y1 - box.y0;
  if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  return toBounds(boxAround((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, width, height));
}

/**
 * The box between a fixed corner and a dragged one. With a ratio, the dragged corner
 * only sets the size: the box grows along its diagonal.
 */
export function boxFromCorners(
  anchor: { x: number; y: number },
  dragged: { x: number; y: number },
  ratio: number | null,
): Box {
  let width = Math.max(Math.abs(dragged.x - anchor.x), MIN_SIDE);
  let height = Math.max(Math.abs(dragged.y - anchor.y), MIN_SIDE);
  if (ratio !== null) {
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  }
  const x0 = dragged.x < anchor.x ? anchor.x - width : anchor.x;
  const y0 = dragged.y < anchor.y ? anchor.y - height : anchor.y;
  return { x0, y0, x1: x0 + width, y1: y0 + height };
}

/** The box around a fixed centre, with one corner dragged. A ratio works as in `boxFromCorners`. */
export function boxFromCentre(
  centre: { x: number; y: number },
  dragged: { x: number; y: number },
  ratio: number | null,
): Box {
  let width = Math.max(Math.abs(dragged.x - centre.x) * 2, MIN_SIDE);
  let height = Math.max(Math.abs(dragged.y - centre.y) * 2, MIN_SIDE);
  if (ratio !== null) {
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  }
  return { x0: centre.x - width / 2, y0: centre.y - height / 2, x1: centre.x + width / 2, y1: centre.y + height / 2 };
}

/** The box, moved back inside the world if it left it. */
export const clampBox = (box: Box): Box =>
  boxAround((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.x1 - box.x0, box.y1 - box.y0);

/** The box, moved so that its centre is at (cx, cy). */
export function moveBox(box: Box, cx: number, cy: number): Box {
  return boxAround(cx, cy, box.x1 - box.x0, box.y1 - box.y0);
}

const EQUATOR_KM = 40075.017;

/** An area as people give it: where its centre is and how large it is. */
export interface Area {
  lat: number;
  lng: number;
  widthKm: number;
  heightKm: number;
}

/** Kilometres per world unit at the latitude of the world coordinate y. */
const kmPerWorld = (y: number) => EQUATOR_KM * Math.cos((latOf(y) * Math.PI) / 180);

/**
 * Centre and size of an area. The centre is the middle of the area as drawn; both
 * sizes are measured at its latitude, so width / height is the shape on the map.
 */
export function areaOf(bounds: Bounds): Area {
  const box = toBox(bounds);
  const y = (box.y0 + box.y1) / 2;
  const km = kmPerWorld(y);
  return { lat: latOf(y), lng: lngOf((box.x0 + box.x1) / 2), widthKm: (box.x1 - box.x0) * km, heightKm: (box.y1 - box.y0) * km };
}

export function boundsOf(area: Area): Bounds {
  const y = mercY(area.lat);
  const km = kmPerWorld(y);
  return toBounds(boxAround(mercX(area.lng), y, area.widthKm / km, area.heightKm / km));
}

export function isBounds(value: unknown): value is Bounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => Number.isFinite(v))) return false;
  const [west, south, east, north] = value as number[];
  return west >= -180 && east <= 180 && west < east && south >= -MAX_LAT && north <= MAX_LAT && south < north;
}
