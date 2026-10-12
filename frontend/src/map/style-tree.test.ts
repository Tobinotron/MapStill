import { describe, expect, it } from "vitest";
import { defaultColor, resolve, type GoogleRule } from "./google-style";
import { SNAZZY } from "./snazzy.fixture";
import {
  ELEMENT,
  FEATURE_ROWS,
  KIND,
  ROOT,
  ancestors,
  colorsUsed,
  compile,
  inherited,
  normalizeColor,
  rulesFromTree,
  shown,
  subtree,
  treeFromRules,
  treeOf,
  withProp,
  type Prop,
  type StyleTree,
} from "./style-tree";

const TREE: StyleTree = {
  [ROOT]: { text: "#ffffff", halo: "#1d4e89", labelsVisible: false },
  landscape: { fill: "#1d4e89" },
  road: { fill: "#6f9bd1", outlineVisible: false, iconsVisible: true },
  "road.highway": { fill: "#ffffff", outline: "#000000", outlineVisible: true },
  "road.local.path": { fillVisible: false },
};

const PROPS: Prop[] = ["fill", "outline", "text", "halo", "fillVisible", "outlineVisible", "labelsVisible", "iconsVisible"];

/** What rules draw: for everything a feature has of its own, the colour and whether it is shown. */
function drawn(rules: GoogleRule[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const row of FEATURE_ROWS) {
    for (const prop of PROPS.filter((p) => row.kinds.includes(KIND[p]))) {
      const element = prop === "labelsVisible" ? "labels.text.fill" : ELEMENT[prop];
      const { visibility, color } = resolve(rules, row.id, element, defaultColor(row.id, element));
      const outline = prop === "outlineVisible" && !row.id.startsWith("administrative");
      out[`${row.id} ${prop}`] = prop.endsWith("Visible") ? (outline ? visibility === "on" : visibility !== "off") : color;
    }
  }
  return out;
}

describe("the features", () => {
  it("have unique ids, and every id continues its parent's (so that rules for the parent reach it)", () => {
    expect(new Set(FEATURE_ROWS.map((row) => row.id)).size).toBe(FEATURE_ROWS.length);
    for (const row of FEATURE_ROWS) {
      if (row.parent && row.parent !== ROOT) expect(row.id.startsWith(`${row.parent}.`)).toBe(true);
    }
  });

  it("know what is below and above them", () => {
    expect(subtree("road").map((row) => row.id)).toEqual(["road", "road.highway", "road.arterial", "road.local", "road.local.path"]);
    expect(subtree("water").map((row) => row.id)).toEqual(["water"]);
    expect(subtree(ROOT)).toHaveLength(FEATURE_ROWS.length);
    expect(ancestors("road.local.path").map((row) => row.id)).toEqual(["road.local", "road", ROOT]);
    expect(ancestors(ROOT)).toEqual([]);
  });
});

describe("tree and rules", () => {
  it("round-trip", () => {
    expect(treeFromRules(rulesFromTree(TREE))).toEqual(TREE);
    expect(rulesFromTree({})).toEqual([]);
    expect(treeFromRules([])).toEqual({});
  });

  it("the rules are plain Google rules, general ones first", () => {
    const rules = rulesFromTree(TREE);
    expect(rules[0]).toEqual({ featureType: "all", elementType: "labels", stylers: [{ visibility: "off" }] });
    expect(rules).toContainEqual({ featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ visibility: "on" }, { color: "#000000" }] });
    const order = rules.map((rule) => rule.featureType);
    expect(order.indexOf("road")).toBeLessThan(order.indexOf("road.highway"));
    expect(order.indexOf("all")).toBeLessThan(order.indexOf("landscape"));
  });

  it("applied in order, the rules give the tree's inheritance", () => {
    const rules = rulesFromTree(TREE);
    const fill = (id: string) => resolve(rules, id, "geometry.fill", "#eeeeee");
    expect(fill("road.arterial").color).toBe("#6f9bd1"); // from roads
    expect(fill("road.highway").color).toBe("#ffffff"); // its own
    expect(fill("landscape.man_made.building").color).toBe("#1d4e89"); // from land, two levels up
    expect(fill("water").color).toBe("#eeeeee"); // nothing set: the map's colour
    expect(shown(rules, "road.local.path", "fillVisible")).toBe(false);
    expect(shown(rules, "road.local", "fillVisible")).toBe(true);
    expect(shown(rules, "road.arterial", "outlineVisible")).toBe(false);
    expect(shown(rules, "road.highway", "outlineVisible")).toBe(true);
    expect(shown(rules, "water", "labelsVisible")).toBe(false);
    expect(shown(rules, ROOT, "labelsVisible")).toBe(false);
  });

  it("other rules are not mistaken for the app's own", () => {
    expect(treeFromRules(SNAZZY)).toBeNull();
    expect(treeFromRules([{ featureType: "water", elementType: "geometry.fill", stylers: [{ hue: "#ff0000" }] }])).toBeNull();
    expect(treeFromRules([{ featureType: "poi.business", elementType: "geometry.fill", stylers: [{ color: "#ff0000" }] }])).toBeNull();
    expect(treeFromRules([{ featureType: "water", elementType: "geometry", stylers: [{ color: "#ff0000" }] }])).toBeNull();
    const twice = { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#ff0000" }] };
    expect(treeFromRules([twice, twice])).toBeNull();
  });
});

