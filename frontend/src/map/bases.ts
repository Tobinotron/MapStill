// The two kinds of map a custom style can colour. Each is a MapLibre style whose
// layers are assigned the feature they stand for (roads, water, …), so that the same
// rules can colour either.
//
//   streets      OpenFreeMap's Positron style: a street map with everything on it.
//                Without rules it has colours close to Google's default map, which is
//                what styles from Snazzy Maps are made for.
//   topographic  This app's own: the land tinted by height, woods, trails, peaks; made
//                for mountains. Without rules it looks like an old hiking map.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapType } from "../types";
import { defaultColor, ownColor, type Canvas, type Target } from "./google-style";
import { OPENFREEMAP, openFreeMapStyle } from "./openfreemap";
import { ELEMENT, FEATURE_ROWS, KIND, subtree, type ColorProp, type Kind } from "./style-tree";
import { DEM_SOURCE, terrainSources, type ShadingColors } from "./terrain";

export interface Base extends Canvas {
  id: MapType;
  name: string;
  note: string;
  /** Colours of the terrain shading, if black and white do not suit the map. */
  shading?: ShadingColors;
  style(): Promise<StyleSpecification>;
  /** Whether this map draws something of this kind for the feature itself. */
  draws(feature: string, kind: Kind): boolean;
  /** The colour a feature has for a property when no rule sets one; null if it draws none. */
  defaultOf(feature: string, prop: ColorProp): string | null;
}

// --- streets -----------------------------------------------------------------------------

/** The feature and element type that a layer of the Positron style stands for. */
export function streetsTarget(layer: LayerSpecification): Target | null {
  if (layer.type === "background") return ["landscape.natural", "geometry.fill"];
  if (!("source-layer" in layer) || !layer["source-layer"]) return null;
  const id = layer.id;
  const source = layer["source-layer"];
  if (layer.type === "symbol") {
    if (source === "place") return ["administrative", "labels.text.fill"];
    if (source === "aerodrome_label") return ["transit.station.airport", "labels.text.fill"];
    if (source === "water_name" || source === "waterway") return ["water", "labels.text.fill"];
    if (source !== "transportation_name") return null;
    if (id.includes("shield")) return ["road", "labels.icon"]; // road numbers
    if (id.includes("path")) return ["road.local.path", "labels.text.fill"];
    return [id.includes("minor") ? "road.local" : "road.arterial", "labels.text.fill"];
  }
  switch (source) {
    case "park":
      return ["poi.park", "geometry.fill"];
    case "water":
    case "waterway":
      return ["water", "geometry.fill"];
    case "landcover":
      if (id === "landcover_grass") return ["poi.park", "geometry.fill"];
      return [/ice|glacier/.test(id) ? "landscape.natural.ice" : "landscape.natural.landcover", "geometry.fill"];
    case "landuse":
      return ["landscape.man_made", "geometry.fill"];
    case "building":
      return ["landscape.man_made.building", "geometry.fill"];
    case "aeroway":
      return ["transit.station.airport", "geometry.fill"];
    case "boundary":
      return ["administrative", "geometry.stroke"];
    case "transportation": {
      if (id.includes("railway")) return ["transit.line", id.includes("dashline") ? "geometry.stroke" : "geometry.fill"];
      if (id.includes("pier")) return ["landscape.natural", "geometry.fill"];
      const element = id.includes("casing") ? "geometry.stroke" : "geometry.fill";
      if (id.includes("motorway")) return ["road.highway", element];
      if (id.includes("major")) return ["road.arterial", element];
      return [id.includes("path") ? "road.local.path" : "road.local", element];
    }
    default:
      return null;
  }
}

// Positron draws no city parks (its "park" layer is nature reserves). Google styles
// colour them with "poi.park", so the map gets a layer for them.
const GRASS_LAYER: LayerSpecification = {
  id: "landcover_grass",
  type: "fill",
  source: "openmaptiles",
  "source-layer": "landcover",
  filter: ["==", ["get", "class"], "grass"],
  paint: { "fill-color": "#cfe8bf" },
};

/** Positron, as the streets map uses it. */
export const streetsLayers = (positron: LayerSpecification[]): LayerSpecification[] =>
  positron.flatMap((layer) => (layer.id === "landcover_wood" ? [layer, GRASS_LAYER] : [layer]));

const streets: Base = {
  id: "streets",
  name: "Street map",
  note: "Roads, buildings, railways and place names.",
  style: async () => {
    const positron = await openFreeMapStyle("positron");
    return { ...positron, layers: streetsLayers(positron.layers) };
  },
  target: streetsTarget,
  fallback: (_layer, feature, element) => defaultColor(feature, element),
  // everything the features know, except what only the topographic map has
  draws: (feature, kind) => feature !== "poi.peak" && FEATURE_ROWS.some((row) => row.id === feature && row.kinds.includes(kind)),
  defaultOf: (feature, prop) => (streets.draws(feature, KIND[prop]) ? defaultColor(feature, ELEMENT[prop]) : null),
};

// --- topographic -------------------------------------------------------------------------

const lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const PAPER = "#f3ecd9";
const MAIN_ROADS = ["trunk", "primary", "secondary", "tertiary"];
const NOT_ROADS = ["path", "track", "rail", "transit", "aerialway", "ferry"];

const road = (id: string, classes: unknown, width: unknown): LayerSpecification =>
  ({
    id,
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["all", lines, classes],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#4a3b2c", "line-width": width },
  }) as unknown as LayerSpecification;

