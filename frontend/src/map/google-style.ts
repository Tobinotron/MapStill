// Applies a Google Maps style array (the "JavaScript Style Array" of Snazzy Maps) to
// a MapLibre style made for OpenMapTiles data (one of the maps in bases.ts).
//
// Google styles name what they colour by feature type ("road.local") and element type
// ("geometry.fill"). Each layer of the base style is assigned the pair it stands for;
// the rules that match the pair or one of its ancestors are applied in order, starting
// from a colour close to Google's default map. The result follows the palette of the
// Google style; the geometry is OpenStreetMap's, so it is not the same picture.
//
// Not supported: `weight` (line widths stay those of the base style).

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export interface Styler {
  visibility?: string;
  color?: string;
  hue?: string;
  saturation?: number;
  lightness?: number;
  gamma?: number;
  invert_lightness?: boolean;
  weight?: number;
}

export interface GoogleRule {
  featureType?: string;
  elementType?: string;
  stylers?: Styler[];
}

/** Reads a pasted style array. Throws an Error that says what is wrong with it. */
export function parseGoogleStyle(text: string): GoogleRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`This is not valid JSON (${(error as Error).message})`, { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error("A style is a list of rules: it starts with [ and ends with ]");
  parsed.forEach((rule, i) => {
    const ok =
      rule !== null &&
      typeof rule === "object" &&
      !Array.isArray(rule) &&
      (rule.stylers === undefined || Array.isArray(rule.stylers));
    if (!ok) throw new Error(`Rule ${i + 1} is not a style rule (an object with "stylers")`);
  });
  return parsed as GoogleRule[];
}

// --- colours -------------------------------------------------------------------------------

type Hsl = [h: number, s: number, l: number]; // each 0…1

