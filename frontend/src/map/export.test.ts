import { describe, expect, it } from "vitest";
import type { Bounds } from "../types";
import { MAX_SCALE, MIN_SCALE, chunking, exportIssues, marginTooNarrow, planExport, zoomRoom, zoomSummary } from "./export";
import { TILE, toBox } from "./geo";

const LONDON: Bounds = [-0.26, 51.44, 0.03, 51.57];

/** Plans of many sizes and detail levels: those that can be exported. */
const plans = () =>
  [1000, 1920, 3840, 7680, 12345, 31000]
    .flatMap((pixels) => [9, 11.5, 13, 14].map((zoom) => ({ zoom, plan: planExport(LONDON, zoom, { side: "width", pixels }) })))
    .filter(({ plan }) => plan.scale >= MIN_SCALE && plan.scale <= MAX_SCALE);

describe("planExport", () => {
  it("at scale 1 the image is the map at the detail zoom", () => {
    const plan = planExport(LONDON, 14, { side: "width", pixels: 6757 });
    const box = toBox(LONDON);
    expect(plan.width).toBe(6757);
    expect((box.x1 - box.x0) * TILE * 2 ** 14).toBeCloseTo(6757, 0);
    expect(Math.abs(plan.height - 4867)).toBeLessThanOrEqual(1);
    expect(plan.scale).toBeCloseTo(1, 3);
    expect(plan.megapixels).toBeCloseTo(32.9, 1);
  });

  it("the same area at a lower detail zoom gets a higher scale, not fewer pixels", () => {
    const fine = planExport(LONDON, 14, { side: "width", pixels: 6757 });
    const coarse = planExport(LONDON, 11, { side: "width", pixels: 6757 });
    expect([coarse.width, coarse.height]).toEqual([fine.width, fine.height]);
    expect(coarse.scale / fine.scale).toBeCloseTo(8, 6);
  });

  it("either side can be given", () => {
    const byWidth = planExport(LONDON, 12, { side: "width", pixels: 3840 });
    const byHeight = planExport(LONDON, 12, { side: "height", pixels: byWidth.height });
    expect(byHeight.height).toBe(byWidth.height);
    expect(Math.abs(byHeight.width - 3840)).toBeLessThanOrEqual(1);
  });

  it("a unit is whole pixels, and zoom and pixel ratio together give the exact scale", () => {
    expect(plans().length).toBeGreaterThan(15);
    for (const { zoom, plan } of plans()) {
      expect(Number.isInteger(plan.cssUnit)).toBe(true);
      expect(Number.isInteger(plan.unit)).toBe(true);
      expect(plan.pixelRatio * plan.cssUnit).toBeCloseTo(plan.unit, 9);
      // image pixels per world: rendered = asked for
      expect((2 ** plan.zoom * plan.pixelRatio) / (2 ** zoom * plan.scale)).toBeCloseTo(1, 9);
      // never below the detail zoom: layers that start at a zoom would vanish
      expect(plan.zoom).toBeGreaterThanOrEqual(zoom);
      expect(plan.zoom - zoom).toBeLessThan(0.012);
    }
  });
});

describe("chunking", () => {
  const at = (zoom: number, pixels: number) => planExport(LONDON, zoom, { side: "width", pixels });
  /** The margin in CSS pixels: what it is measured in, as names are. */
  const margin = (plan: ReturnType<typeof at>) => chunking(plan, true).margin * plan.cssUnit;

  it("the chunks cover the image, and the canvas for one is whole pixels and not too large", () => {
    for (const { plan } of plans()) {
      for (const labels of [false, true]) {
        const chunks = chunking(plan, labels);
        const chunk = chunks.side * plan.unit;
        expect(chunks.cols * chunk).toBeGreaterThanOrEqual(plan.width);
        expect((chunks.cols - 1) * chunk).toBeLessThan(plan.width);
        expect((chunks.rows - 1) * chunk).toBeLessThan(plan.height);
        expect(Number.isInteger(chunks.side) && Number.isInteger(chunks.margin)).toBe(true);
        // the canvas MapLibre makes for a chunk and its margin: floor(CSS size × pixel ratio)
        const units = chunks.side + 2 * chunks.margin;
        expect(Math.floor(units * plan.cssUnit * (plan.pixelRatio + 1e-6))).toBe(units * plan.unit);
        expect(units * plan.unit).toBeLessThanOrEqual(4096);
      }
    }
  });

  it("without labels the chunks have no margin: nothing depends on what is around it", () => {
    for (const { plan } of plans()) expect(chunking(plan, false).margin).toBe(0);
  });

  it("with labels every chunk gets a margin as wide as names are long", () => {
    const plan = at(13, 7680); // enlarged a good two times
    expect(chunking(plan, true)).toMatchObject({ side: chunking(plan, false).side, cols: 4, rows: 3 });
    expect(margin(plan)).toBeGreaterThanOrEqual(256);
    expect(margin(at(14, 20000))).toBeGreaterThanOrEqual(256); // and shrunk
    expect(marginTooNarrow(plan, chunking(plan, true))).toBe(false);
  });

  it("an image of one chunk has no seams, and needs none", () => {
    expect(chunking(at(13, 1920), true)).toEqual({ side: 8, margin: 0, cols: 1, rows: 1 });
    expect(marginTooNarrow(at(13, 1920), chunking(at(13, 1920), true))).toBe(false);
  });

  it("much enlarged, the chunks get smaller to leave room for the margin", () => {
    const plan = at(11, 7680); // enlarged nine times
    const chunks = chunking(plan, true);
    expect(chunks.side).toBe(4);
    expect(chunks.cols).toBe(chunking(plan, false).cols * 2);
    expect(margin(plan)).toBeGreaterThanOrEqual(128);
    expect(marginTooNarrow(plan, chunks)).toBe(false);
  });

  it("enlarged beyond that, no margin is wide enough, and it says so", () => {
    const plan = at(10, 7680); // enlarged eighteen times
    const chunks = chunking(plan, true);
    expect(chunks.side).toBe(8);
    expect(margin(plan)).toBeLessThan(128);
    expect(marginTooNarrow(plan, chunks)).toBe(true);
    expect(marginTooNarrow(plan, chunking(plan, false))).toBe(true); // asked of a map with labels only
  });
});

