// The map styles the app offers, and how the settings become a MapLibre style.
//
// All of them draw OpenStreetMap data from OpenFreeMap's vector tiles (free, no key).
//   - Base maps are OpenFreeMap's own styles, used as they are.
//   - Custom styles are colour rules (google-style.ts) applied to one of this app's
//     two maps (bases.ts). Some come with the app (PRESET_STYLES); the user's own
//     are files. Either can be loaded, changed, and saved as an own style.

import type { StyleSpecification } from "maplibre-gl";
import type { CustomStyle, MapType, NamedStyle, Settings, StyleDoc, Terrain } from "../types";
import { BASES } from "./bases";
import type { ExportIssue } from "./export";
import { googleZoom } from "./geo";
import { applyGoogleStyle, hexToHsl, hslToHex, parseGoogleStyle, type GoogleRule } from "./google-style";
import { openFreeMapStyle } from "./openfreemap";
import { ROOT, compile, normalizeColor, rulesFromTree, shown, treeFromRules, type StyleTree } from "./style-tree";
import { withTerrain } from "./terrain";

// --- base maps ---------------------------------------------------------------------------

export interface BaseMap {
  /** The name of the style at OpenFreeMap. */
  id: string;
  name: string;
}

export const BASE_MAPS: BaseMap[] = [
  { id: "liberty", name: "Liberty" },
  { id: "bright", name: "Bright" },
  { id: "positron", name: "Positron" },
  { id: "dark", name: "Dark" },
  { id: "fiord", name: "Fiord" },
];

export const baseMap = (id: string): BaseMap => BASE_MAPS.find((map) => map.id === id) ?? BASE_MAPS[0];

// --- the styles that come with the app ---------------------------------------------------

export const NO_TERRAIN: Terrain = { hillshade: 0, contours: false, contourColor: "#000000" };

const preset = (name: string, mapType: MapType, tree: StyleTree, terrain: Terrain = NO_TERRAIN): NamedStyle => ({
  name,
  style: { mapType, rules: rulesFromTree(tree), terrain },
});

// Greys only: white land, roads a shade darker, water the darkest. No labels, no
// railways, no borders.
const MONO_LIGHT: StyleTree = {
  [ROOT]: { text: "#333333", halo: "#ffffff", labelsVisible: false },
  landscape: { fill: "#ffffff" },
  "landscape.natural.landcover": { fill: "#d8d8d8" },
  "poi.park": { fill: "#e7e7e7" },
  water: { fill: "#a7a7a7" },
  road: { fill: "#dddddd", outlineVisible: false },
  transit: { fillVisible: false, outlineVisible: false },
  administrative: { outlineVisible: false },
};

/** The same style on a dark ground: every colour as far from black as it was from white. */
function darkened(tree: StyleTree): StyleTree {
  const dark = (color: string) => {
    const [h, sat, l] = hexToHsl(color) ?? [0, 0, 1];
    return hslToHex([h, sat, 0.08 + (1 - l) * 0.92]); // not quite black: pure black swallows the shapes
  };
  return Object.fromEntries(
    Object.entries(tree).map(([id, set]) => [id, Object.fromEntries(Object.entries(set).map(([prop, value]) => [prop, typeof value === "string" ? dark(value) : value]))]),
  );
}

