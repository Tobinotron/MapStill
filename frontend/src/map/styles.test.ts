import { describe, expect, it } from "vitest";
import { BASES } from "./bases";
import { SNAZZY } from "./snazzy.fixture";
import { ROOT, rulesFromTree, shown, treeFromRules } from "./style-tree";
import { NO_TERRAIN, PRESET_STYLES, customOf, docOf, importStyle, isEdited, loaded, readNamedStyles, readStyleDoc, sourceOf, styleIssues, styleName } from "./styles";
import type { CustomStyle, NamedStyle } from "../types";

const blueprint = PRESET_STYLES.find((style) => style.name === "Blueprint")!;
const OWN: NamedStyle[] = [{ name: "Night", style: { mapType: "streets", rules: rulesFromTree({ water: { fill: "#000033" } }), terrain: NO_TERRAIN } }];

describe("the styles that come with the app", () => {
  it("have unique names, and rules the editor can show as they are", () => {
    expect(new Set(PRESET_STYLES.map((style) => style.name)).size).toBe(PRESET_STYLES.length);
    for (const { style } of PRESET_STYLES) {
      expect(treeFromRules(style.rules)).not.toBeNull();
      expect(BASES[style.mapType]).toBeDefined();
    }
  });

  it("include the plain maps and the former palettes", () => {
    expect(PRESET_STYLES.map((style) => style.name)).toEqual(["Standard", "Mono light", "Mono dark", "Blueprint", "Ink (roads only)", "Figure-ground (buildings only)", "Hiking map"]);
    expect(PRESET_STYLES.find((style) => style.name === "Hiking map")!.style).toEqual({
      mapType: "topographic",
      rules: [],
      terrain: { hillshade: 0.55, contours: true, contourColor: "#a0612f" },
    });
  });

  it("draw what their names say", () => {
    const rules = (name: string) => PRESET_STYLES.find((style) => style.name.startsWith(name))!.style.rules;
    expect(shown(rules("Ink"), "road.local", "fillVisible")).toBe(true);
    expect(shown(rules("Ink"), "transit.line", "fillVisible")).toBe(false);
    expect(shown(rules("Ink"), "administrative", "outlineVisible")).toBe(false);
    expect(shown(rules("Ink"), ROOT, "labelsVisible")).toBe(false);
    expect(shown(rules("Figure-ground"), "road.local", "fillVisible")).toBe(false);
    expect(shown(rules("Figure-ground"), "landscape.man_made.building", "fillVisible")).toBe(true);
    // water is drawn faintly in both, to tell where one is
    for (const name of ["Ink", "Figure-ground"]) expect(treeFromRules(rules(name))!.water).toEqual({ fill: "#e4e4e4" });
    expect(shown(rules("Blueprint"), "road.highway", "outlineVisible")).toBe(false);
    expect(shown(rules("Blueprint"), "road", "iconsVisible")).toBe(false);
    expect(shown(rules("Blueprint"), "water", "labelsVisible")).toBe(true);
  });
});

