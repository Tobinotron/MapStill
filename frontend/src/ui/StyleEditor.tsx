// The editor for custom styles. It takes the place of the sidebar while it is open;
// the map next to it shows every change at once.
//
// From top to bottom: a style to start from (one that comes with the app, one of the
// user's own, or an import), the features of the map with what can be set for each,
// the terrain, and at the bottom the name to keep the style under.

import { ArrowLeft, ChevronDown, ChevronRight, Eye, EyeOff, FileUp, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../api";
import { BASES, offers, ownDefault, type Base } from "../map/bases";
import {
  COLOR_PROPS,
  FEATURE_ROWS,
  KIND,
  colorsUsed,
  inherited,
  normalizeColor,
  rulesFromTree,
  shown,
  treeOf,
  withProp,
  type ColorProp,
  type FeatureRow,
  type FeatureStyle,
  type FlagProp,
  type Kind,
  type StyleTree,
} from "../map/style-tree";
import { PRESET_STYLES, importStyle, isEdited, loaded, sourceOf, type Imported } from "../map/styles";
import type { MapType, NamedStyle, Settings } from "../types";
import { Field, Section } from "./fields";
import Terrain from "./Terrain";

export interface StyleEditorProps {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  styleError: string | null;
  ownStyles: NamedStyle[];
  /** Keeps the style under a name. Rejects with status 409 if the name is taken and `overwrite` is not set. */
  onSaveStyle(name: string, overwrite: boolean): Promise<void>;
  onDeleteStyle(name: string): Promise<void>;
  onClose(): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const RECENT_KEPT = 12;

// --- one colour ----------------------------------------------------------------------------

interface ColorFieldProps {
  label: string;
  /** The colour set here; null if this follows what applies above. */
  value: string | null;
  /** The colour drawn; null if what is below has different ones. */
  drawn: string | null;
  /** Called while the colour is being picked (`picking`), and when one is typed. */
  onColor(color: string, picking: boolean): void;
  /** The field was emptied: no colour is set here any more. */
  onClear(): void;
  onPicked(): void;
  onFocus(): void;
}

function ColorField({ label, value, drawn, onColor, onClear, onPicked, onFocus }: ColorFieldProps) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const picker = useRef<HTMLInputElement>(null);
  const picked = useRef(onPicked);
  picked.current = onPicked;
  // "change" fires when the colour picker is closed; React's onChange is every step in it
  useEffect(() => {
    const input = picker.current;
    const done = () => picked.current();
    input?.addEventListener("change", done);
    return () => input?.removeEventListener("change", done);
  }, []);

  const commit = () => {
    const color = normalizeColor(text);
    if (color && color !== value) onColor(color, false);
    else if (text.trim() === "" && value !== null) onClear();
    else setText(value ?? "");
  };

  return (
    <>
      <label className={drawn ? "color-chip" : "color-chip varies"} style={drawn ? { background: drawn } : undefined} title="Pick a colour">
        <input
          ref={picker}
          type="color"
          aria-label={label}
          value={drawn ?? "#888888"}
          onFocus={onFocus}
          onClick={onFocus}
          onChange={(event) => onColor(event.target.value, true)}
        />
      </label>
      <input
        className="input hex"
        aria-label={`${label} (hex)`}
        spellCheck={false}
        placeholder={drawn ?? "varies"}
        title="A colour as #rrggbb. Empty: the colour that is set above applies."
        value={text}
        onFocus={onFocus}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      />
    </>
  );
}

// --- one feature ---------------------------------------------------------------------------

const COLOR_LABEL: Record<ColorProp, string> = { fill: "Colour", outline: "Outline", text: "Label text", halo: "Label outline" };
// what switches a colour's thing on and off (label outlines go with the labels)
const FLAG_OF: Partial<Record<ColorProp, FlagProp>> = { fill: "fillVisible", outline: "outlineVisible", text: "labelsVisible" };

/** The colour a feature shows for a property, and whether it is set there. */
function colorAt(tree: StyleTree, base: Base, id: string, prop: ColorProp) {
  const from = inherited(tree, id, prop);
  return {
    own: tree[id]?.[prop] ?? null,
    drawn: from ? from.color : ownDefault(base, id, prop),
    from: from && from.from.id !== id ? from.from.name : null,
  };
}

interface FeatureProps {
  row: FeatureRow;
  tree: StyleTree;
  base: Base;
  isShown(id: string, flag: FlagProp): boolean;
  palette: { used: string[]; before: string[] };
  setColor(id: string, prop: ColorProp, color: string, picking: boolean): void;
  onPicked(): void;
  setFlag(id: string, flag: FlagProp, value: boolean): void;
  /** Makes these of the feature what they are in the style that was loaded. */
  reset(id: string, props: Array<ColorProp | FlagProp>): void;
  /** No colour is set for this of the feature any more: the one set above applies. */
  clear(id: string, prop: ColorProp): void;
  /** What the style that was loaded sets for this feature, and that style's name (null: it was never saved). */
  original: FeatureStyle;
  originalName: string | null;
}

function FeatureSettings({ row, tree, base, isShown, palette, setColor, onPicked, setFlag, reset, clear, original, originalName }: FeatureProps) {
  const colors = COLOR_PROPS.filter((prop) => offers(base, row.id, KIND[prop]));
  const [active, setActive] = useState<ColorProp | null>(colors[0] ?? null);
  const set = tree[row.id] ?? {};

  const toggle = (flag: FlagProp) => (
    <button
      type="button"
      className={isShown(row.id, flag) ? "button icon small" : "button icon small off"}
      title={isShown(row.id, flag) ? "Shown. Click to hide." : "Hidden. Click to show."}
      aria-pressed={isShown(row.id, flag)}
      onClick={() => setFlag(row.id, flag, !isShown(row.id, flag))}
    >
      {isShown(row.id, flag) ? <Eye size={14} /> : <EyeOff size={14} />}
    </button>
  );
  const resetButton = (props: Array<ColorProp | FlagProp>) => (
    <button
      type="button"
      className="button icon small"
      title={originalName ? `Reset: as in “${originalName}”` : "Reset: follow what is set above"}
      disabled={props.every((prop) => set[prop] === original[prop])}
      onClick={() => reset(row.id, props)}
    >
      <RotateCcw size={14} />
    </button>
  );
  const swatches = (title: string, list: string[]) =>
    list.length > 0 && (
      <div className="palette-row">
        <span className="hint">{title}</span>
        <span className="swatches">
          {list.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch-button"
              style={{ background: color }}
              title={color}
              aria-label={`Use ${color}`}
              onClick={() => active && setColor(row.id, active, color, false)}
            />
          ))}
        </span>
      </div>
    );

  return (
    <div className="feature-settings">
      {colors.map((prop) => {
        const { own, drawn, from } = colorAt(tree, base, row.id, prop);
        const flag = FLAG_OF[prop];
        return (
          <div key={prop} className="prop-group">
            <div className={flag && !isShown(row.id, flag) ? "prop hidden" : "prop"}>
              <span className="prop-label" title={from ? `Set for “${from}”` : undefined}>
                {COLOR_LABEL[prop]}
              </span>
              <ColorField
                label={`${row.name}: ${COLOR_LABEL[prop].toLowerCase()}`}
                value={own}
                drawn={drawn}
                onColor={(color, picking) => setColor(row.id, prop, color, picking)}
                onClear={() => clear(row.id, prop)}
                onPicked={onPicked}
                onFocus={() => setActive(prop)}
              />
              {flag ? toggle(flag) : <span className="spacer" />}
              {resetButton(flag ? [prop, flag] : [prop])}
            </div>
            {active === prop && (palette.used.length > 0 || palette.before.length > 0) && (
              <div className="palette">
                {swatches("In this style", palette.used)}
                {swatches("Used before", palette.before)}
              </div>
            )}
          </div>
        );
      })}
      {offers(base, row.id, "icons") && (
        <div className={isShown(row.id, "iconsVisible") ? "prop" : "prop hidden"}>
          <span className="prop-label wide">Road numbers</span>
          {toggle("iconsVisible")}
          {resetButton(["iconsVisible"])}
        </div>
      )}
    </div>
  );
}

