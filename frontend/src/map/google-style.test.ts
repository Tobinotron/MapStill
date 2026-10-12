import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { applyGoogleStyle, defaultColor, hexToHsl, hslToHex, ownColor, parseGoogleStyle, resolve, type Canvas, type GoogleRule } from "./google-style";
import { SNAZZY } from "./snazzy.fixture";

const layer = (id: string, type: string, paint: object = {}) => ({ id, type, source: "s", "source-layer": "x", paint }) as unknown as LayerSpecification;

// a small map: each layer's id says what it stands for
const TARGETS: Record<string, [string, string]> = {
  land: ["landscape.natural", "geometry.fill"],
  water: ["water", "geometry.fill"],
  building: ["landscape.man_made.building", "geometry.fill"],
  street: ["road.local", "geometry.fill"],
  avenue: ["road.arterial", "geometry.fill"],
  avenue_casing: ["road.arterial", "geometry.stroke"],
  border: ["administrative", "geometry.stroke"],
  rail: ["transit.line", "geometry.fill"],
  city: ["administrative", "labels.text.fill"],
  shield: ["road", "labels.icon"],
};
const GOOGLE: Canvas = { target: (l) => TARGETS[l.id] ?? null, fallback: (_l, feature, element) => defaultColor(feature, element) };
const OWN: Canvas = { target: GOOGLE.target, fallback: (l, feature, element) => ownColor(l, element) ?? defaultColor(feature, element) };

const MAP: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: "land", type: "background", paint: { "background-color": "#f3ecd9" } },
    layer("water", "fill", { "fill-color": "rgb(194, 200, 202)" }),
    layer("building", "fill", { "fill-color": "#5d4c3f", "fill-outline-color": "#ccc" }),
    layer("street", "line", { "line-color": "#4a3b2c", "line-width": 2 }),
    layer("avenue_casing", "line"),
    layer("avenue", "line", { "line-color": ["interpolate", ["linear"], ["zoom"], 5, "#fff", 6, "#eee"] }),
    layer("border", "line"),
    layer("rail", "line"),
    layer("untouched", "line", { "line-color": "#123456" }),
    layer("city", "symbol", { "text-color": "#2a1f16", "text-halo-color": "#f3ecd9" }),
    layer("shield", "symbol"),
  ],
};

const byId = (style: StyleSpecification, id: string) => {
  const found = style.layers.find((l) => l.id === id) as { layout?: Record<string, unknown>; paint?: Record<string, unknown> };
  return { visible: found.layout?.visibility !== "none", paint: found.paint ?? {} };
};

describe("colours", () => {
  it("convert to HSL and back", () => {
    for (const hex of ["#000000", "#ffffff", "#562135", "#e9b1cd", "#46bcec", "#808080"]) {
      expect(hslToHex(hexToHsl(hex)!)).toBe(hex);
    }
    expect(hslToHex(hexToHsl("#fa0")!)).toBe("#ffaa00");
    expect(hexToHsl("red")).toBeNull();
  });
});

