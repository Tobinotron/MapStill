import { cover, isBounds } from "./map/geo";
import { parseGoogleStyle } from "./map/google-style";
import { ROOT, compile, rulesFromTree, treeOf, withProp } from "./map/style-tree";
import { BASE_MAPS, DEFAULT_CUSTOM, NO_TERRAIN, PRESET_STYLES, customOf, isRules, readMapType, readTerrain, tidyRules } from "./map/styles";
import type { CustomStyle, Settings } from "./types";

export const ASPECTS = ["free", "16:9", "9:16", "21:9", "4:3", "3:2", "1:1"];

/** Zooms the detail level can take (MapLibre zooms; the UI shows one more, as Google does). */
export const DETAIL_ZOOM = { min: 1, max: 18, step: 0.5 };
export const SIZE = { min: 16, max: 100_000 };

export const DEFAULT_SETTINGS: Settings = {
  styleMode: "base",
  baseMap: "positron",
  custom: DEFAULT_CUSTOM,
  labels: true,
  ...NO_TERRAIN,
  bounds: cover([-0.2, 51.475, -0.03, 51.535], 16 / 9), // central London
  aspect: "free",
  detailZoom: 13,
  size: { side: "width", pixels: 7680 },
  format: "png",
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readCustom(raw: unknown): CustomStyle {
  if (!isRecord(raw) || !isRules(raw.rules)) return DEFAULT_CUSTOM;
  return {
    name: typeof raw.name === "string" ? raw.name : null,
    own: raw.own === true,
    mapType: readMapType(raw.mapType),
    rules: tidyRules(raw.rules),
  };
}

// The styles that the first version offered in one list, by their id then.
const FORMER_PALETTES: Record<string, string> = {
  blueprint: "Blueprint",
  ink: "Ink (roads only)",
  "figure-ground": "Figure-ground (buildings only)",
  hiking: "Hiking map",
};

/**
 * Settings of the first version: one `styleId` (a base map, a palette, or "custom"
 * with a pasted style array in `customStyle`), and `labels` for all of them.
 */
function fromFirstVersion(s: Record<string, unknown>): Pick<Settings, "styleMode" | "baseMap" | "custom"> {
  const id = typeof s.styleId === "string" ? s.styleId : "";
  if (BASE_MAPS.some((map) => map.id === id)) return { styleMode: "base", baseMap: id, custom: DEFAULT_CUSTOM };

  let custom = DEFAULT_CUSTOM;
  const palette = PRESET_STYLES.find((style) => style.name === FORMER_PALETTES[id]);
  if (palette) {
    custom = customOf(palette, false);
  } else if (id === "custom" && typeof s.customStyle === "string") {
    try {
      custom = { name: null, own: false, mapType: "streets", rules: rulesFromTree(compile(parseGoogleStyle(s.customStyle))) };
    } catch {
      // a style array that never worked: nothing to keep
    }
  } else {
    return { styleMode: "base", baseMap: DEFAULT_SETTINGS.baseMap, custom };
  }
  // labels were switched off for the whole map; now the style says so
  if (s.labels === false) custom = { ...custom, rules: rulesFromTree(withProp(treeOf(custom.rules), ROOT, "labelsVisible", false)) };
  return { styleMode: "custom", baseMap: DEFAULT_SETTINGS.baseMap, custom };
}

/**
 * Settings read from a file (the last session, a preset), made safe to use: presets
 * can be edited by hand and outlive versions of the app, so every value is checked.
 */
export function normalize(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const s = isRecord(raw) ? raw : {};
  const size = isRecord(s.size) ? s.size : {};
  const style =
    s.styleMode === undefined && s.styleId !== undefined
      ? fromFirstVersion(s)
      : {
          styleMode: s.styleMode === "custom" ? ("custom" as const) : ("base" as const),
          baseMap: BASE_MAPS.some((map) => map.id === s.baseMap) ? (s.baseMap as string) : d.baseMap,
          custom: readCustom(s.custom),
        };
  return {
    ...style,
    labels: typeof s.labels === "boolean" ? s.labels : d.labels,
    ...readTerrain(s, NO_TERRAIN),
    bounds: isBounds(s.bounds) ? s.bounds : d.bounds,
    aspect: ASPECTS.includes(s.aspect as string) ? (s.aspect as string) : d.aspect,
    detailZoom: clamp(number(s.detailZoom, d.detailZoom), DETAIL_ZOOM.min, DETAIL_ZOOM.max),
    size: {
      side: size.side === "height" ? "height" : "width",
      pixels: Math.round(clamp(number(size.pixels, d.size.pixels), SIZE.min, SIZE.max)),
    },
    format: s.format === "jpeg" ? "jpeg" : "png",
  };
}
