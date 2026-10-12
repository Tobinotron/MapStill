# MapStill

Renders a styled map of any area as one large image, for use in media projects:
pick a place, a style and a size, and export a PNG or JPEG. No screenshots, no
stitching.

Stack: Python 3.12 (FastAPI, Pillow, PyWebView) as the desktop shell, React + Vite +
MapLibre GL JS for everything that draws. The same layout as the sister project
MediaArchiver.

## Running it

```
cd frontend
npm install
npm run build
cd ..
uv run python main.py
```

Needs WebView2 (part of Windows 11) and an internet connection: the map is loaded
while the program runs.

| Command | What it does |
| --- | --- |
| `uv run python main.py` | The app, in its own window |
| `uv run python main.py --dev` | API on :8766, UI from `npm run dev` (hot reload) |
| `uv run python main.py --browser` | No window: opens the UI in the default browser |
| `uv run python main.py --self-test` | Checks the installation, no window |
| `uv run python packaging/build.py` | Builds the program into `build/dist/` |
| `uv run python packaging/build.py --install` | …and installs it for this user (Start menu) |

## Choosing the area

The area is the frame on the map. Dragging a corner resizes it around its centre;
with Alt the opposite corner stays instead, with Shift the shape is kept (both can
be combined). The handle in the middle moves it. The sidebar shows the same area as
a centre and a size in kilometres, and can fix the aspect ratio.

## How the image is made

The map is drawn from OpenStreetMap vector tiles (OpenFreeMap, free, no key), so
every colour is ours to choose and the map can be drawn at any size.

Two settings decide the picture, and they are independent:

- **Detail level** (a zoom): what is drawn and how thick, exactly as the map looks
  at that zoom. The numbers are those of Google and Snazzy Maps.
- **Size** in pixels. The area is fixed, so the size decides how much the map at
  that zoom is enlarged. The app says what the size is good for in a film
  ("lossless 4× zoom at 1080p").

A whole city at street detail is therefore simply a large image, which can be
zoomed into in an editor. Premiere Pro imports stills up to 256 megapixels and
32,768 px per side; the app warns above that.

A WebGL canvas cannot be that large, so an invisible second map draws the area in
chunks of about 2048 px, and the Python side pastes them into one image
(`frontend/src/map/export.ts`, `mapstill/stitch.py`).

Which names a map draws depends on what is around them, so two chunks would now and
then decide differently about a name on their seam, and it would be cut off there.
A map with labels is therefore drawn with a margin around each chunk (256 px of the
map, where the canvas has room for it), which is cut off again. The image is then
the same wherever the seams are: exports of the same map with two chunk sizes come
out identical, pixel for pixel.

## Styles

The style is either a base map or a custom style.

- **Base maps**: OpenFreeMap's own styles (Liberty, Bright, Positron, Dark, Fiord),
  used as they are.
- **Custom**: opens the style editor. A custom style is a set of colours for the
  features of the map (land, water, roads, railways, labels, …), applied to one of
  two kinds of map: a street map, or a topographic map made for mountains.
  What is set for a feature also holds for those below it (roads → main roads),
  unless they set their own.

In the editor, a style starts from a preset: one that comes with the app (Standard,
Mono light, Mono dark, Blueprint, Ink, Figure-ground, Hiking map), one of
your own, or an import. Imports
are a "JavaScript Style Array" from snazzymaps.com or a style saved by this app. Any
of them can be changed and saved under a name as a style of your own; the ones that
come with the app are never overwritten.

Custom styles are kept as Google style rules, the format of Snazzy Maps
(`frontend/src/map/google-style.ts`). The palette of an imported style is that of
the Snazzy style; the geometry is OpenStreetMap's, not Google's. Rules that derive
colours (hue, saturation, lightness, gamma) are turned into plain colours on import
(`frontend/src/map/style-tree.ts`); `weight` is ignored.

Terrain shading and contour lines (elevation from Mapterhorn) can be added to any
style, and are saved with a custom one.

## Where things are kept

Configurations, your own styles and the last-used settings are JSON files in
`%APPDATA%/mapstill` (`presets/*.json`, `styles/*.json`, `settings.json`); they
can be copied and edited by hand. A configuration is everything (place, style,
size); a style is only the look. (In the files and the code, configurations are
"presets", as they were called first.) Without a
save dialog (`--browser`), images go to `Pictures/MapStill`. Images are named
`mapstill-<width>x<height>` unless another name is given.

## Known limits

- A map with labels that is enlarged more than about 11 times has no room for a
  margin as wide as a name, and a name may be cut where two chunks meet. The app
  warns then; a higher detail level avoids it.
- The map data ends at zoom 15 (Google's numbering): above it, things get larger but
  nothing new appears.
- While the window is minimised, an export pauses (a web view draws nothing then).
- The image is held in memory while it is assembled: 3 GB at the limit of 1,000
  megapixels.

## Credit

Maps made with this must credit their sources when published:
© OpenStreetMap contributors, OpenFreeMap (and Mapterhorn, if terrain is shown).

## Layout

```
main.py                    desktop shell: API + PyWebView window
mapstill/                  the Python side
  app.py                     local API (presets, styles, exports, place search)
  stitch.py                  assembling the image from chunks
  store.py                   presets, own styles and settings as files
  geocode.py                 place search (Nominatim)
frontend/src/
  map/                       styles and their rules, the two kinds of map, terrain,
                             export, the live map
  ui/                        the sidebar and the style editor
packaging/                 PyInstaller recipe and build script
tests/                     Python tests (frontend tests are next to the code)
```

Checks: `uv run pytest`, `uv run ruff check .`, `uv run mypy`; in `frontend`:
`npm run check`.
