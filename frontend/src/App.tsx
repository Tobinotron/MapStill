import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { ExportCancelled, chunking, drawsLabels, exportIssues, planExport, renderExport } from "./map/export";
import { atLeast, cover, inside, isBounds, parseAspect } from "./map/geo";
import MapPreview, { type MapHandle } from "./map/MapPreview";
import { buildStyle, docOf, readNamedStyles, styleIssues } from "./map/styles";
import { DEFAULT_SETTINGS, normalize } from "./settings";
import type { Bounds, ExportState, NamedStyle, Place, Preset, Settings } from "./types";
import { loadMemory } from "./ui/memory";
import Sidebar from "./ui/Sidebar";

// A place that is a point on the map (a peak, a monument) gets an area of this size:
// about 10 km in central Europe.
const MIN_PLACE_SIDE = 0.0004;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function App() {
  // null until the last session's settings are read
  const [settings, setSettings] = useState<Settings | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ownStyles, setOwnStyles] = useState<NamedStyle[]>([]);
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [viewZoom, setViewZoom] = useState(DEFAULT_SETTINGS.detailZoom);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const map = useRef<MapHandle>(null);
  const cancel = useRef<AbortController | null>(null);

  useEffect(() => {
    // without the Python side (a damaged installation) the app still draws maps
    // the window is drawn once both are read: the settings, and how the window was left
    const saved = api.getSettings().then(normalize, () => DEFAULT_SETTINGS);
    void Promise.all([saved, loadMemory()]).then(([read]) => setSettings(read));
    api.getPresets().then(setPresets, () => {});
    api.getStyles().then((styles) => setOwnStyles(readNamedStyles(styles)), () => {});
  }, []);

  // remember the settings for the next start; the last export is no longer what they describe
  useEffect(() => {
    if (!settings) return;
    setExportState((state) => (state.status === "done" || state.status === "error" ? { status: "idle" } : state));
    const timer = setTimeout(() => void api.putSettings(settings).catch(() => {}), 600);
    return () => clearTimeout(timer);
  }, [settings]);

  // the style follows the settings; a little later, so that typing and dragging a
  // slider do not rebuild it for every step
  const { styleMode, baseMap, custom, labels, hillshade, contours, contourColor } = settings ?? DEFAULT_SETTINGS;
  const ready = settings !== null;
  useEffect(() => {
    if (!ready) return;
    let current = true;
    const timer = setTimeout(() => {
      buildStyle({ styleMode, baseMap, custom, labels, hillshade, contours, contourColor }).then(
        (built) => {
          if (!current) return;
          setStyle(built);
          setStyleError(null);
        },
        (error) => current && setStyleError(messageOf(error)),
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ready, styleMode, baseMap, custom, labels, hillshade, contours, contourColor]);

  const plan = useMemo(
    () => (settings ? planExport(settings.bounds, settings.detailZoom, settings.size) : null),
    [settings],
  );

  if (!settings || !plan) return <div className="loading">Loading…</div>;

  const issues = [...styleIssues(settings), ...exportIssues(plan, settings.detailZoom, settings.format, style !== null && drawsLabels(style))];
  const ratio = parseAspect(settings.aspect);
  const update = (patch: Partial<Settings>) => setSettings((old) => (old ? { ...old, ...patch } : old));

  const loadPreset = (preset: Preset) => {
    const loaded = normalize(preset.settings);
    setSettings(loaded);
    map.current?.fit(loaded.bounds);
  };
  const savePreset = async (name: string) => {
    await api.putPreset(name, settings);
    setPresets(await api.getPresets());
  };
  const deletePreset = async (name: string) => {
    await api.deletePreset(name);
    setPresets(await api.getPresets());
  };
  const saveStyle = async (name: string, overwrite: boolean) => {
    const saved = await api.putStyle(name, docOf(settings), overwrite);
    setOwnStyles(readNamedStyles(await api.getStyles()));
    // what is being edited is now that style
    setSettings((old) => (old ? { ...old, custom: { ...old.custom, name: saved.name, own: true } } : old));
  };
  const deleteStyle = async (name: string) => {
    await api.deleteStyle(name);
    setOwnStyles(readNamedStyles(await api.getStyles()));
    // the style stays on the map, as one that is not saved
    setSettings((old) => (old && old.custom.own && old.custom.name === name ? { ...old, custom: { ...old.custom, name: null, own: false } } : old));
  };
  const goToPlace = (place: Place) => {
    if (!isBounds(place.bounds)) return;
    const area = atLeast(place.bounds, MIN_PLACE_SIDE);
    const bounds = ratio === null ? area : cover(area, ratio);
    update({ bounds });
    map.current?.fit(bounds);
  };
  const takeView = () => {
    const view = map.current?.view();
    if (!view) return;
    // a little smaller than the view, so that the frame can be seen and grabbed
    const [west, south, east, north] = view;
    const inset: Bounds = [
      west + (east - west) * 0.08,
      south + (north - south) * 0.08,
      east - (east - west) * 0.08,
      north - (north - south) * 0.08,
    ];
    if (isBounds(inset)) update({ bounds: ratio === null ? inset : inside(inset, ratio) });
  };

  const runExport = async () => {
    if (!style) return;
    const name = `mapstill-${plan.width}x${plan.height}`;
    const path = await api.pickSavePath(name, settings.format);
    if (path === null) return; // the dialog was cancelled
    const controller = new AbortController();
    cancel.current = controller;
    const chunks = chunking(plan, drawsLabels(style));
    setExportState({ status: "rendering", done: 0, total: chunks.cols * chunks.rows });
    let id: string | null = null;
    try {
      const started = await api.startExport({ width: plan.width, height: plan.height, format: settings.format, path: path ?? null, name });
      id = started.id;
      const failedTiles = await renderExport({
        style,
        bounds: settings.bounds,
        plan,
        chunks,
        onChunk: (png, x, y) => api.putChunk(started.id, x, y, png),
        onProgress: (done, total) => setExportState({ status: "rendering", done, total }),
        signal: controller.signal,
      });
      setExportState({ status: "saving" });
      const saved = await api.finishExport(started.id);
      setExportState({ status: "done", ...saved, failedTiles });
    } catch (error) {
      if (id) void api.cancelExport(id).catch(() => {});
      setExportState(error instanceof ExportCancelled ? { status: "idle" } : { status: "error", message: messageOf(error) });
    } finally {
      cancel.current = null;
    }
  };

  return (
    <div className="app">
      <Sidebar
        settings={settings}
        update={update}
        styleError={styleError}
        viewZoom={viewZoom}
        plan={plan}
        issues={issues}
        presets={presets}
        onLoadPreset={loadPreset}
        onSavePreset={savePreset}
        onDeletePreset={deletePreset}
        ownStyles={ownStyles}
        onSaveStyle={saveStyle}
        onDeleteStyle={deleteStyle}
        onPlace={goToPlace}
        onUseView={takeView}
        onShowArea={() => map.current?.fit(settings.bounds)}
        onViewAtDetail={() => map.current?.zoomTo(settings.detailZoom)}
        exportState={exportState}
        onExport={() => void runExport()}
        onCancelExport={() => cancel.current?.abort()}
      />
      <main className="stage">
        <MapPreview
          ref={map}
          style={style}
          bounds={settings.bounds}
          ratio={ratio}
          onBounds={(bounds) => update({ bounds })}
          onZoom={setViewZoom}
        />
      </main>
    </div>
  );
}