describe("exportIssues", () => {
  const issues = (zoom: number, pixels: number, format: "png" | "jpeg" = "png", labels = false) =>
    exportIssues(planExport(LONDON, zoom, { side: "width", pixels }), zoom, format, labels);
  const levels = (found: ReturnType<typeof issues>) => found.map((issue) => issue.level);

  it("a sensible export has none", () => {
    expect(issues(12, 7680)).toEqual([]);
  });

  it("an image far too small for its detail level cannot be made, and says what would work", () => {
    const found = issues(14, 1000);
    expect(planExport(LONDON, 14, { side: "width", pixels: 1000 }).scale).toBeLessThan(MIN_SCALE);
    expect(levels(found)).toContain("error");
    expect(found[0].text).toMatch(/at least 1,690 × 1,217 px/);
  });

  it("warns above what Premiere Pro imports", () => {
    expect(levels(issues(14, 20000))).toEqual(["warning"]); // 288 megapixels
    expect(levels(issues(14, 40000))).toContain("error"); // over 1,000 megapixels
  });

  it("mentions lost detail and the end of the map data", () => {
    expect(levels(issues(14, 4000))).toEqual(["info"]);
    expect(issues(16, 27028).some((issue) => issue.text.includes("zoom 15"))).toBe(true);
  });

  it("says when a low detail level is enlarged so much that it looks coarse", () => {
    expect(issues(11, 15360).some((issue) => issue.text.includes("coarse"))).toBe(true);
    expect(issues(13, 15360).some((issue) => issue.text.includes("coarse"))).toBe(false);
  });

  it("warns when names are so large that they may be cut where chunks meet", () => {
    const cut = (found: ReturnType<typeof issues>) => found.filter((issue) => issue.text.includes("cut off"));
    expect(cut(issues(10, 7680, "png", true)).map((issue) => issue.level)).toEqual(["warning"]);
    expect(cut(issues(10, 7680))).toEqual([]); // no labels, nothing to cut
    expect(cut(issues(11, 7680, "png", true))).toEqual([]);
    expect(issues(12, 7680, "png", true)).toEqual([]);
  });

  it("knows the limit of JPEG", () => {
    const wide: Bounds = [-10, 51.4, 10, 51.6];
    const plan = planExport(wide, 12, { side: "width", pixels: 70000 });
    expect(exportIssues(plan, 12, "jpeg").some((issue) => issue.text.includes("JPEG"))).toBe(true);
    expect(exportIssues(plan, 12, "png").some((issue) => issue.text.includes("JPEG"))).toBe(false);
  });
});

describe("what the size is good for", () => {
  const hd = { long: 1920, short: 1080 };

  it("is how far a frame can zoom in before it runs out of pixels", () => {
    expect(zoomRoom({ width: 7680, height: 4320 }, hd)).toBe(4);
    expect(zoomRoom({ width: 7680, height: 6000 }, hd)).toBe(4); // the width runs out first
    expect(zoomRoom({ width: 9000, height: 4320 }, hd)).toBe(4); // the height does
    expect(zoomRoom({ width: 4320, height: 7680 }, hd)).toBe(4); // an upright image, in an upright frame
  });

  it("is said in a line", () => {
    expect(zoomSummary({ width: 7680, height: 4320 })).toBe("lossless 4× zoom at 1080p, 2× at 4K");
    expect(zoomSummary({ width: 15360, height: 8640 })).toBe("lossless 8× zoom at 1080p, 4× at 4K");
    expect(zoomSummary({ width: 5000, height: 2812 })).toBe("lossless 2.6× zoom at 1080p, 1.3× at 4K");
    expect(zoomSummary({ width: 3000, height: 1688 })).toBe("lossless 1.5× zoom at 1080p");
    expect(zoomSummary({ width: 3840, height: 2160 })).toBe("lossless 2× zoom at 1080p, fills 4K");
    expect(zoomSummary({ width: 1920, height: 1080 })).toBe("fills 1080p");
    expect(zoomSummary({ width: 1600, height: 900 })).toBe("smaller than a 1080p frame");
    expect(zoomSummary({ width: 40000, height: 22500 })).toBe("lossless 20× zoom at 1080p, 10× at 4K");
  });

  it("is never rounded up", () => {
    expect(zoomSummary({ width: 5750, height: 3240 })).toBe("lossless 2.9× zoom at 1080p, 1.4× at 4K"); // 2.99 and 1.49
  });
});