// each layer with the feature it stands for
const TOPOGRAPHIC: Array<[layer: LayerSpecification, feature: string | null]> = (
  [
    [{ id: "background", type: "background", paint: { "background-color": PAPER } }, "landscape.natural"],
    [
      {
        id: "height-tint",
        type: "color-relief",
        source: DEM_SOURCE,
        paint: {
          "color-relief-opacity": 0.9,
          "color-relief-color": [
            "interpolate", ["linear"], ["elevation"],
            0, "#cfdcb4", 500, "#d9e2bd", 1100, "#ece6c4", 1900, "#e5d0ad", 2600, "#efe6da", 3200, "#ffffff",
          ],
        },
      },
      null,
    ],
    [
      {
        id: "landcover_wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wood"],
        paint: { "fill-color": "#8fae6b", "fill-opacity": 0.3 },
      },
      "landscape.natural.landcover",
    ],
    [
      {
        id: "landcover_ice",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "ice"],
        paint: { "fill-color": "#f4fafc", "fill-opacity": 0.8 },
      },
      "landscape.natural.ice",
    ],
    [{ id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#a9cbe0" } }, "water"],
    [
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#6fa3c7", "line-width": 1 } },
      "water",
    ],
    [
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": "#5d4c3f" } },
      "landscape.man_made.building",
    ],
    [
      {
        id: "path",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", lines, ["match", ["get", "class"], ["path", "track"], true, false]],
        paint: { "line-color": "#b3261e", "line-width": 0.8, "line-dasharray": [3, 2] },
      },
      "road.local.path",
    ],
    [road("road_local", ["match", ["get", "class"], ["motorway", ...MAIN_ROADS, ...NOT_ROADS], false, true], 0.7), "road.local"],
    [
      road("road_main", ["match", ["get", "class"], MAIN_ROADS, true, false], ["match", ["get", "class"], ["trunk", "primary"], 2, 1.3]),
      "road.arterial",
    ],
    [road("road_motorway", ["==", ["get", "class"], "motorway"], 2), "road.highway"],
    [
      {
        id: "rail",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", lines, ["==", ["get", "class"], "rail"]],
        paint: { "line-color": "#222222", "line-width": 1.2, "line-dasharray": [4, 2] },
      },
      "transit.line",
    ],
    [
      {
        id: "peak",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "mountain_peak",
        filter: ["has", "name"],
        layout: {
          "text-field": ["case", ["has", "ele"], ["concat", ["get", "name"], "\n", ["to-string", ["get", "ele"]], " m"], ["get", "name"]],
          "text-font": ["Noto Sans Italic"],
          "text-size": 11,
        },
        paint: { "text-color": "#3a2c20", "text-halo-color": PAPER, "text-halo-width": 1.4 },
      },
      "poi.peak",
    ],
    [
      {
        id: "place",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 14 },
        paint: { "text-color": "#2a1f16", "text-halo-color": PAPER, "text-halo-width": 1.6 },
      },
      "administrative",
    ],
  ] as Array<[unknown, string | null]>
).map(([layer, feature]) => [layer as LayerSpecification, feature]);

/** The layers of the topographic map, in drawing order. */
export const TOPOGRAPHIC_LAYERS: LayerSpecification[] = TOPOGRAPHIC.map(([layer]) => layer);

const TOPOGRAPHIC_FEATURE = new Map(TOPOGRAPHIC.map(([layer, feature]) => [layer.id, feature]));

const topographicTarget = (layer: LayerSpecification): Target | null => {
  const feature = TOPOGRAPHIC_FEATURE.get(layer.id);
  return feature ? [feature, layer.type === "symbol" ? "labels.text.fill" : "geometry.fill"] : null;
};

const topographic: Base = {
  id: "topographic",
  name: "Topographic map",
  note: "Made for mountains: the land tinted by height, with woods, trails and peaks. Add shading and contour lines below.",
  shading: { shadow: "#4a3b2c", highlight: "#fffdf5", accent: "#6b5a45" },
  style: async () => ({
    version: 8,
    glyphs: `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`,
    sources: { openmaptiles: { type: "vector", url: `${OPENFREEMAP}/planet` }, ...terrainSources() },
    layers: TOPOGRAPHIC_LAYERS,
  }),
  target: topographicTarget,
  // a layer's own colour: without rules, the map is drawn as designed
  fallback: (layer, feature, element) => ownColor(layer, element) ?? defaultColor(feature, element),
  draws: (feature, kind) =>
    TOPOGRAPHIC.some(([layer, of]) => of === feature && (kind === "text" ? layer.type === "symbol" : kind === "fill" && layer.type !== "symbol")),
  defaultOf: (feature, prop) => {
    const drawn = TOPOGRAPHIC.find(([layer, of]) => of === feature && (KIND[prop] === "text") === (layer.type === "symbol"));
    return drawn && topographic.draws(feature, KIND[prop]) ? ownColor(drawn[0], ELEMENT[prop]) : null;
  },
};

export const BASES: Record<MapType, Base> = { streets, topographic };

/** Whether the map draws something of this kind for the feature or anything below it. */
export const offers = (base: Base, feature: string, kind: Kind): boolean => subtree(feature).some((row) => base.draws(row.id, kind));

/**
 * The colour a feature shows for a property when nothing is set for it or above it:
 * the map's own colour. null if the features below it have different ones.
 */
export function ownDefault(base: Base, feature: string, prop: ColorProp): string | null {
  const colors = new Set(subtree(feature).map((row) => base.defaultOf(row.id, prop)).filter((color) => color !== null));
  return colors.size === 1 ? [...colors][0] : null;
}
