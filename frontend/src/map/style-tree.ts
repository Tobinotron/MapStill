// A custom style as the editor shows it: a tree of features (roads, and below them
// motorways, main roads, …), each with the few things that can be set for it. What is
// set for a feature holds for everything below it, unless that sets its own.
//
// Styles are kept as Google style rules (google-style.ts), the format of Snazzy Maps.
// The tree is a view of such rules; `rulesFromTree` writes it out with the general
// rules first, so that applying them in order gives exactly this inheritance. Rules
// from elsewhere can do more (shift hues, depend on their order); `compile` turns
// them into a tree that draws the same map.

import { defaultColor, hexToHsl, hslToHex, resolve, type GoogleRule, type Styler } from "./google-style";

export type ColorProp = "fill" | "outline" | "text" | "halo";
export type FlagProp = "fillVisible" | "outlineVisible" | "labelsVisible" | "iconsVisible";
export type Prop = ColorProp | FlagProp;
export type FeatureStyle = Partial<Record<ColorProp, string> & Record<FlagProp, boolean>>;
/** What is set, by feature id. Features with nothing set are absent. */
export type StyleTree = Record<string, FeatureStyle>;

/** What a feature can have of its own: an area or line, an outline, labels, icons. */
export type Kind = "fill" | "outline" | "text" | "icons";

export interface Feature {
  /** The Google feature type ("road.local"), or one of this app's additions below it. */
  id: string;
  name: string;
  /** What is drawn for this feature itself, in at least one of the map types. */
  kinds: Kind[];
  children: Feature[];
}

const feature = (id: string, name: string, kinds: Kind[], children: Feature[] = []): Feature => ({ id, name, kinds, children });

export const ROOT = "all";

export const FEATURES: Feature = feature(ROOT, "Everything", [], [
  feature("landscape", "Land", [], [
    feature("landscape.natural", "Open land", ["fill"], [
      feature("landscape.natural.landcover", "Woods", ["fill"]),
      feature("landscape.natural.ice", "Ice and glaciers", ["fill"]),
    ]),
    feature("landscape.man_made", "Built-up areas", ["fill"], [
      feature("landscape.man_made.building", "Buildings", ["fill"]),
    ]),
  ]),
  feature("poi.park", "Parks", ["fill"]),
  feature("poi.peak", "Peaks", ["text"]),
  feature("water", "Water", ["fill", "text"]),
  feature("road", "Roads", ["icons"], [
    feature("road.highway", "Motorways", ["fill", "outline"]),
    feature("road.arterial", "Main roads", ["fill", "outline", "text"]),
    feature("road.local", "Local roads", ["fill", "text"], [
      feature("road.local.path", "Paths and trails", ["fill", "text"]),
    ]),
  ]),
  feature("transit", "Transit", [], [
    feature("transit.line", "Railways", ["fill", "outline"]),
    feature("transit.station.airport", "Airports", ["fill", "text"]),
  ]),
  feature("administrative", "Borders and place names", ["outline", "text"]),
]);

export interface FeatureRow extends Feature {
  depth: number;
  parent: string | null;
}

/** Every feature, parents before their children. */
export const FEATURE_ROWS: FeatureRow[] = (function rows(node: Feature, depth: number, parent: string | null): FeatureRow[] {
  return [{ ...node, depth, parent }, ...node.children.flatMap((child) => rows(child, depth + 1, node.id))];
})(FEATURES, 0, null);

const ROW = new Map(FEATURE_ROWS.map((row) => [row.id, row]));

/** The feature and everything below it. */
export function subtree(id: string): FeatureRow[] {
  const start = FEATURE_ROWS.findIndex((row) => row.id === id);
  if (start === -1) return [];
  const end = FEATURE_ROWS.findIndex((row, i) => i > start && row.depth <= FEATURE_ROWS[start].depth);
  return FEATURE_ROWS.slice(start, end === -1 ? undefined : end);
}