describe("resolve", () => {
  it("lets the more specific rule that comes later win", () => {
    expect(resolve(SNAZZY, "landscape.natural", "geometry.fill", "#ffffff")).toEqual({ visibility: "on", color: "#562135" });
    expect(resolve(SNAZZY, "landscape.man_made", "geometry.fill", "#ffffff").color).toBe("#3d0a24");
    expect(resolve(SNAZZY, "road.local", "geometry.fill", "#ffffff").color).toBe("#55223c");
    expect(resolve(SNAZZY, "road.arterial", "geometry.fill", "#ffffff").color).toBe("#682145");
  });

  it("follows visibility through the rules", () => {
    expect(resolve(SNAZZY, "water", "geometry.fill", "#a8cdf5")).toEqual({ visibility: "on", color: "#e9b1cd" });
    expect(resolve(SNAZZY, "water", "labels.text.fill", "#000000").visibility).toBe("off");
    expect(resolve(SNAZZY, "transit.line", "geometry.fill", "#cccccc")).toEqual({ visibility: "simplified", color: "#d3055c" });
    expect(resolve(SNAZZY, "transit.station.airport", "geometry.fill", "#cccccc").visibility).toBe("off");
  });

  it("adjusts the default colour when a style only shifts it", () => {
    const grey: GoogleRule[] = [{ stylers: [{ saturation: -100 }] }];
    expect(resolve(grey, "water", "geometry.fill", "#a8cdf5").color).toMatch(/^#(..)\1\1$/);
    const lighter: GoogleRule[] = [{ featureType: "road", stylers: [{ lightness: 100 }] }];
    expect(resolve(lighter, "road.local", "geometry.fill", "#336699").color).toBe("#ffffff");
    const inverted: GoogleRule[] = [{ stylers: [{ invert_lightness: true }] }];
    expect(resolve(inverted, "landscape", "geometry.fill", "#ffffff").color).toBe("#000000");
    const hue: GoogleRule[] = [{ stylers: [{ hue: "#ff0000" }] }];
    expect(resolve(hue, "water", "geometry.fill", "#0000ff").color).toBe("#ff0000");
  });

  it("more saturation makes a colour stronger, and leaves a grey grey", () => {
    const stronger: GoogleRule[] = [{ stylers: [{ saturation: 50 }] }];
    expect(resolve(stronger, "road", "geometry.fill", "#dddddd").color).toBe("#dddddd");
    const [, before] = hexToHsl("#a8cdf5")!;
    const [, after] = hexToHsl(resolve(stronger, "water", "geometry.fill", "#a8cdf5").color)!;
    expect(after).toBeGreaterThan(before);
  });

  it("ignores what it does not understand", () => {
    const odd = [{ featureType: "water", stylers: [{ color: "blue" }, { visibility: "maybe" }, { weight: 3 }] }] as GoogleRule[];
    expect(resolve(odd, "water", "geometry.fill", "#a8cdf5")).toEqual({ visibility: "on", color: "#a8cdf5" });
  });
});

describe("applyGoogleStyle", () => {
  const styled = applyGoogleStyle(MAP, SNAZZY, GOOGLE);

  it("colours the layers", () => {
    expect(byId(styled, "land").paint["background-color"]).toBe("#562135");
    expect(byId(styled, "water").paint["fill-color"]).toBe("#e9b1cd");
    expect(byId(styled, "building").paint["fill-color"]).toBe("#3d0a24");
    expect(byId(styled, "street").paint).toEqual({ "line-width": 2, "line-color": "#55223c" });
    expect(byId(styled, "avenue").paint["line-color"]).toBe("#682145");
    expect(byId(styled, "rail").paint["line-color"]).toBe("#d3055c");
  });

  it("hides what the style hides: labels, icons, and outlines of simplified roads", () => {
    expect(byId(styled, "city").visible).toBe(false);
    expect(byId(styled, "shield").visible).toBe(false);
    expect(byId(styled, "avenue_casing").visible).toBe(false);
    expect(byId(styled, "avenue").visible).toBe(true);
    expect(byId(styled, "building").paint["fill-outline-color"]).toBeUndefined();
  });

  it("keeps borders under “simplified”: they are nothing but outline", () => {
    const simplified = applyGoogleStyle(MAP, [{ stylers: [{ visibility: "simplified" }] }], GOOGLE);
    expect(byId(simplified, "border").visible).toBe(true);
    expect(byId(simplified, "avenue_casing").visible).toBe(false);
  });

  it("leaves alone the layers the map does not assign, and the map itself", () => {
    expect(byId(styled, "untouched").paint).toEqual({ "line-color": "#123456" });
    expect(byId(MAP, "water").paint["fill-color"]).toBe("rgb(194, 200, 202)");
    expect(MAP.layers).toHaveLength(11);
  });

  it("without rules, starts from Google's colours or from the map's own, as the map says", () => {
    const google = applyGoogleStyle(MAP, [], GOOGLE);
    expect(byId(google, "water").paint["fill-color"]).toBe("#a8cdf5");
    expect(byId(google, "avenue_casing").visible).toBe(true);
    expect(byId(google, "city").paint["text-color"]).toBe("#4d4d4d");

    const own = applyGoogleStyle(MAP, [], OWN);
    expect(byId(own, "building").paint["fill-color"]).toBe("#5d4c3f");
    expect(byId(own, "street").paint["line-color"]).toBe("#4a3b2c");
    expect(byId(own, "city").paint).toEqual({ "text-color": "#2a1f16", "text-halo-color": "#f3ecd9" });
    // not a plain colour in the map: Google's default takes its place
    expect(byId(own, "avenue").paint["line-color"]).toBe("#ffffff");
  });
});

describe("parseGoogleStyle", () => {
  it("reads a style array", () => {
    expect(parseGoogleStyle(JSON.stringify(SNAZZY))).toEqual(SNAZZY);
  });

  it("says what is wrong", () => {
    expect(() => parseGoogleStyle("[{")).toThrow(/not valid JSON/);
    expect(() => parseGoogleStyle('{"stylers": []}')).toThrow(/list of rules/);
    expect(() => parseGoogleStyle('[{"stylers": {}}]')).toThrow(/Rule 1/);
    expect(() => parseGoogleStyle('[{"stylers": []}, "water"]')).toThrow(/Rule 2/);
  });
});
