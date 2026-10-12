// MapLibre parses tiles in a worker and looks for the worker's script next to its
// own file. Bundled into the app there is no such file, so Vite ships the script as
// an asset and MapLibre is told where it is.

import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