/** The features above this one, nearest first. */
export function ancestors(id: string): FeatureRow[] {
  const above: FeatureRow[] = [];
  for (let row = ROW.get(ROW.get(id)?.parent ?? ""); row; row = ROW.get(row.parent ?? "")) above.push(row);
  return above;
}

export const COLOR_PROPS: ColorProp[] = ["fill", "outline", "text", "halo"];
const FLAG_PROPS: FlagProp[] = ["labelsVisible", "iconsVisible", "fillVisible", "outlineVisible"];

/** The kind of thing a property belongs to. */
export const KIND: Record<Prop, Kind> = {
  fill: "fill",
  fillVisible: "fill",
  outline: "outline",
  outlineVisible: "outline",
  text: "text",
  halo: "text",
  labelsVisible: "text",
  iconsVisible: "icons",
};

/** The element type a property is written to in a rule. */
export const ELEMENT: Record<Prop, string> = {
  fill: "geometry.fill",
  fillVisible: "geometry.fill",
  outline: "geometry.stroke",
  outlineVisible: "geometry.stroke",
  text: "labels.text.fill",
  halo: "labels.text.stroke",
  labelsVisible: "labels",
  iconsVisible: "labels.icon",
};

const isColorProp = (prop: Prop): prop is ColorProp => (COLOR_PROPS as Prop[]).includes(prop);

/** "#abc" and "#AABBCC" → "#aabbcc"; anything that is not a colour → null. */
export function normalizeColor(text: string): string | null {
  const hsl = hexToHsl(text);
  return hsl ? hslToHex(hsl) : null;
}

// --- tree ⇄ rules ------------------------------------------------------------------------

// within a feature, the general element type first: "labels" before "labels.icon"
const ELEMENT_ORDER = ["labels", "labels.icon", "labels.text.fill", "labels.text.stroke", "geometry.fill", "geometry.stroke"];

export function rulesFromTree(tree: StyleTree): GoogleRule[] {
  const rules: GoogleRule[] = [];
  for (const { id } of FEATURE_ROWS) {
    const set = tree[id];
    if (!set) continue;
    for (const element of ELEMENT_ORDER) {
      const stylers: Styler[] = [];
      for (const prop of FLAG_PROPS) {
        if (ELEMENT[prop] === element && set[prop] !== undefined) stylers.push({ visibility: set[prop] ? "on" : "off" });
      }
      for (const prop of COLOR_PROPS) {
        if (ELEMENT[prop] === element && set[prop] !== undefined) stylers.push({ color: set[prop] });
      }
      if (stylers.length) rules.push({ featureType: id, elementType: element, stylers });
    }
  }
  return rules;
}

/** The tree that rules written by `rulesFromTree` stand for; null for any other rules. */
export function treeFromRules(rules: GoogleRule[]): StyleTree | null {
  const tree: StyleTree = {};
  const seen = new Set<string>();
  for (const rule of rules) {
    const id = rule.featureType ?? ROOT;
    const element = rule.elementType ?? "all";
    const key = `${id}|${element}`;
    if (!ROW.has(id) || !ELEMENT_ORDER.includes(element) || seen.has(key)) return null;
    seen.add(key);
    for (const styler of rule.stylers ?? []) {
      const keys = Object.keys(styler);
      if (keys.length !== 1) return null;
      if (keys[0] === "visibility" && (styler.visibility === "on" || styler.visibility === "off")) {
        const prop = FLAG_PROPS.find((flag) => ELEMENT[flag] === element);
        if (!prop) return null;
        tree[id] = { ...tree[id], [prop]: styler.visibility === "on" };
      } else if (keys[0] === "color" && typeof styler.color === "string") {
        const prop = COLOR_PROPS.find((color) => ELEMENT[color] === element);
        const color = normalizeColor(styler.color);
        if (!prop || !color) return null;
        tree[id] = { ...tree[id], [prop]: color };
      } else {
        return null;
      }
    }
  }
  return tree;
}