export const PRESET_STYLES: NamedStyle[] = [
  // the street map as it is, to start from
  preset("Standard", "streets", {}),
  preset("Mono light", "streets", MONO_LIGHT),
  preset("Mono dark", "streets", darkened(MONO_LIGHT)),
  preset("Blueprint", "streets", {
    [ROOT]: { text: "#ffffff", halo: "#1d4e89", iconsVisible: false },
    landscape: { fill: "#1d4e89" },
    "landscape.natural.landcover": { fill: "#1f548f" },
    "landscape.man_made": { fill: "#1a467c" },
    "landscape.man_made.building": { fill: "#2b62a3" },
    "poi.park": { fill: "#215a96" },
    water: { fill: "#143a69" },
    road: { fill: "#6f9bd1", outlineVisible: false },
    "road.highway": { fill: "#ffffff" },
    "road.arterial": { fill: "#d6e6fb" },
    transit: { fill: "#7fb0e8", outlineVisible: false },
    "transit.station.airport": { fill: "#235c99" },
    administrative: { outline: "#7fb0e8" },
  }),
  preset("Ink (roads only)", "streets", {
    [ROOT]: { fill: "#ffffff", outlineVisible: false, text: "#111111", halo: "#ffffff", labelsVisible: false },
    water: { fill: "#e4e4e4" },
    road: { fill: "#111111" },
    transit: { fillVisible: false },
  }),
  preset("Figure-ground (buildings only)", "streets", {
    [ROOT]: { fill: "#ffffff", outlineVisible: false, labelsVisible: false },
    "landscape.man_made.building": { fill: "#000000" },
    // faint, as in Ink: with rivers and coasts one can tell where one is, also where
    // the map has no buildings to show (below zoom 14)
    water: { fill: "#e4e4e4" },
    road: { fillVisible: false },
    transit: { fillVisible: false },
  }),
  preset("Hiking map", "topographic", {}, { hillshade: 0.55, contours: true, contourColor: "#a0612f" }),
];

export const DEFAULT_CUSTOM: CustomStyle = { name: "Standard", own: false, mapType: "streets", rules: [] };

/** The custom style of the settings, for a style from a list. */
export const customOf = (named: NamedStyle, own: boolean): CustomStyle => ({
  name: named.name,
  own,
  mapType: named.style.mapType,
  rules: named.style.rules,
});

/** What loading a style sets: the custom style, and the terrain that belongs to its look. */
export const loaded = (named: NamedStyle, own: boolean): Pick<Settings, "custom" | keyof Terrain> => ({
  custom: customOf(named, own),
  ...named.style.terrain,
});

/** The style a custom style began as, if it still exists. */
export function sourceOf(custom: CustomStyle, ownStyles: NamedStyle[]): NamedStyle | null {
  if (custom.name === null) return null;
  return (custom.own ? ownStyles : PRESET_STYLES).find((style) => style.name === custom.name) ?? null;
}

/** The custom style of the settings as a style to keep. */
export const docOf = (settings: Pick<Settings, "custom" | keyof Terrain>): StyleDoc => ({
  mapType: settings.custom.mapType,
  rules: settings.custom.rules,
  terrain: { hillshade: settings.hillshade, contours: settings.contours, contourColor: settings.contourColor },
});

/**
 * Whether the custom style differs from the one it began as, so that replacing it
 * loses work. The terrain does not count: it is two controls, and shared with the
 * base maps.
 */
export function isEdited(custom: CustomStyle, ownStyles: NamedStyle[]): boolean {
  const source = sourceOf(custom, ownStyles);
  if (source === null) return true;
  return source.style.mapType !== custom.mapType || JSON.stringify(source.style.rules) !== JSON.stringify(custom.rules);
}

// --- reading styles from files and from elsewhere ----------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Whether a value has the shape of style rules (whatever they say). */
export const isRules = (value: unknown): value is GoogleRule[] =>
  Array.isArray(value) && value.every((rule) => isRecord(rule) && (rule.stylers === undefined || (Array.isArray(rule.stylers) && rule.stylers.every(isRecord))));

/** Rules as this app keeps them: written by it, or compiled into that form. */
export const tidyRules = (rules: GoogleRule[]): GoogleRule[] => rulesFromTree(treeFromRules(rules) ?? compile(rules));

export function readTerrain(raw: unknown, fallback: Terrain): Terrain {
  const t = isRecord(raw) ? raw : {};
  const color = typeof t.contourColor === "string" ? normalizeColor(t.contourColor) : null;
  return {
    hillshade: typeof t.hillshade === "number" && Number.isFinite(t.hillshade) ? Math.min(Math.max(t.hillshade, 0), 1) : fallback.hillshade,
    contours: typeof t.contours === "boolean" ? t.contours : fallback.contours,
    contourColor: color ?? fallback.contourColor,
  };
}

export const readMapType = (raw: unknown): MapType => (raw === "topographic" ? "topographic" : "streets");

