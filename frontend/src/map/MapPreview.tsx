// The live map, with the area to export drawn on it: everything outside is dimmed,
// the corners resize the area (around its centre; Alt and Shift as in drawing
// programs) and the handle in the middle moves it.

import type { FeatureCollection } from "geojson";
import { Map as MapLibreMap, Marker, NavigationControl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Bounds } from "../types";
import { boxFromCentre, boxFromCorners, clampBox, latOf, lngOf, mercX, mercY, moveBox, toBounds, toBox, type Box } from "./geo";

export interface MapHandle {
  /** Show this area, with some room around it. */
  fit(bounds: Bounds): void;
  /** The area the map shows now. */
  view(): Bounds;
  zoomTo(zoom: number): void;
}

interface Props {
  style: StyleSpecification | null;
  bounds: Bounds;
  /** Width / height the area keeps while it is resized; null: any. */
  ratio: number | null;
  onBounds(bounds: Bounds): void;
  onZoom(zoom: number): void;
  ref?: Ref<MapHandle>;
}

const FRAME = "export-frame";
const EMPTY: StyleSpecification = { version: 8, sources: {}, layers: [] };

/** The dimmed surroundings (the world with the area cut out) and the area's outline. */
function frameData(bounds: Bounds): FeatureCollection {
  const [west, south, east, north] = bounds;
  const area = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  const world = [[-180, -85.06], [180, -85.06], [180, 85.06], [-180, 85.06], [-180, -85.06]];
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { part: "outside" }, geometry: { type: "Polygon", coordinates: [world, area] } },
      { type: "Feature", properties: { part: "outline" }, geometry: { type: "LineString", coordinates: area } },
    ],
  };
}

