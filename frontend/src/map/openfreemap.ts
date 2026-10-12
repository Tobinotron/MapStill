// OpenFreeMap: OpenStreetMap data as vector tiles, and styles for them. Free, no key.

import type { StyleSpecification } from "maplibre-gl";

export const OPENFREEMAP = "https://tiles.openfreemap.org";

const loading = new Map<string, Promise<StyleSpecification>>();

/** One of OpenFreeMap's styles ("positron", "liberty", …); loaded once. */
export function openFreeMapStyle(name: string): Promise<StyleSpecification> {
  let style = loading.get(name);
  if (!style) {
    style = fetch(`${OPENFREEMAP}/styles/${name}`).then(
      (response) => {
        if (!response.ok) throw new Error(`The map style could not be loaded (${response.status})`);
        return response.json() as Promise<StyleSpecification>;
      },
      () => {
        throw new Error("The map style could not be loaded. Is there an internet connection?");
      },
    );
    style.catch(() => loading.delete(name)); // try again next time
    loading.set(name, style);
  }
  return style;
}
