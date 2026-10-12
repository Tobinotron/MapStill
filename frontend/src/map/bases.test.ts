import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { BASES, TOPOGRAPHIC_LAYERS, offers, ownDefault, streetsLayers, streetsTarget } from "./bases";
import { applyGoogleStyle } from "./google-style";
import positron from "./positron-layers.fixture.json";
import { FEATURE_ROWS, ROOT, rulesFromTree, type Kind } from "./style-tree";

const { streets, topographic } = BASES;
const KINDS: Kind[] = ["fill", "outline", "text", "icons"];
const KIND_OF: Record<string, Kind> = { "geometry.fill": "fill", "geometry.stroke": "outline", "labels.text.fill": "text", "labels.icon": "icons" };

/** "feature kind" for everything a map says it draws. */
const declared = (draws: (feature: string, kind: Kind) => boolean) =>
  FEATURE_ROWS.flatMap((row) => KINDS.filter((kind) => draws(row.id, kind)).map((kind) => `${row.id} ${kind}`)).sort();

describe("the street map", () => {
  // the layers of OpenFreeMap's Positron style, as they were when this was written
  const layers = streetsLayers(positron as LayerSpecification[]);

  it("assigns the layers of Positron to features", () => {
    const target = (id: string) => streetsTarget(layers.find((layer) => layer.id === id)!);
    expect(target("background")).toEqual(["landscape.natural", "geometry.fill"]);
    expect(target("landcover_wood")).toEqual(["landscape.natural.landcover", "geometry.fill"]);
    expect(target("landcover_glacier")).toEqual(["landscape.natural.ice", "geometry.fill"]);
    expect(target("landcover_grass")).toEqual(["poi.park", "geometry.fill"]);
    expect(target("highway_major_casing")).toEqual(["road.arterial", "geometry.stroke"]);
    expect(target("highway_motorway_inner")).toEqual(["road.highway", "geometry.fill"]);
    expect(target("highway_minor")).toEqual(["road.local", "geometry.fill"]);
    expect(target("highway_path")).toEqual(["road.local.path", "geometry.fill"]);
    expect(target("railway_transit")).toEqual(["transit.line", "geometry.fill"]);
    expect(target("railway_dashline")).toEqual(["transit.line", "geometry.stroke"]);
    expect(target("building")).toEqual(["landscape.man_made.building", "geometry.fill"]);
    expect(target("boundary_2")).toEqual(["administrative", "geometry.stroke"]);
    expect(target("label_city")).toEqual(["administrative", "labels.text.fill"]);
    expect(target("highway-name-minor")).toEqual(["road.local", "labels.text.fill"]);
    expect(target("highway-name-path")).toEqual(["road.local.path", "labels.text.fill"]);
    expect(target("highway-shield-non-us")).toEqual(["road", "labels.icon"]);
    expect(target("water_name_point_label")).toEqual(["water", "labels.text.fill"]);
  });

  it("leaves no layer of Positron unassigned", () => {
    expect(layers.filter((layer) => !streetsTarget(layer)).map((layer) => layer.id)).toEqual([]);
  });

  it("says it draws exactly what its layers draw: the editor offers that, and no more", () => {
    const drawn = new Set(layers.map((layer) => streetsTarget(layer)!).map(([feature, element]) => `${feature} ${KIND_OF[element]}`));
    expect(declared(streets.draws)).toEqual([...drawn].sort());
  });

  it("starts from Google's colours", () => {
    expect(streets.defaultOf("water", "fill")).toBe("#a8cdf5");
    expect(streets.defaultOf("road.highway", "outline")).toBe("#e3b24a");
    expect(streets.defaultOf("road.local.path", "fill")).toBe("#ffffff"); // as local roads
    expect(streets.defaultOf("water", "text")).toBe("#4d4d4d");
    expect(streets.defaultOf("water", "outline")).toBeNull();
    expect(streets.defaultOf("poi.peak", "text")).toBeNull();
  });
});

describe("the topographic map", () => {
  // without its sources: making those needs a browser
  const style: StyleSpecification = { version: 8, sources: {}, layers: TOPOGRAPHIC_LAYERS };

  it("draws less than the street map, and peaks", () => {
    expect(declared(topographic.draws)).toEqual(
      [
        "administrative text",
        "landscape.man_made.building fill",
        "landscape.natural fill",
        "landscape.natural.ice fill",
        "landscape.natural.landcover fill",
        "poi.peak text",
        "road.arterial fill",
        "road.highway fill",
        "road.local fill",
        "road.local.path fill",
        "transit.line fill",
        "water fill",
      ].sort(),
    );
  });

  it("without rules, is drawn in its own colours", () => {
    const plain = applyGoogleStyle(style, [], topographic);
    const paint = (id: string) => (plain.layers.find((layer) => layer.id === id) as { paint: Record<string, unknown> }).paint;
    expect(paint("background")["background-color"]).toBe("#f3ecd9");
    expect(paint("path")).toEqual({ "line-color": "#b3261e", "line-width": 0.8, "line-dasharray": [3, 2] });
    expect(paint("landcover_wood")).toEqual({ "fill-color": "#8fae6b", "fill-opacity": 0.3 });
    expect(paint("peak")["text-color"]).toBe("#3a2c20");
    expect(paint("height-tint")).toEqual((style.layers.find((layer) => layer.id === "height-tint") as { paint: unknown }).paint);
    expect(topographic.defaultOf("road.local.path", "fill")).toBe("#b3261e");
    expect(topographic.defaultOf("poi.peak", "halo")).toBe("#f3ecd9");
    expect(topographic.defaultOf("poi.park", "fill")).toBeNull();
  });

  it("takes the same rules as the street map", () => {
    const rules = rulesFromTree({ road: { fill: "#ff0000" }, "road.local.path": { fillVisible: false }, [ROOT]: { text: "#00ff00" } });
    const styled = applyGoogleStyle(style, rules, topographic);
    const layer = (id: string) => styled.layers.find((l) => l.id === id) as { paint: Record<string, unknown>; layout?: Record<string, unknown> };
    for (const id of ["road_local", "road_main", "road_motorway"]) expect(layer(id).paint["line-color"]).toBe("#ff0000");
    expect(layer("path").layout?.visibility).toBe("none");
    expect(layer("rail").paint["line-color"]).toBe("#222222");
    expect(layer("peak").paint["text-color"]).toBe("#00ff00");
  });
});

describe("what the editor shows", () => {
  it("offers for a heading what anything below it draws", () => {
    expect(offers(streets, "road", "outline")).toBe(true);
    expect(offers(streets, "road", "icons")).toBe(true);
    expect(offers(streets, "water", "outline")).toBe(false);
    expect(offers(topographic, "road", "outline")).toBe(false);
    expect(offers(topographic, "poi.park", "fill")).toBe(false);
    expect(offers(topographic, ROOT, "text")).toBe(true);
  });

  it("shows a map's colour where what is below agrees, and none where it does not", () => {
    expect(ownDefault(streets, "water", "fill")).toBe("#a8cdf5");
    expect(ownDefault(streets, "road", "fill")).toBeNull(); // yellow motorways, white streets
    expect(ownDefault(streets, "road.local", "fill")).toBe("#ffffff");
    expect(ownDefault(streets, ROOT, "text")).toBe("#4d4d4d");
    expect(ownDefault(topographic, "road", "fill")).toBeNull(); // brown roads, red trails
    expect(ownDefault(topographic, "road.arterial", "fill")).toBe("#4a3b2c");
  });
});