/** What rules make of a property of a feature (on Google's default colours). */
function measure(rules: GoogleRule[], id: string, prop: Prop): string | boolean {
  const element = prop === "labelsVisible" ? "labels.text.fill" : ELEMENT[prop];
  const { visibility, color } = resolve(rules, id, element, defaultColor(id, element));
  if (isColorProp(prop)) return color;
  // "simplified" means: no outlines (but borders are nothing else, and stay)
  if (prop === "outlineVisible" && !id.startsWith("administrative")) return visibility === "on";
  return visibility !== "off";
}

/**
 * A tree that draws the same map as any rules. Colours that rules derive (a hue, a
 * lightness) become plain colours, and each is set as high in the tree as is useful:
 * rules that paint all roads but the local ones the same give "roads" that colour
 * and "local roads" their own, as a person would have set it.
 */
export function compile(rules: GoogleRule[]): StyleTree {
  const tree: StyleTree = {};
  for (const row of FEATURE_ROWS) {
    for (const prop of [...FLAG_PROPS, ...COLOR_PROPS]) {
      const soFar = rulesFromTree(tree);
      const differs = (id: string) => measure(rules, id, prop) !== measure(soFar, id, prop);
      if (row.kinds.includes(KIND[prop])) {
        // drawn itself: it needs exactly its value
        if (differs(row.id)) tree[row.id] = { ...tree[row.id], [prop]: measure(rules, row.id, prop) };
        continue;
      }
      // only a heading: it takes the value most of what is below it needs, if that
      // saves setting it below. "Everything" only takes what everything shares.
      const owners = subtree(row.id).filter((below) => below.kinds.includes(KIND[prop]));
      const needing = owners.filter((owner) => differs(owner.id));
      const counts = new Map<string | boolean, number>();
      for (const owner of needing) counts.set(measure(rules, owner.id, prop), (counts.get(measure(rules, owner.id, prop)) ?? 0) + 1);
      const [value, count] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [undefined as string | boolean | undefined, 0]);
      if (value === undefined || count < 2) continue;
      const others = owners.filter((owner) => measure(rules, owner.id, prop) !== value).length;
      if (row.id === ROOT ? others === 0 : 1 + others < needing.length) tree[row.id] = { ...tree[row.id], [prop]: value };
    }
  }
  return tree;
}

/** The tree for any rules: read directly if this app wrote them, compiled otherwise. */
export const treeOf = (rules: GoogleRule[]): StyleTree => treeFromRules(rules) ?? compile(rules);

// --- editing -----------------------------------------------------------------------------

/** The tree with a property of a feature set, or (undefined) no longer set. */
export function withProp(tree: StyleTree, id: string, prop: Prop, value: string | boolean | undefined): StyleTree {
  const { [prop]: _, ...rest } = tree[id] ?? {};
  const set: FeatureStyle = value === undefined ? rest : { ...rest, [prop]: value };
  const { [id]: __, ...others } = tree;
  return Object.keys(set).length ? { ...others, [id]: set } : others;
}

/** The colours set anywhere in the tree, each once, in the order of the features. */
export function colorsUsed(tree: StyleTree): string[] {
  const colors = FEATURE_ROWS.flatMap((row) => COLOR_PROPS.map((prop) => tree[row.id]?.[prop]));
  return [...new Set(colors.filter((color): color is string => color !== undefined))];
}

/** The nearest feature above (or the feature itself) that sets a colour, and the colour. */
export function inherited(tree: StyleTree, id: string, prop: ColorProp): { from: FeatureRow; color: string } | null {
  const row = ROW.get(id);
  for (const candidate of row ? [row, ...ancestors(id)] : []) {
    const color = tree[candidate.id]?.[prop];
    if (color !== undefined) return { from: candidate, color };
  }
  return null;
}

/** Whether something is shown for a feature, as the rules make it. */
export function shown(rules: GoogleRule[], id: string, prop: FlagProp): boolean {
  return measure(rules, id, prop) === true;
}
