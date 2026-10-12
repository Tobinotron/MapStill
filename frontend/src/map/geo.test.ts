import { describe, expect, it } from "vitest";
import type { Bounds } from "../types";
import { areaOf, aspectOf, atLeast, boundsOf, boxFromCentre, boxFromCorners, cover, inside, isBounds, latOf, lngOf, mercX, mercY, moveBox, parseAspect, reshape, toBounds, toBox } from "./geo";

const LONDON: Bounds = [-0.26, 51.44, 0.03, 51.57];

const contains = (outer: Bounds, inner: Bounds) =>
  outer[0] <= inner[0] + 1e-9 && outer[1] <= inner[1] + 1e-9 && outer[2] >= inner[2] - 1e-9 && outer[3] >= inner[3] - 1e-9;

describe("mercator", () => {
  it("puts the world in a unit square with north at the top", () => {
    expect(mercX(-180)).toBe(0);
    expect(mercX(180)).toBe(1);
    expect(mercY(0)).toBeCloseTo(0.5, 12);
    expect(mercY(60)).toBeLessThan(mercY(0));
    expect(mercY(85.051129)).toBeCloseTo(0, 6);
  });

  it("converts back", () => {
    expect(lngOf(mercX(11.07))).toBeCloseTo(11.07, 10);
    expect(latOf(mercY(47.42))).toBeCloseTo(47.42, 10);
    toBounds(toBox(LONDON)).forEach((value, i) => expect(value).toBeCloseTo(LONDON[i], 10));
  });
});

describe("aspect ratios", () => {
  it("are read from text", () => {
    expect(parseAspect("16:9")).toBeCloseTo(16 / 9);
    expect(parseAspect("free")).toBeNull();
    expect(parseAspect("16:0")).toBeNull();
  });

  it("reshape keeps centre and area", () => {
    const before = toBox(LONDON);
    const after = toBox(reshape(LONDON, 1));
    expect(aspectOf(reshape(LONDON, 1))).toBeCloseTo(1, 9);
    expect((after.x0 + after.x1) / 2).toBeCloseTo((before.x0 + before.x1) / 2, 12);
    expect((after.x1 - after.x0) * (after.y1 - after.y0)).toBeCloseTo((before.x1 - before.x0) * (before.y1 - before.y0), 15);
  });

  it("cover contains the area, inside is contained", () => {
    for (const ratio of [16 / 9, 9 / 16, 1]) {
      expect(aspectOf(cover(LONDON, ratio))).toBeCloseTo(ratio, 9);
      expect(contains(cover(LONDON, ratio), LONDON)).toBe(true);
      expect(aspectOf(inside(LONDON, ratio))).toBeCloseTo(ratio, 9);
      expect(contains(LONDON, inside(LONDON, ratio))).toBe(true);
    }
  });

  it("a point becomes an area around it, and a large area stays as it is", () => {
    const peak = toBox(atLeast([10.9862, 47.4212, 10.9863, 47.4213], 0.0004));
    expect(peak.x1 - peak.x0).toBeCloseTo(0.0004, 12);
    expect(peak.y1 - peak.y0).toBeCloseTo(0.0004, 12);
    expect(lngOf((peak.x0 + peak.x1) / 2)).toBeCloseTo(10.98625, 6);
    atLeast(LONDON, 0.0004).forEach((value, i) => expect(value).toBeCloseTo(LONDON[i], 10));
  });

  it("an area pushed over the edge of the world is moved back in", () => {
    const polar = cover([-170, 80, 170, 85], 1);
    expect(isBounds(polar)).toBe(true);
  });
});

