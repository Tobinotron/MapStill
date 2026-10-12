import { describe, expect, it } from "vitest";
import { SNAZZY } from "./map/snazzy.fixture";
import { ROOT, rulesFromTree, shown, treeFromRules } from "./map/style-tree";
import { DEFAULT_CUSTOM, PRESET_STYLES } from "./map/styles";
import { DEFAULT_SETTINGS, normalize } from "./settings";

describe("normalize", () => {
  it("gives the defaults for nothing, and keeps what is valid", () => {
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalize(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(normalize(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))).toEqual(DEFAULT_SETTINGS);
  });

  it("checks every value", () => {
    const odd = normalize({ styleMode: "moon", baseMap: "mars", hillshade: 9, contourColor: "red", detailZoom: 99, size: { side: "depth", pixels: 3.7 }, format: "gif", bounds: [1, 2] });
    expect(odd).toEqual({ ...DEFAULT_SETTINGS, hillshade: 1, detailZoom: 18, size: { side: "width", pixels: 16 } });
  });

  it("keeps a custom style, with its rules in the app's form", () => {
    const rules = rulesFromTree({ water: { fill: "#000033" } });
    const kept = normalize({ styleMode: "custom", custom: { name: "Night", own: true, mapType: "topographic", rules } });
    expect(kept.styleMode).toBe("custom");
    expect(kept.custom).toEqual({ name: "Night", own: true, mapType: "topographic", rules });
    // rules from elsewhere, written into a preset by hand
    expect(treeFromRules(normalize({ styleMode: "custom", custom: { rules: SNAZZY } }).custom.rules)).not.toBeNull();
    expect(normalize({ styleMode: "custom", custom: { rules: "none" } }).custom).toEqual(DEFAULT_CUSTOM);
  });
});

describe("settings of the first version", () => {
  const first = { labels: true, hillshade: 0.5, contours: false, contourColor: "#a0612f", aspect: "free", detailZoom: 15 };

  it("a base map stays a base map", () => {
    const now = normalize({ ...first, styleId: "dark", customStyle: "" });
    expect(now).toMatchObject({ styleMode: "base", baseMap: "dark", custom: DEFAULT_CUSTOM, hillshade: 0.5, detailZoom: 15 });
  });

  it("a palette becomes the preset style of that name", () => {
    for (const [id, name] of [["blueprint", "Blueprint"], ["ink", "Ink (roads only)"], ["figure-ground", "Figure-ground (buildings only)"], ["hiking", "Hiking map"]]) {
      const now = normalize({ ...first, styleId: id });
      expect(now.styleMode).toBe("custom");
      expect(now.custom).toMatchObject({ name, own: false, rules: PRESET_STYLES.find((style) => style.name === name)!.style.rules });
    }
    expect(normalize({ ...first, styleId: "hiking" }).custom.mapType).toBe("topographic");
  });

  it("a pasted style array becomes a custom style that is not saved yet", () => {
    const now = normalize({ ...first, styleId: "custom", customStyle: JSON.stringify(SNAZZY) });
    expect(now.styleMode).toBe("custom");
    expect(now.custom).toMatchObject({ name: null, own: false, mapType: "streets" });
    expect(treeFromRules(now.custom.rules)).toMatchObject({ landscape: { fill: "#562135" }, road: { fill: "#682145" } });
  });

  it("labels that were switched off stay off, now as part of the style", () => {
    const palette = normalize({ ...first, styleId: "blueprint", labels: false });
    expect(shown(palette.custom.rules, ROOT, "labelsVisible")).toBe(false);
    expect(shown(palette.custom.rules, "water", "labelsVisible")).toBe(false);
    const shownStill = normalize({ ...first, styleId: "blueprint", labels: true });
    expect(shown(shownStill.custom.rules, ROOT, "labelsVisible")).toBe(true);
  });

  it("a style array that never worked, or an unknown style, falls back to a base map or the plain style", () => {
    expect(normalize({ ...first, styleId: "custom", customStyle: "[{ oops" })).toMatchObject({ styleMode: "custom", custom: DEFAULT_CUSTOM });
    expect(normalize({ ...first, styleId: "watercolour" })).toMatchObject({ styleMode: "base", baseMap: "positron" });
  });
});