export function hexToHsl(hex: string): Hsl | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (l > 0.5 ? 2 - max - min : max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToHex([h, s, l]: Hsl): string {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    const value = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Google's percentages for lightness: +100 goes all the way to white, −100 to black. */
const shift = (value: number, percent: number) =>
  percent >= 0 ? value + (1 - value) * Math.min(percent, 100) / 100 : value * (1 + Math.max(percent, -100) / 100);

/** …and for saturation: that much more or less of what there is. A grey stays grey. */
const saturate = (value: number, percent: number) => Math.min(1, value * (1 + Math.max(percent, -100) / 100));

function applyStyler(color: Hsl, styler: Styler): Hsl {
  let [h, s, l] = (typeof styler.color === "string" && hexToHsl(styler.color)) || color;
  const hue = typeof styler.hue === "string" ? hexToHsl(styler.hue) : null;
  if (hue) h = hue[0];
  if (styler.invert_lightness === true) l = 1 - l;
  if (typeof styler.saturation === "number") s = saturate(s, styler.saturation);
  if (typeof styler.lightness === "number") l = shift(l, styler.lightness);
  if (typeof styler.gamma === "number" && styler.gamma > 0) l = l ** (1 / styler.gamma);
  return [h, s, l];
}

// --- matching rules ------------------------------------------------------------------------

/** "road.local" → ["all", "road", "road.local"] */
const withAncestors = (name: string) => {
  const parts = name.split(".");
  return ["all", ...parts.map((_, i) => parts.slice(0, i + 1).join("."))];
};

export interface Resolved {
  visibility: "on" | "off" | "simplified";
  color: string;
}

/** What the rules make of one feature and element type, starting from `base`. */
export function resolve(rules: GoogleRule[], feature: string, element: string, base: string): Resolved {
  const features = withAncestors(feature);
  const elements = withAncestors(element);
  let visibility: Resolved["visibility"] = "on";
  let color = hexToHsl(base) ?? [0, 0, 0.5];
  for (const rule of rules) {
    if (!features.includes(rule.featureType ?? "all") || !elements.includes(rule.elementType ?? "all")) continue;
    for (const styler of rule.stylers ?? []) {
      if (styler.visibility === "on" || styler.visibility === "off" || styler.visibility === "simplified") {
        visibility = styler.visibility;
      }
      color = applyStyler(color, styler);
    }
  }
  return { visibility, color: hslToHex(color) };
}

// --- colouring a style -------------------------------------------------------------------

// Colours close to Google's default road map, by feature type; the most specific wins.
// Some types go beyond Google's list so that styles can tell more apart: buildings,
// woods ("landcover"), ice, and paths.
const DEFAULT_FILL: Record<string, string> = {
  landscape: "#f3f1ec",
  "landscape.man_made": "#ebe9e4",
  "landscape.man_made.building": "#dedcd6",
  "landscape.natural.landcover": "#d5e8c8",
  "landscape.natural.ice": "#f4f8fb",
  "poi.park": "#cfe8bf",
  water: "#a8cdf5",
  "road.highway": "#f9d776",
  "road.arterial": "#ffffff",
  "road.local": "#ffffff",
  "transit.line": "#c6c4be",
  "transit.station.airport": "#e3e1ea",
};
const DEFAULT_STROKE: Record<string, string> = {
  administrative: "#a9a7a2",
  "road.highway": "#e3b24a",
  "road.arterial": "#d8d6d0",
  "road.local": "#e2e0da",
  "transit.line": "#f3f1ec",
};
const DEFAULT_TEXT = "#4d4d4d";
const DEFAULT_HALO = "#ffffff";

/** The colour Google's default map has for a feature and element type, about. */
export function defaultColor(feature: string, element: string): string {
  if (element.startsWith("labels")) return element === "labels.text.stroke" ? DEFAULT_HALO : DEFAULT_TEXT;
  const table = element === "geometry.stroke" ? DEFAULT_STROKE : DEFAULT_FILL;
  for (const name of withAncestors(feature).toReversed()) {
    if (table[name]) return table[name];
  }
  return "#cccccc";
}

export type Target = [feature: string, element: string];

/** What the rules need to know about the style they colour. */
export interface Canvas {
  /** The feature and element type a layer stands for; null: rules do not touch it. */
  target(layer: LayerSpecification): Target | null;
  /** The colour of an element of a layer when no rule sets one. */
  fallback(layer: LayerSpecification, feature: string, element: string): string;
}

const COLOR_PROPERTY = { background: "background-color", fill: "fill-color", line: "line-color" } as const;

/** The colour a layer has in its own style for an element, if it is a plain colour. */
export function ownColor(layer: LayerSpecification, element: string): string | null {
  const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
  const property =
    element === "labels.text.fill"
      ? "text-color"
      : element === "labels.text.stroke"
        ? "text-halo-color"
        : layer.type === "background" || layer.type === "fill" || layer.type === "line"
          ? COLOR_PROPERTY[layer.type]
          : null;
  const color = property ? paint[property] : null;
  return typeof color === "string" ? color : null;
}

/** A style, coloured by the rules. */
export function applyGoogleStyle(style: StyleSpecification, rules: GoogleRule[], canvas: Canvas): StyleSpecification {
  const styled = style.layers.map((original) => {
    const target = canvas.target(original);
    if (!target) return original;
    const [feature, element] = target;
    const layer = structuredClone(original) as LayerSpecification & {
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
    const { visibility, color } = resolve(rules, feature, element, canvas.fallback(original, feature, element));
    // "simplified" draws shapes without their outlines (borders are nothing but outline)
    const isOutline = element === "geometry.stroke" && !feature.startsWith("administrative");
    const hidden = visibility === "off" || (isOutline && visibility === "simplified");
    layer.layout = { ...layer.layout, visibility: hidden ? "none" : "visible" };
    if (hidden) return layer;

    if (layer.type === "symbol") {
      const text = resolve(rules, feature, "labels.text.fill", canvas.fallback(original, feature, "labels.text.fill"));
      const halo = resolve(rules, feature, "labels.text.stroke", canvas.fallback(original, feature, "labels.text.stroke"));
      if (text.visibility === "off") layer.layout.visibility = "none";
      layer.paint = {
        ...layer.paint,
        "text-color": text.color,
        "text-halo-color": halo.color,
        ...(halo.visibility === "off" ? { "text-halo-width": 0 } : {}),
      };
    } else if (layer.type === "background" || layer.type === "fill" || layer.type === "line") {
      layer.paint = { ...layer.paint, [COLOR_PROPERTY[layer.type]]: color };
      delete layer.paint["fill-outline-color"];
    }
    return layer;
  });
  return { ...style, layers: styled };
}
