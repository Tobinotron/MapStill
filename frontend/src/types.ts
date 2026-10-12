import type { GoogleRule } from "./map/google-style";

export type Bounds = [west: number, south: number, east: number, north: number];

export type ImageFormat = "png" | "jpeg";

/** The kinds of map a custom style can colour (map/bases.ts). */
export type MapType = "streets" | "topographic";

export interface Terrain {
  /** Terrain shading, 0 (off) to 1. */
  hillshade: number;
  contours: boolean;
  contourColor: string;
}

/**
 * A custom style as it is kept: one that comes with the app, or one of the user's
 * own (a file). It is a whole look: the kind of map, its colours, and the terrain.
 */
export interface StyleDoc {
  mapType: MapType;
  /** Google style rules, as on Snazzy Maps (map/google-style.ts). */
  rules: GoogleRule[];
  terrain: Terrain;
}

export interface NamedStyle {
  name: string;
  style: StyleDoc;
}

/** The custom style being used and edited. Its terrain is in the settings. */
export interface CustomStyle {
  /** The style this began as; null if it was imported and never saved. */
  name: string | null;
  /** Whether `name` is one of the user's own styles (not one that comes with the app). */
  own: boolean;
  mapType: MapType;
  rules: GoogleRule[];
}

/** Everything that defines an image. This is what presets store. */
export interface Settings extends Terrain {
  /** A ready-made base map, or a custom style. */
  styleMode: "base" | "custom";
  /** The base map (one of OpenFreeMap's styles), used in the mode "base". */
  baseMap: string;
  custom: CustomStyle;
  /** Whether a base map shows its labels. A custom style decides that itself. */
  labels: boolean;
  bounds: Bounds;
  /** "free", or a ratio such as "16:9" that the area keeps. */
  aspect: string;
  /** What is drawn and how thick, as a MapLibre zoom (see `googleZoom`). */
  detailZoom: number;
  /** One side of the image in pixels; the other follows from the area. */
  size: { side: "width" | "height"; pixels: number };
  format: ImageFormat;
}

export interface Preset {
  name: string;
  settings: Settings;
}

export interface Place {
  name: string;
  bounds: Bounds;
}

export type ExportState =
  | { status: "idle" }
  | { status: "rendering"; done: number; total: number }
  | { status: "saving" }
  | { status: "done"; path: string; bytes: number; failedTiles: number }
  | { status: "error"; message: string };