/** The style with the frame drawn on top; only the preview shows it. */
function withFrame(style: StyleSpecification, bounds: Bounds): StyleSpecification {
  const outline = ["==", ["get", "part"], "outline"];
  return {
    ...style,
    sources: { ...style.sources, [FRAME]: { type: "geojson", data: frameData(bounds) } },
    layers: [
      ...style.layers,
      {
        id: `${FRAME}-outside`,
        type: "fill",
        source: FRAME,
        filter: ["==", ["get", "part"], "outside"],
        paint: { "fill-color": "#000000", "fill-opacity": 0.4 },
      },
      { id: `${FRAME}-shadow`, type: "line", source: FRAME, filter: outline, paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": 4 } },
      { id: `${FRAME}-line`, type: "line", source: FRAME, filter: outline, paint: { "line-color": "#ffffff", "line-width": 1.5 } },
    ] as StyleSpecification["layers"],
  };
}

// corners in the order of `corner()`: north-west, north-east, south-east, south-west
const corner = (box: Box, i: number) => ({ x: i === 0 || i === 3 ? box.x0 : box.x1, y: i < 2 ? box.y0 : box.y1 });
const lngLat = (point: { x: number; y: number }): [number, number] => [lngOf(point.x), latOf(point.y)];
const centre = (box: Box) => ({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });

const RESIZE_TIP = "Drag to resize the area around its centre. Alt: only this corner moves. Shift: keep the shape.";

function handle(className: string, title: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.title = title;
  return element;
}

export default function MapPreview({ style, bounds, ratio, onBounds, onZoom, ref }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const showFrame = useRef<(bounds: Bounds) => void>(() => {});
  // the handlers below live as long as the map; they read the latest props from here
  const latest = useRef({ bounds, ratio, onBounds, onZoom });
  latest.current = { bounds, ratio, onBounds, onZoom };

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: EMPTY,
      bounds: latest.current.bounds,
      fitBoundsOptions: { padding: 60 },
      maxZoom: 20,
      dragRotate: false,
      boxZoom: false, // Shift belongs to resizing the area
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const corners = [0, 1, 2, 3].map((i) =>
      new Marker({ element: handle(`frame-handle ${i % 2 ? "frame-nesw" : "frame-nwse"}`, RESIZE_TIP), draggable: true })
        .setLngLat([0, 0])
        .addTo(map),
    );
    const mover = new Marker({ element: handle("frame-handle frame-mover", "Drag to move the area"), draggable: true })
      .setLngLat([0, 0])
      .addTo(map);

    const show = (next: Bounds) => {
      const box = toBox(next);
      corners.forEach((marker, i) => marker.setLngLat(lngLat(corner(box, i))));
      mover.setLngLat(lngLat(centre(box)));
      (map.getSource(FRAME) as GeoJSONSource | undefined)?.setData(frameData(next));
    };
    showFrame.current = show;
    show(latest.current.bounds);

    // A drag: how to make the new area from where the pointer is, given the area as
    // it was when the drag began. Kept so that pressing or releasing Alt or Shift
    // takes effect at once, without moving the mouse.
    type Point = { x: number; y: number };
    let drag: { pointer: Point; area(pointer: Point): Box } | null = null;
    const keys = { alt: false, shift: false };
    const redraw = () => {
      if (!drag) return;
      const next = toBounds(clampBox(drag.area(drag.pointer)));
      show(next); // also puts the dragged handle where the corner of the area really is
      latest.current.onBounds(next);
    };
    const dragWith = (marker: Marker, area: (start: Box) => (pointer: Point) => Box) => {
      marker.on("dragstart", () => (drag = { pointer: { x: 0, y: 0 }, area: area(toBox(latest.current.bounds)) }));
      marker.on("drag", () => {
        if (!drag) return;
        const at = marker.getLngLat(); // where the pointer has just put the handle
        drag.pointer = { x: mercX(at.lng), y: mercY(at.lat) };
        redraw();
      });
      marker.on("dragend", () => {
        redraw();
        drag = null;
      });
    };
    corners.forEach((marker, i) =>
      dragWith(marker, (start) => {
        const shape = (start.x1 - start.x0) / (start.y1 - start.y0);
        return (pointer) => {
          // the usual keys: the area grows around its centre, Alt lets go of the centre
          // (the opposite corner stays instead), Shift keeps the shape
          const keep = latest.current.ratio ?? (keys.shift ? shape : null);
          return keys.alt ? boxFromCorners(corner(start, (i + 2) % 4), pointer, keep) : boxFromCentre(centre(start), pointer, keep);
        };
      }),
    );
    dragWith(mover, (start) => (pointer) => moveBox(start, pointer.x, pointer.y));

    // A drag that lost its end (the window lost the focus while the button was down)
    // must not linger: the next Shift typed anywhere would resize the area.
    const abandon = () => (drag = null);
    const onKey = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof MouseEvent && event.type === "mousemove" && event.buttons === 0) abandon();
      // Alt on its own opens the window menu on Windows; not in the middle of a drag
      if (drag && event instanceof KeyboardEvent && event.key === "Alt") event.preventDefault();
      if (keys.alt === event.altKey && keys.shift === event.shiftKey) return;
      keys.alt = event.altKey;
      keys.shift = event.shiftKey;
      redraw();
    };
    const KEY_EVENTS = ["keydown", "keyup", "mousedown", "mousemove"] as const;
    KEY_EVENTS.forEach((type) => window.addEventListener(type, onKey, true));
    window.addEventListener("blur", abandon);

    const zoomed = () => latest.current.onZoom(map.getZoom());
    map.on("zoomend", zoomed);
    map.on("load", zoomed);

    return () => {
      KEY_EVENTS.forEach((type) => window.removeEventListener(type, onKey, true));
      window.removeEventListener("blur", abandon);
      mapRef.current = null;
      showFrame.current = () => {};
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (style) mapRef.current?.setStyle(withFrame(style, latest.current.bounds), { diff: true });
  }, [style]);

  useEffect(() => showFrame.current(bounds), [bounds]);

  useImperativeHandle(ref, () => ({
    fit: (area) => mapRef.current?.fitBounds(area, { padding: 60, duration: 600 }),
    view: () => (mapRef.current?.getBounds().toArray().flat() as Bounds | undefined) ?? latest.current.bounds,
    zoomTo: (zoom) => mapRef.current?.easeTo({ zoom, duration: 600 }),
  }));

  return <div ref={container} className="map" />;
}