// --- the editor ----------------------------------------------------------------------------

const KINDS: Kind[] = ["fill", "outline", "text", "icons"];
// the colours that say most about a feature at a glance, in the list
const CHIPS: ColorProp[] = ["fill", "outline", "text"];

export default function StyleEditor({ settings, update, styleError, ownStyles, onSaveStyle, onDeleteStyle, onClose }: StyleEditorProps) {
  const { custom } = settings;
  const base = BASES[custom.mapType];
  const tree = useMemo(() => treeOf(custom.rules), [custom.rules]);
  const source = sourceOf(custom, ownStyles);
  const original = useMemo<StyleTree>(() => (source ? treeOf(source.style.rules) : {}), [source]);
  const edited = isEdited(custom, ownStyles);

  const [open, setOpen] = useState<string | null>(null);
  const [before, setBefore] = useState<string[]>([]); // colours that were replaced, newest first
  const [pending, setPending] = useState<{ run(): void } | null>(null); // waits for "discard my changes"
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(custom.own && custom.name ? custom.name : "");
  const [taken, setTaken] = useState<string | null>(null); // what the app said about a name in use
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const picking = useRef<string | null>(null); // the colour being dragged around in a picker

  useEffect(() => {
    setName(custom.own && custom.name ? custom.name : "");
    setDeleting(false);
  }, [custom.name, custom.own]);

  const setTree = (next: StyleTree) => update({ custom: { ...custom, rules: rulesFromTree(next) } });
  const setFlag = (id: string, flag: FlagProp, value: boolean) => setTree(withProp(tree, id, flag, value));
  // a replaced colour stays at hand, under "Used before"
  const keep = (color: string | undefined) => {
    if (color) setBefore((list) => [color, ...list.filter((c) => c !== color)].slice(0, RECENT_KEPT));
  };
  const clear = (id: string, prop: ColorProp) => {
    keep(tree[id]?.[prop]);
    setTree(withProp(tree, id, prop, undefined));
  };
  // Reset means: as in the style that was loaded. (A style that was never saved has
  // nothing to go back to; there it means that nothing is set.)
  const reset = (id: string, props: Array<ColorProp | FlagProp>) => {
    for (const prop of props) {
      const now = tree[id]?.[prop];
      if (typeof now === "string" && now !== original[id]?.[prop]) keep(now);
    }
    setTree(props.reduce((next, prop) => withProp(next, id, prop, original[id]?.[prop]), tree));
  };
  const setColor = (id: string, prop: ColorProp, color: string, isPicking: boolean) => {
    const key = `${id}|${prop}`;
    const replaced = tree[id]?.[prop];
    // one pick is many steps: only the colour it started from is worth remembering
    if (replaced !== color && picking.current !== key) keep(replaced);
    picking.current = isPicking ? key : null;
    setTree(withProp(tree, id, prop, color));
  };
  const used = colorsUsed(tree);
  const palette = { used, before: before.filter((color) => !used.includes(color)) };

  /** Does something that replaces the style; asks first if that loses changes. */
  const replacing = (run: () => void) => {
    setNote(null);
    setTaken(null);
    if (edited && custom.rules.length > 0) setPending({ run });
    else run();
  };
  const load = (named: NamedStyle, own: boolean) => update(loaded(named, own));
  const loadImported = (style: Imported) =>
    update({ custom: { name: null, own: false, mapType: style.mapType, rules: style.rules }, ...style.terrain });

  const choose = (key: string) => {
    const [kind, ...rest] = key.split(":");
    const named = (kind === "own" ? ownStyles : PRESET_STYLES).find((style) => style.name === rest.join(":"));
    if (named) replacing(() => load(named, kind === "own"));
  };
  const applyImport = (text: string) => {
    try {
      const style = importStyle(text);
      setImportError(null);
      replacing(() => {
        loadImported(style);
        setImporting(false);
        setImportText("");
      });
    } catch (error) {
      setImportError(messageOf(error));
    }
  };

  const sameAsLoaded = custom.own && source !== null && name.trim().toLowerCase() === source.name.toLowerCase();
  const save = (overwrite: boolean) => {
    setNote(null);
    onSaveStyle(name.trim(), overwrite).then(
      () => {
        setTaken(null);
        setNote({ error: false, text: "Saved." });
      },
      (error) => {
        if (error instanceof ApiError && error.status === 409) setTaken(sentence(error.message));
        else setNote({ error: true, text: messageOf(error) });
      },
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) save(sameAsLoaded);
  };

  const rows = FEATURE_ROWS.filter((row) => KINDS.some((kind) => offers(base, row.id, kind)));
  const isShown = (id: string, flag: FlagProp) => shown(custom.rules, id, flag);
  const chip = (row: FeatureRow, prop: ColorProp): ReactNode => {
    if (!offers(base, row.id, KIND[prop])) return null;
    const { drawn } = colorAt(tree, base, row.id, prop);
    const flag = FLAG_OF[prop];
    const hidden = flag !== undefined && !isShown(row.id, flag);
    return <span key={prop} className={`chip-color${drawn ? "" : " varies"}${hidden ? " off" : ""}`} style={drawn ? { background: drawn } : undefined} />;
  };

  return (
    <aside className="sidebar editor">
      <header className="editor-head">
        <button type="button" className="button" onClick={onClose}>
          <ArrowLeft size={15} /> Done
        </button>
        <h1>Custom style</h1>
      </header>

      <div className="sections">
        <Section title="Presets" id="editor-presets">
          <div className="row">
            <select
              className="input"
              aria-label="Style presets"
              value={source ? `${custom.own ? "own" : "preset"}:${source.name}` : ""}
              onChange={(event) => choose(event.target.value)}
            >
              {!source && <option value="">{custom.name ?? "Imported style"}</option>}
              <optgroup label="Preset Styles">
                {PRESET_STYLES.map((style) => (
                  <option key={style.name} value={`preset:${style.name}`}>
                    {style.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Own Styles">
                {ownStyles.length === 0 && <option disabled>None yet: save one below</option>}
                {ownStyles.map((style) => (
                  <option key={style.name} value={`own:${style.name}`}>
                    {style.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              className="button icon"
              title="Delete this style of your own"
              disabled={!custom.own || !source}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={15} />
            </button>
          </div>
          {edited && !pending && !source && <p className="hint">Not saved yet.</p>}
          {edited && !pending && source && (
            <div className="row">
              <span className="hint grow">Changed since it was loaded.</span>
              <button type="button" className="button fit" title={`Undo all changes: back to “${source.name}” as it was`} onClick={() => load(source, custom.own)}>
                <RotateCcw size={15} /> Reset
              </button>
            </div>
          )}
          {deleting && source && (
            <div className="confirm">
              <p>Delete “{source.name}”? This cannot be undone.</p>
              <button type="button" className="button danger" onClick={() => void onDeleteStyle(source.name).catch((error) => setNote({ error: true, text: messageOf(error) }))}>
                Delete
              </button>
              <button type="button" className="button" onClick={() => setDeleting(false)}>
                Keep
              </button>
            </div>
          )}
          {pending && (
            <div className="confirm">
              <p>Your changes to this style are not saved. Replacing it loses them.</p>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  pending.run();
                  setPending(null);
                }}
              >
                Replace
              </button>
              <button type="button" className="button" onClick={() => setPending(null)}>
                Keep editing
              </button>
            </div>
          )}
          {importing ? (
            <div className="import">
              <Field label="Paste a style" hint="A “JavaScript Style Array” from snazzymaps.com, or a style saved by this app.">
                <textarea
                  className="input code"
                  rows={5}
                  spellCheck={false}
                  placeholder='[{ "featureType": "water", "stylers": [{ "color": "#e9b1cd" }] }]'
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                />
              </Field>
              {importError && <p className="issue error">{importError}</p>}
              <div className="row">
                <button type="button" className="button" disabled={!importText.trim()} onClick={() => applyImport(importText)}>
                  Apply
                </button>
                <label className="button" title="Read the style from a file">
                  <FileUp size={15} /> From a file…
                  <input
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = ""; // the same file can be chosen again
                      void file?.text().then(applyImport, (error) => setImportError(messageOf(error)));
                    }}
                  />
                </label>
                <button type="button" className="button" onClick={() => setImporting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="button" onClick={() => setImporting(true)}>
              <FileUp size={15} /> Import JSON…
            </button>
          )}
        </Section>

        <Section title="Map" id="editor-map">
          <select
            className="input"
            aria-label="Kind of map"
            value={custom.mapType}
            onChange={(event) => update({ custom: { ...custom, mapType: event.target.value as MapType } })}
          >
            {Object.values(BASES).map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </select>
          <p className="hint">{base.note}</p>
          {styleError && <p className="issue error">{styleError}</p>}
        </Section>

        <Section title="Colours" id="editor-colours">
          <p className="hint">What is set for a feature also holds for those below it, unless they set their own.</p>
          <ul className="features">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={open === row.id ? "feature open" : "feature"}
                  style={{ paddingLeft: 6 + row.depth * 14 }}
                  aria-expanded={open === row.id}
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                >
                  {open === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="feature-name">{row.name}</span>
                  {tree[row.id] && <span className="dot" title="Has settings of its own" />}
                  <span className="chips-color">{CHIPS.map((prop) => chip(row, prop))}</span>
                </button>
                {open === row.id && (
                  <FeatureSettings
                    row={row}
                    tree={tree}
                    base={base}
                    isShown={isShown}
                    palette={palette}
                    setColor={setColor}
                    onPicked={() => (picking.current = null)}
                    setFlag={setFlag}
                    reset={reset}
                    clear={clear}
                    original={original[row.id] ?? {}}
                    originalName={source?.name ?? null}
                  />
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Terrain settings={settings} update={update} />
      </div>

      <form className="export" onSubmit={submit}>
        <div className="row">
          <input
            className="input"
            placeholder="Name for your style"
            aria-label="Style name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setTaken(null);
              setNote(null);
            }}
          />
          <button className="button primary inline" type="submit" disabled={!name.trim()} title="Keep this style among your own styles">
            <Save size={15} /> {sameAsLoaded ? "Update" : "Save"}
          </button>
        </div>
        {taken && (
          <div className="confirm">
            <p>{taken}. Saving replaces it.</p>
            <button type="button" className="button danger" onClick={() => save(true)}>
              Overwrite
            </button>
            <button type="button" className="button" onClick={() => setTaken(null)}>
              Cancel
            </button>
          </div>
        )}
        {note && <p className={note.error ? "issue error" : "hint"}>{note.text}</p>}
      </form>
    </aside>
  );
}
