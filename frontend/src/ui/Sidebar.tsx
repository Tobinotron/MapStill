// The left bar: everything that defines the image, from top to bottom in the order
// one usually decides it (where, how it looks, how large), and the export at the end.

import { Crosshair, Download, FolderOpen, Pencil, RotateCcw, Save, Scan, Search, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import * as api from "../api";
import { zoomSummary, type ExportIssue, type ExportPlan } from "../map/export";
import { areaOf, boundsOf, fromGoogleZoom, googleZoom, parseAspect, reshape, type Area as AreaShape } from "../map/geo";
import { BASE_MAPS, isEdited, loaded, sourceOf, styleName } from "../map/styles";
import { ASPECTS, DETAIL_ZOOM, SIZE } from "../settings";
import type { ExportState, NamedStyle, Place, Preset, Settings } from "../types";
import { Check, Field, NumberField, Section } from "./fields";
import StyleEditor from "./StyleEditor";
import { TerrainControls } from "./Terrain";

export interface SidebarProps {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  styleError: string | null;
  /** The zoom of the live map (a MapLibre zoom). */
  viewZoom: number;
  plan: ExportPlan;
  issues: ExportIssue[];
  presets: Preset[];
  onLoadPreset(preset: Preset): void;
  onSavePreset(name: string): Promise<void>;
  onDeletePreset(name: string): Promise<void>;
  /** The custom styles the user has saved. */
  ownStyles: NamedStyle[];
  onSaveStyle(name: string, overwrite: boolean): Promise<void>;
  onDeleteStyle(name: string): Promise<void>;
  onPlace(place: Place): void;
  onUseView(): void;
  onShowArea(): void;
  onViewAtDetail(): void;
  exportState: ExportState;
  onExport(): void;
  onCancelExport(): void;
}

const SIZE_PRESETS = [
  { label: "HD", pixels: 1920 },
  { label: "4K", pixels: 3840 },
  { label: "8K", pixels: 7680 },
  { label: "16K", pixels: 15360 },
];

const pixels = (n: number) => n.toLocaleString("en");
const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
const zoomLabel = (zoom: number) => String(Number(googleZoom(zoom).toFixed(1)));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A configuration is everything at once: place, style and image. (In the files and
// the API they are still "presets", as they were called first.)
function Configurations({ presets, onLoadPreset, onSavePreset, onDeletePreset }: SidebarProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = presets.find((preset) => preset.name === name);

  const run = (action: Promise<void>) => action.then(() => setError(null), (e) => setError(messageOf(e)));
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void run(onSavePreset(name.trim()));
  };

  return (
    <Section title="Configurations" open={false}>
      <p className="hint">Everything at once: the place, the style and the image size.</p>
      <select
        className="input"
        aria-label="Load a configuration"
        value={chosen ? chosen.name : ""}
        onChange={(event) => {
          const preset = presets.find((p) => p.name === event.target.value);
          if (!preset) return;
          setName(preset.name);
          onLoadPreset(preset);
        }}
      >
        <option value="">{presets.length ? "Load a configuration…" : "None saved yet"}</option>
        {presets.map((preset) => (
          <option key={preset.name}>{preset.name}</option>
        ))}
      </select>
      <form className="row" onSubmit={save}>
        <input className="input" placeholder="Name" aria-label="Configuration name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="button" type="submit" disabled={!name.trim()} title="Save everything as it is now under this name">
          <Save size={15} /> {chosen ? "Update" : "Save"}
        </button>
        <button
          className="button icon"
          type="button"
          disabled={!chosen}
          title="Delete this configuration"
          onClick={() => chosen && void run(onDeletePreset(chosen.name).then(() => setName("")))}
        >
          <Trash2 size={15} />
        </button>
      </form>
      {error && <p className="issue error">{error}</p>}
    </Section>
  );
}

function PlaceSearch({ onPlace }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ busy?: boolean; places?: Place[]; error?: string }>({});

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || state.busy) return;
    setState({ busy: true });
    api.findPlaces(query.trim()).then(
      (places) => setState({ places }),
      (error) => setState({ error: messageOf(error) }),
    );
  };

  return (
    <Section title="Place">
      <form className="row" onSubmit={search}>
        <input className="input" placeholder="e.g. London, New York, …" aria-label="Search for a place" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="button icon" type="submit" disabled={!query.trim() || state.busy} title="Search">
          <Search size={15} />
        </button>
      </form>
      {state.error && <p className="issue error">{state.error}</p>}
      {state.places?.length === 0 && <p className="hint">Nothing found.</p>}
      {state.places && state.places.length > 0 && (
        <ul className="places">
          {state.places.map((place) => (
            <li key={place.name}>
              <button
                type="button"
                onClick={() => {
                  onPlace(place);
                  setState({});
                }}
              >
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Style({ settings, update, styleError, ownStyles, onEdit }: SidebarProps & { onEdit(): void }) {
  const custom = settings.styleMode === "custom";
  const edited = isEdited(settings.custom, ownStyles);
  const source = sourceOf(settings.custom, ownStyles); // what a reset goes back to
  return (
    <Section title="Style" summary={styleName(settings)}>
      <div className="segments">
        <button type="button" className={custom ? "segment" : "segment on"} aria-pressed={!custom} onClick={() => update({ styleMode: "base" })}>
          Base maps
        </button>
        <button
          type="button"
          className={custom ? "segment on" : "segment"}
          aria-pressed={custom}
          title="Make the map your own: colours for roads, water, land and labels"
          onClick={() => {
            update({ styleMode: "custom" });
            onEdit();
          }}
        >
          Custom
        </button>
      </div>
      {custom ? (
        <div className="row">
          <span className="style-name">
            {styleName(settings)}
            {edited && <span className="hint"> ({source ? "edited" : "not saved"})</span>}
          </span>
          {edited && source && (
            <button
              type="button"
              className="button icon"
              title={`Undo all changes: back to “${source.name}” as it was`}
              aria-label="Reset the style"
              onClick={() => update(loaded(source, settings.custom.own))}
            >
              <RotateCcw size={15} />
            </button>
          )}
          <button type="button" className="button fit" onClick={onEdit}>
            <Pencil size={15} /> Edit
          </button>
        </div>
      ) : (
        <>
          <select className="input" aria-label="Base map" value={settings.baseMap} onChange={(event) => update({ baseMap: event.target.value })}>
            {BASE_MAPS.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <Check label="Labels" checked={settings.labels} onChange={(labels) => update({ labels })} />
        </>
      )}
      {styleError && <p className="issue error">{styleError}</p>}
      <h3 className="subhead">Terrain</h3>
      <TerrainControls settings={settings} update={update} />
    </Section>
  );
}

function Area({ settings, update, onUseView, onShowArea }: SidebarProps) {
  const area = areaOf(settings.bounds);
  const ratio = parseAspect(settings.aspect);
  const set = (patch: Partial<AreaShape>) => update({ bounds: boundsOf({ ...area, ...patch }) });
  // with a fixed aspect ratio, one side sets the other
  const setWidth = (widthKm: number) => set(ratio === null ? { widthKm } : { widthKm, heightKm: widthKm / ratio });
  const setHeight = (heightKm: number) => set(ratio === null ? { heightKm } : { heightKm, widthKm: heightKm * ratio });
  const setAspect = (aspect: string) => {
    const next = parseAspect(aspect);
    update({ aspect, bounds: next === null ? settings.bounds : reshape(settings.bounds, next) });
  };

  return (
    <Section title="Area" summary={`${area.widthKm.toFixed(1)} × ${area.heightKm.toFixed(1)} km`}>
      <p className="hint">
        On the map, drag a corner to resize the area around its centre. Hold Alt to move only that corner, Shift to keep the
        shape. The handle in the middle moves the area.
      </p>
      <div className="row">
        <button className="button" type="button" onClick={onUseView} title="Make the area what the map shows now">
          <Scan size={15} /> Use the view
        </button>
        <button className="button" type="button" onClick={onShowArea} title="Move the map to the area">
          <Crosshair size={15} /> Show the area
        </button>
      </div>
      <Field label="Aspect ratio">
        <select className="input" value={settings.aspect} onChange={(event) => setAspect(event.target.value)}>
          {ASPECTS.map((aspect) => (
            <option key={aspect} value={aspect}>
              {aspect === "free" ? "Free" : aspect}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Centre latitude">
          <NumberField value={area.lat} min={-85} max={85} digits={4} onCommit={(lat) => set({ lat })} />
        </Field>
        <Field label="Centre longitude">
          <NumberField value={area.lng} min={-180} max={180} digits={4} onCommit={(lng) => set({ lng })} />
        </Field>
        <Field label="Width (km)">
          <NumberField value={area.widthKm} min={0.01} max={40000} digits={2} onCommit={setWidth} />
        </Field>
        <Field label="Height (km)">
          <NumberField value={area.heightKm} min={0.01} max={40000} digits={2} onCommit={setHeight} />
        </Field>
      </div>
    </Section>
  );
}

function Output({ settings, update, viewZoom, plan, issues, onViewAtDetail }: SidebarProps) {
  const setSize = (side: "width" | "height", value: number) => update({ size: { side, pixels: value } });
  const matchView = () => {
    const zoom = Math.round(viewZoom / DETAIL_ZOOM.step) * DETAIL_ZOOM.step;
    update({ detailZoom: Math.min(Math.max(zoom, DETAIL_ZOOM.min), DETAIL_ZOOM.max) });
  };

  return (
    <Section title="Image" summary={`${pixels(plan.width)} × ${pixels(plan.height)} px`}>
      <Field
        label={`Detail level: zoom ${zoomLabel(settings.detailZoom)}`}
        hint={
          <>
            The image shows what the map shows at this zoom, however large the area is. Zoom numbers are those of Google and
            Snazzy Maps; the map is now at {zoomLabel(viewZoom)}.
          </>
        }
      >
        <input
          type="range"
          min={googleZoom(DETAIL_ZOOM.min)}
          max={googleZoom(DETAIL_ZOOM.max)}
          step={DETAIL_ZOOM.step}
          value={googleZoom(settings.detailZoom)}
          onChange={(event) => update({ detailZoom: fromGoogleZoom(Number(event.target.value)) })}
        />
      </Field>
      <div className="row">
        <button className="button" type="button" onClick={matchView} title="Use the zoom the map is at now">
          Match the view
        </button>
        <button className="button" type="button" onClick={onViewAtDetail} title="Zoom the map to the detail level, to see what the image will show">
          Preview it
        </button>
      </div>

      <div className="size">
        <Field label="Width">
          <NumberField value={plan.width} min={SIZE.min} max={SIZE.max} onCommit={(value) => setSize("width", value)} />
        </Field>
        <span className="times">×</span>
        <Field label="Height">
          <NumberField value={plan.height} min={SIZE.min} max={SIZE.max} onCommit={(value) => setSize("height", value)} />
        </Field>
        <span className="unit">px</span>
      </div>
      <div className="chips">
        {SIZE_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="chip" title={`${pixels(preset.pixels)} px wide`} onClick={() => setSize("width", preset.pixels)}>
            {preset.label}
          </button>
        ))}
      </div>
      <p className="summary">
        {plan.megapixels < 10 ? plan.megapixels.toFixed(1) : Math.round(plan.megapixels).toLocaleString("en")} megapixels · {zoomSummary(plan)}
      </p>
      {issues.map((issue) => (
        <p key={issue.text} className={`issue ${issue.level}`}>
          {issue.text}
        </p>
      ))}
      <Field label="Format">
        <select className="input" value={settings.format} onChange={(event) => update({ format: event.target.value === "jpeg" ? "jpeg" : "png" })}>
          <option value="png">PNG (lossless)</option>
          <option value="jpeg">JPEG (smaller)</option>
        </select>
      </Field>
    </Section>
  );
}

function Export({ exportState, issues, styleError, onExport, onCancelExport }: SidebarProps) {
  const busy = exportState.status === "rendering" || exportState.status === "saving";
  const blocked = styleError !== null || issues.some((issue) => issue.level === "error");
  return (
    <div className="export">
      {busy ? (
        <div className="progress-row">
          <div className="progress">
            {exportState.status === "rendering" ? (
              <>
                <progress value={exportState.done} max={exportState.total} />
                <span>
                  Drawing part {Math.min(exportState.done + 1, exportState.total)} of {exportState.total}
                </span>
              </>
            ) : (
              <>
                <progress />
                <span>Writing the file…</span>
              </>
            )}
          </div>
          <button className="button icon" type="button" onClick={onCancelExport} disabled={exportState.status === "saving"} title="Cancel">
            <X size={15} />
          </button>
        </div>
      ) : (
        <button className="button primary" type="button" disabled={blocked} onClick={onExport}>
          <Download size={16} /> Export image…
        </button>
      )}
      {exportState.status === "rendering" && <p className="hint">Keep this window open: while it is minimised, the export pauses.</p>}
      {exportState.status === "error" && <p className="issue error">{exportState.message}</p>}
      {exportState.status === "done" && (
        <div className="result">
          <p>
            Saved ({megabytes(exportState.bytes)}): <span className="path">{exportState.path}</span>
          </p>
          {exportState.failedTiles > 0 && (
            <p className="issue warning">
              {exportState.failedTiles} map tiles could not be loaded. Parts of the image may be empty; exporting again usually fixes it.
            </p>
          )}
          <button className="button" type="button" onClick={() => void api.reveal(exportState.path).catch(() => {})}>
            <FolderOpen size={15} /> Show in folder
          </button>
        </div>
      )}
      <p className="hint">
        When you publish the map, credit it: © OpenStreetMap contributors, OpenFreeMap{" "}
        <span className="nowrap">(and Mapterhorn for terrain)</span>.
      </p>
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  // the style editor takes the sidebar's place while a custom style is worked on
  const [editing, setEditing] = useState(false);
  if (editing && props.settings.styleMode === "custom") return <StyleEditor {...props} onClose={() => setEditing(false)} />;
  return (
    <aside className="sidebar">
      <div className="sections">
        <PlaceSearch {...props} />
        <Style {...props} onEdit={() => setEditing(true)} />
        <Area {...props} />
        <Output {...props} />
        <Configurations {...props} />
      </div>
      <Export {...props} />
    </aside>
  );
}