describe("compile", () => {
  it("draws the same map as the rules it is given", () => {
    const hard: GoogleRule[][] = [
      SNAZZY,
      [{ stylers: [{ saturation: -100 }, { lightness: 20 }] }],
      [{ stylers: [{ invert_lightness: true }] }, { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] }],
      // the general rule comes last, and so wins
      [{ featureType: "road.local", stylers: [{ color: "#ff0000" }] }, { featureType: "road", stylers: [{ color: "#0000ff" }] }],
      [{ featureType: "poi", stylers: [{ visibility: "off" }] }, { elementType: "labels.icon", stylers: [{ visibility: "off" }] }],
      [{ featureType: "administrative", stylers: [{ visibility: "simplified" }] }, { featureType: "road", stylers: [{ visibility: "simplified" }] }],
    ];
    for (const rules of hard) expect(drawn(rulesFromTree(compile(rules)))).toEqual(drawn(rules));
  });

  it("puts a colour as high in the tree as it can", () => {
    expect(compile([{ featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ff0000" }] }])).toEqual({ road: { fill: "#ff0000" } });
    expect(compile([{ elementType: "labels", stylers: [{ visibility: "off" }] }])).toEqual({ [ROOT]: { labelsVisible: false } });
    // one colour for all land, but only woods differ from it
    const land = compile([
      { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#111111" }] },
      { featureType: "landscape.natural.landcover", elementType: "geometry", stylers: [{ color: "#222222" }] },
    ]);
    expect(land).toEqual({ landscape: { fill: "#111111" }, "landscape.natural.landcover": { fill: "#222222" } });
  });

  it("makes of the Snazzy style what a person would have set", () => {
    const tree = compile(SNAZZY);
    expect(tree[ROOT]).toEqual({ labelsVisible: false });
    expect(tree.landscape).toEqual({ fill: "#562135" });
    expect(tree["landscape.man_made"]).toEqual({ fill: "#3d0a24" });
    expect(tree["landscape.man_made.building"]).toBeUndefined(); // as built-up areas
    expect(tree.water?.fill).toBe("#e9b1cd");
    // all roads but the local ones share a colour: it is the roads' colour
    expect(tree.road).toMatchObject({ fill: "#682145", outlineVisible: false });
    expect(tree["road.highway"]).toBeUndefined();
    expect(tree["road.local"]).toEqual({ fill: "#55223c" });
    expect(tree["transit.line"]).toMatchObject({ fill: "#d3055c", outlineVisible: false });
    expect(tree["transit.station.airport"]).toEqual({ fillVisible: false });
  });

  it("makes nothing of rules that change nothing", () => {
    expect(compile([])).toEqual({});
    expect(compile([{ featureType: "poi.business", stylers: [{ visibility: "off" }] }])).toEqual({});
    expect(compile([{ stylers: [{ visibility: "on" }] }])).toEqual({});
  });

  it("leaves the app's own rules as they are", () => {
    expect(treeOf(rulesFromTree(TREE))).toEqual(TREE);
    expect(rulesFromTree(treeOf(SNAZZY))).toEqual(rulesFromTree(compile(SNAZZY)));
  });
});

describe("editing", () => {
  it("sets and unsets, without changing the tree it is given", () => {
    const set = withProp(TREE, "water", "fill", "#123456");
    expect(set.water).toEqual({ fill: "#123456" });
    expect(TREE.water).toBeUndefined();
    expect(withProp(set, "water", "fill", undefined)).toEqual(TREE);
    expect(withProp(TREE, "landscape", "fill", undefined).landscape).toBeUndefined();
    expect(withProp(TREE, "road", "outlineVisible", true).road).toEqual({ fill: "#6f9bd1", outlineVisible: true, iconsVisible: true });
  });

  it("lists the colours in use once each", () => {
    expect(colorsUsed(TREE)).toEqual(["#ffffff", "#1d4e89", "#6f9bd1", "#000000"]);
    expect(colorsUsed({})).toEqual([]);
  });

  it("finds where a colour comes from", () => {
    expect(inherited(TREE, "road.local.path", "fill")).toMatchObject({ color: "#6f9bd1", from: { id: "road" } });
    expect(inherited(TREE, "road.highway", "fill")).toMatchObject({ color: "#ffffff", from: { id: "road.highway" } });
    expect(inherited(TREE, "water", "text")).toMatchObject({ color: "#ffffff", from: { id: ROOT } });
    expect(inherited(TREE, "water", "fill")).toBeNull();
  });

  it("accepts colours as people type them", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor(" #1D4E89 ")).toBe("#1d4e89");
    expect(normalizeColor("1d4e89")).toBeNull();
    expect(normalizeColor("#12345")).toBeNull();
  });
});