describe("the monochrome styles", () => {
  const tree = (name: string) => treeFromRules(PRESET_STYLES.find((style) => style.name === name)!.style.rules)!;
  const light = tree("Mono light");
  const dark = tree("Mono dark");

  it("are greys only", () => {
    for (const style of [light, dark]) {
      for (const set of Object.values(style)) {
        for (const value of Object.values(set)) if (typeof value === "string") expect(value).toMatch(/^#(..)\1\1$/);
      }
    }
  });

  it("the dark one is the light one on a dark ground: the same things set, shown and hidden", () => {
    const shape = (style: typeof light) => Object.fromEntries(Object.entries(style).map(([id, set]) => [id, Object.fromEntries(Object.entries(set).map(([prop, value]) => [prop, typeof value === "string" ? "colour" : value]))]));
    expect(shape(dark)).toEqual(shape(light));
    expect(light.landscape.fill).toBe("#ffffff");
    expect(dark.landscape.fill).toBe("#141414");
    // what was darker than the land is now lighter than it, by as much
    const grey = (color: string) => parseInt(color.slice(1, 3), 16);
    for (const id of ["water", "road", "poi.park", "landscape.natural.landcover"]) {
      expect(grey(light[id].fill!)).toBeLessThan(grey(light.landscape.fill!));
      expect(grey(dark[id].fill!)).toBeGreaterThan(grey(dark.landscape.fill!));
    }
    expect(grey(dark.water.fill!)).toBeGreaterThan(grey(dark.road.fill!)); // water stands out most in both
  });

  it("draw no labels, railways or borders", () => {
    for (const name of ["Mono light", "Mono dark"]) {
      const { rules } = PRESET_STYLES.find((style) => style.name === name)!.style;
      expect(shown(rules, ROOT, "labelsVisible")).toBe(false);
      expect(shown(rules, "transit.line", "fillVisible")).toBe(false);
      expect(shown(rules, "administrative", "outlineVisible")).toBe(false);
      expect(shown(rules, "road.highway", "outlineVisible")).toBe(false);
      expect(shown(rules, "road.local", "fillVisible")).toBe(true);
    }
  });
});

describe("a style about buildings", () => {
  const figureGround = customOf(PRESET_STYLES.find((style) => style.name.startsWith("Figure-ground"))!, false);
  const standard = customOf(PRESET_STYLES[0], false);
  const at = (custom: CustomStyle, detailZoom: number, styleMode: "base" | "custom" = "custom") => styleIssues({ styleMode, custom, detailZoom });

  it("is warned about below the zoom at which the map has buildings", () => {
    expect(at(figureGround, 12.5)).toHaveLength(1);
    expect(at(figureGround, 12.5)[0]).toMatchObject({ level: "warning" });
    expect(at(figureGround, 12.5)[0].text).toContain("from zoom 14");
    expect(at(figureGround, 13)).toEqual([]);
    expect(at(figureGround, 15)).toEqual([]);
  });

  it("other styles are not, nor a base map", () => {
    expect(at(standard, 10)).toEqual([]);
    expect(at(figureGround, 10, "base")).toEqual([]);
    const hidden = { ...figureGround, rules: rulesFromTree({ "landscape.man_made.building": { fill: "#000000", fillVisible: false } }) };
    expect(at(hidden, 10)).toEqual([]);
  });
});

describe("where a custom style comes from", () => {
  const fromPreset = customOf(blueprint, false);
  const fromOwn = customOf(OWN[0], true);

  it("is found in the list it was taken from", () => {
    expect(sourceOf(fromPreset, OWN)).toBe(blueprint);
    expect(sourceOf(fromOwn, OWN)).toBe(OWN[0]);
    expect(sourceOf(fromOwn, [])).toBeNull(); // deleted since
    expect(sourceOf({ ...fromPreset, own: true }, OWN)).toBeNull(); // an own style may be named like one of the app's
    expect(sourceOf({ ...fromPreset, name: null }, OWN)).toBeNull();
  });

  it("is edited once its colours or its kind of map differ", () => {
    expect(isEdited(fromPreset, OWN)).toBe(false);
    expect(isEdited(fromOwn, OWN)).toBe(false);
    expect(isEdited({ ...fromPreset, rules: [...fromPreset.rules, ...OWN[0].style.rules] }, OWN)).toBe(true);
    expect(isEdited({ ...fromPreset, mapType: "topographic" }, OWN)).toBe(true);
    expect(isEdited({ ...fromOwn, name: null }, OWN)).toBe(true); // imported, never saved
    expect(isEdited(fromOwn, [])).toBe(true);
  });

  it("is brought back by loading what it began as: its colours, its kind of map and its terrain", () => {
    const hiking = PRESET_STYLES.find((style) => style.name === "Hiking map")!;
    const changed: CustomStyle = { ...customOf(hiking, false), mapType: "streets", rules: OWN[0].style.rules };
    expect(isEdited(changed, OWN)).toBe(true);
    const reset = loaded(sourceOf(changed, OWN)!, changed.own);
    expect(reset).toEqual({ custom: customOf(hiking, false), hillshade: 0.55, contours: true, contourColor: "#a0612f" });
    expect(isEdited(reset.custom, OWN)).toBe(false);
  });

  it("is kept with the terrain of the moment", () => {
    const custom: CustomStyle = { ...fromOwn, mapType: "topographic" };
    expect(docOf({ custom, hillshade: 0.4, contours: true, contourColor: "#112233" })).toEqual({
      mapType: "topographic",
      rules: OWN[0].style.rules,
      terrain: { hillshade: 0.4, contours: true, contourColor: "#112233" },
    });
  });

  it("has a name for people", () => {
    expect(styleName({ styleMode: "base", baseMap: "dark", custom: fromOwn })).toBe("Dark");
    expect(styleName({ styleMode: "custom", baseMap: "dark", custom: fromOwn })).toBe("Night");
    expect(styleName({ styleMode: "custom", baseMap: "dark", custom: { ...fromOwn, name: null } })).toBe("Custom style");
  });
});

describe("importing", () => {
  it("reads a style array from Snazzy Maps, for the street map", () => {
    const imported = importStyle(JSON.stringify(SNAZZY));
    expect(imported.mapType).toBe("streets");
    expect(imported.terrain).toBeNull(); // the terrain stays as it is
    expect(treeFromRules(imported.rules)).toMatchObject({ landscape: { fill: "#562135" }, water: { fill: "#e9b1cd" } });
  });

  it("reads a style saved by the app, as the file has it or just what is in it", () => {
    const doc = { mapType: "topographic", rules: OWN[0].style.rules, terrain: { hillshade: 0.3, contours: true, contourColor: "#ABCDEF" } };
    const expected = { mapType: "topographic", rules: OWN[0].style.rules, terrain: { hillshade: 0.3, contours: true, contourColor: "#abcdef" } };
    expect(importStyle(JSON.stringify(doc))).toEqual(expected);
    expect(importStyle(JSON.stringify({ name: "Night", style: doc }))).toEqual(expected);
  });

  it("says what is wrong", () => {
    expect(() => importStyle("  ")).toThrow(/nothing to import/);
    expect(() => importStyle("[{")).toThrow(/not valid JSON/);
    expect(() => importStyle('{"colour": "red"}')).toThrow(/no list of rules/);
    expect(() => importStyle('["water"]')).toThrow(/Rule 1/);
    expect(() => importStyle("42")).toThrow(/list of rules/);
  });
});

describe("styles from files", () => {
  it("are checked value by value", () => {
    expect(readStyleDoc({ mapType: "moon", rules: SNAZZY, terrain: { hillshade: 7, contours: "yes", contourColor: "red" } })).toEqual({
      mapType: "streets",
      rules: importStyle(JSON.stringify(SNAZZY)).rules,
      terrain: { hillshade: 1, contours: false, contourColor: "#000000" },
    });
    expect(readStyleDoc({ rules: "none" })).toBeNull();
    expect(readStyleDoc({ rules: [{ stylers: "x" }] })).toBeNull();
    expect(readStyleDoc(null)).toBeNull();
  });

  it("that are no styles are left out of the list", () => {
    const list = readNamedStyles([{ name: "Night", style: OWN[0].style }, { name: "Broken", style: {} }, { style: OWN[0].style }, "x"]);
    expect(list).toEqual(OWN);
    expect(readNamedStyles({ not: "a list" })).toEqual([]);
  });
});
