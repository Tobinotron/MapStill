// Terrain: shading and contour lines from elevation tiles (Mapterhorn, free, no key).
//
// maplibre-contour fetches each elevation tile once and serves it to MapLibre twice:
// as it is, for the shading, and turned into contour lines.

import mlcontour from "maplibre-contour";
import * as maplibregl from "maplibre-gl";
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";

const DEM_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
const DEM_MAXZOOM = 12; // available worldwide; MapLibre enlarges the tiles beyond it

export const DEM_SOURCE = "terrain-dem";
const CONTOUR_SOURCE = "terrain-contours";

/** Contour spacing in metres, [minor, major], from each MapLibre zoom upwards. */
const CONTOUR_INTERVALS = { 7: [500, 2000], 9: [200, 1000], 11: [100, 500], 12: [50, 200], 13: [20, 100], 14: [10, 50] };

let dem: InstanceType<typeof mlcontour.DemSource> | null = null;

function demSource() {
  if (!dem) {
    dem = new mlcontour.DemSource({
      url: DEM_TILES,
      encoding: "terrarium",
      maxzoom: DEM_MAXZOOM,
      worker: true,
      timeoutMs: 30_000,
    });
    dem.setupMaplibre(maplibregl);
  }
  return dem;
}

export function terrainSources(): Record<string, SourceSpecification> {
  const source = demSource();
  return {
    [DEM_SOURCE]: {
      type: "raster-dem",
      tiles: [source.sharedDemProtocolUrl],
      tileSize: 512,
      maxzoom: DEM_MAXZOOM,
      encoding: "terrarium",
      attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
    },
    [CONTOUR_SOURCE]: {
      type: "vector",
      tiles: [
        source.contourProtocolUrl({
          thresholds: CONTOUR_INTERVALS,
          elevationKey: "ele",
          levelKey: "level",
          contourLayer: "contours",
        }),
      ],
      maxzoom: 14,
    },
  };
}

export interface ShadingColors {
  shadow: string;
  highlight: string;
  accent: string;
}

const NEUTRAL_SHADING: ShadingColors = { shadow: "#000000", highlight: "#ffffff", accent: "#000000" };

export interface TerrainOptions {
  /** 0 (none) to 1. */
  hillshade: number;
  contours: boolean;
  contourColor: string;
  /** Elevation numbers along the major contour lines. */
  contourLabels: boolean;
  shading?: ShadingColors;
}

function backgroundColor(style: StyleSpecification): string {
  const background = style.layers.find((layer) => layer.type === "background");
  const color = background?.type === "background" ? background.paint?.["background-color"] : null;
  return typeof color === "string" ? color : "#ffffff";
}

const LAND_LAYERS = new Set(["landcover", "landuse", "park"]);

/** A layer that colours the ground (and so belongs below the shading). */
function isLand(layer: LayerSpecification): boolean {
  if (layer.type === "background" || layer.type === "raster" || layer.type === "color-relief") return true;
  return layer.type === "fill" && LAND_LAYERS.has(layer["source-layer"] ?? "");
}

/**
 * The style with shading and contour lines drawn over the land: above the areas that
 * colour the ground, below buildings, roads and labels.
 */
export function withTerrain(style: StyleSpecification, options: TerrainOptions): StyleSpecification {
  const layers: LayerSpecification[] = [];
  if (options.hillshade > 0) {
    const colors = options.shading ?? NEUTRAL_SHADING;
    layers.push({
      id: "terrain-shading",
      type: "hillshade",
      source: DEM_SOURCE,
      paint: {
        "hillshade-exaggeration": Math.min(options.hillshade, 1),
        "hillshade-shadow-color": colors.shadow,
        "hillshade-highlight-color": colors.highlight,
        "hillshade-accent-color": colors.accent,
      },
    });
  }
  if (options.contours) {
    layers.push({
      id: "terrain-contours",
      type: "line",
      source: CONTOUR_SOURCE,
      "source-layer": "contours",
      paint: {
        "line-color": options.contourColor,
        "line-opacity": 0.75,
        "line-width": ["match", ["get", "level"], 1, 1.1, 0.4],
      },
    });
    if (options.contourLabels) {
      layers.push({
        id: "terrain-contour-labels",
        type: "symbol",
        source: CONTOUR_SOURCE,
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        layout: {
          "symbol-placement": "line",
          "text-field": ["to-string", ["get", "ele"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 9,
        },
        paint: {
          "text-color": options.contourColor,
          "text-halo-color": backgroundColor(style),
          "text-halo-width": 1.2,
        },
      });
    }
  }
  if (layers.length === 0) return style;

  const at = style.layers.findLastIndex(isLand) + 1;
  return {
    ...style,
    sources: { ...style.sources, ...terrainSources() },
    layers: [...style.layers.slice(0, at), ...layers, ...style.layers.slice(at)],
  };
}