describe("dragging", () => {
  const anchor = { x: 0.5, y: 0.5 };

  it("a free corner gives the box between the corners, in any direction", () => {
    expect(boxFromCorners(anchor, { x: 0.6, y: 0.7 }, null)).toEqual({ x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.7 });
    const flipped = boxFromCorners(anchor, { x: 0.4, y: 0.3 }, null);
    expect(flipped.x0).toBeCloseTo(0.4);
    expect(flipped.y0).toBeCloseTo(0.3);
    expect(flipped.x1).toBeCloseTo(0.5);
    expect(flipped.y1).toBeCloseTo(0.5);
  });

  it("a locked ratio is kept, and the anchor stays where it is", () => {
    const box = boxFromCorners(anchor, { x: 0.3, y: 0.45 }, 2);
    expect((box.x1 - box.x0) / (box.y1 - box.y0)).toBeCloseTo(2);
    expect(box.x1).toBeCloseTo(0.5);
    expect(box.y1).toBeCloseTo(0.5);
    expect(box.x0).toBeCloseTo(0.3);
  });

  it("around a fixed centre, the opposite corner mirrors the dragged one", () => {
    const box = boxFromCentre(anchor, { x: 0.6, y: 0.45 }, null);
    expect(box.x0).toBeCloseTo(0.4);
    expect(box.y0).toBeCloseTo(0.45);
    expect(box.x1).toBeCloseTo(0.6);
    expect(box.y1).toBeCloseTo(0.55);
  });

  it("around a fixed centre with a ratio, the centre and the ratio are both kept", () => {
    const box = boxFromCentre(anchor, { x: 0.6, y: 0.49 }, 4);
    expect((box.x1 - box.x0) / (box.y1 - box.y0)).toBeCloseTo(4);
    expect((box.x0 + box.x1) / 2).toBeCloseTo(0.5);
    expect((box.y0 + box.y1) / 2).toBeCloseTo(0.5);
    expect(box.x1).toBeCloseTo(0.6);
  });

  it("moving keeps the size", () => {
    const box = toBox(LONDON);
    const moved = moveBox(box, 0.2, 0.4);
    expect(moved.x1 - moved.x0).toBeCloseTo(box.x1 - box.x0, 15);
    expect((moved.x0 + moved.x1) / 2).toBeCloseTo(0.2, 12);
  });
});

describe("centre and size", () => {
  it("measures an area in kilometres at its latitude", () => {
    const area = areaOf(LONDON);
    expect(area.lng).toBeCloseTo(-0.115, 6);
    expect(area.lat).toBeGreaterThan(51.44);
    expect(area.lat).toBeLessThan(51.57);
    expect(area.widthKm).toBeCloseTo(20.1, 0); // 0.29° of longitude at 51.5° north
    expect(area.heightKm).toBeCloseTo(14.5, 0); // 0.13° of latitude
    expect(area.widthKm / area.heightKm).toBeCloseTo(aspectOf(LONDON), 9);
  });

  it("converts back", () => {
    boundsOf(areaOf(LONDON)).forEach((value, i) => expect(value).toBeCloseTo(LONDON[i], 9));
  });

  it("a new width leaves centre and height alone; a new centre keeps the size", () => {
    const area = areaOf(LONDON);
    const wider = areaOf(boundsOf({ ...area, widthKm: 40 }));
    expect(wider.widthKm).toBeCloseTo(40, 9);
    expect(wider.heightKm).toBeCloseTo(area.heightKm, 9);
    expect(wider.lat).toBeCloseTo(area.lat, 9);
    expect(wider.lng).toBeCloseTo(area.lng, 9);
    const moved = areaOf(boundsOf({ ...area, lat: 40.7, lng: -74 }));
    expect(moved.widthKm).toBeCloseTo(area.widthKm, 9);
    expect(moved.heightKm).toBeCloseTo(area.heightKm, 9);
    expect(moved.lat).toBeCloseTo(40.7, 9);
  });
});

describe("isBounds", () => {
  it("accepts areas and nothing else", () => {
    expect(isBounds(LONDON)).toBe(true);
    expect(isBounds([0.03, 51.44, -0.26, 51.57])).toBe(false);
    expect(isBounds([-0.26, 51.44, 0.03])).toBe(false);
    expect(isBounds([-0.26, 51.44, 0.03, 95])).toBe(false);
    expect(isBounds([-0.26, "51.44", 0.03, 51.57])).toBe(false);
    expect(isBounds(null)).toBe(false);
  });
});