/**
 * A style read from a file, made safe to use: files can be edited by hand and
 * outlive versions of the app. null if it is not a style at all.
 */
export function readStyleDoc(raw: unknown): StyleDoc | null {
  if (!isRecord(raw) || !isRules(raw.rules)) return null;
  return { mapType: readMapType(raw.mapType), rules: tidyRules(raw.rules), terrain: readTerrain(raw.terrain, NO_TERRAIN) };
}

export const readNamedStyles = (raw: unknown): NamedStyle[] =>
  (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const style = isRecord(entry) ? readStyleDoc(entry.style) : null;
    return style && isRecord(entry) && typeof entry.name === "string" ? [{ name: entry.name, style }] : [];
  });

export interface Imported {
  mapType: MapType;
  rules: GoogleRule[];
  /** Only a style saved by this app brings its terrain. */
  terrain: Terrain | null;
}

/**
 * Reads a style from text: a style array from Snazzy Maps, or a style saved by this
 * app (the file of an own style, or what is in it). Throws an Error that says what
 * is wrong.
 */
export function importStyle(text: string): Imported {
  if (!text.trim()) throw new Error("There is nothing to import yet");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`This is not valid JSON (${(error as Error).message})`, { cause: error });
  }
  const own = isRecord(parsed) ? (isRecord(parsed.style) ? parsed.style : parsed) : null;
  if (own) {
    if (!isRules(own.rules)) throw new Error("This is not a style: it has no list of rules");
    return { mapType: readMapType(own.mapType), rules: tidyRules(own.rules), terrain: "terrain" in own ? readTerrain(own.terrain, NO_TERRAIN) : null };
  }
  return { mapType: "streets", rules: tidyRules(parseGoogleStyle(text)), terrain: null };
}

// --- what a style needs from the detail level --------------------------------------------

/** The map data has buildings from this (MapLibre) zoom on. */
const BUILDINGS_FROM = 13;

/**
 * What to know about a style at a detail level. A style that gives buildings a colour
 * of their own is about buildings, and below this zoom the map has none: a
 * figure-ground plan comes out white.
 */
export function styleIssues(settings: Pick<Settings, "styleMode" | "custom" | "detailZoom">): ExportIssue[] {
  if (settings.styleMode !== "custom" || settings.detailZoom >= BUILDINGS_FROM) return [];
  const { rules } = settings.custom;
  const about = treeFromRules(rules)?.["landscape.man_made.building"]?.fill !== undefined;
  if (!about || !shown(rules, "landscape.man_made.building", "fillVisible")) return [];
  return [
    {
      level: "warning",
      text: `This style colours buildings, and the map has buildings only from zoom ${googleZoom(BUILDINGS_FROM)}. At this detail level none are drawn.`,
    },
  ];
}

// --- settings → MapLibre style -----------------------------------------------------------

type StyleSettings = Pick<Settings, "styleMode" | "baseMap" | "custom" | "labels" | keyof Terrain>;

/** The name of the style in use, for people. */
export const styleName = (settings: Pick<Settings, "styleMode" | "baseMap" | "custom">): string =>
  settings.styleMode === "base" ? baseMap(settings.baseMap).name : (settings.custom.name ?? "Custom style");

/** The MapLibre style for these settings. Rejects with a message for the user. */
export async function buildStyle(settings: StyleSettings): Promise<StyleSpecification> {
  const terrain = { hillshade: settings.hillshade, contours: settings.contours, contourColor: settings.contourColor };
  if (settings.styleMode === "base") {
    const style = await openFreeMapStyle(baseMap(settings.baseMap).id);
    const layers = settings.labels ? style.layers : style.layers.filter((layer) => layer.type !== "symbol");
    return withTerrain({ ...style, layers }, { ...terrain, contourLabels: settings.labels });
  }
  const { mapType, rules } = settings.custom;
  const base = BASES[mapType];
  return withTerrain(applyGoogleStyle(await base.style(), rules, base), {
    ...terrain,
    // the numbers on contour lines are labels like any other
    contourLabels: shown(rules, ROOT, "labelsVisible"),
    shading: base.shading,
  });
}
