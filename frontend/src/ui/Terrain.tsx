import type { Terrain as TerrainSettings } from "../types";
import { Check, Field, Section } from "./fields";

interface Props {
  settings: TerrainSettings;
  update(patch: Partial<TerrainSettings>): void;
}

/** Shading and contour lines: drawn over any style, and kept with a custom one. */
export function TerrainControls({ settings, update }: Props) {
  return (
    <>
      <Field label={`Shading ${settings.hillshade > 0 ? `${Math.round(settings.hillshade * 100)}%` : "off"}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.hillshade}
          onChange={(event) => update({ hillshade: Number(event.target.value) })}
        />
      </Field>
      <div className="row">
        <Check label="Contour lines" checked={settings.contours} onChange={(contours) => update({ contours })} />
        <input
          type="color"
          className="swatch"
          aria-label="Colour of the contour lines"
          disabled={!settings.contours}
          value={settings.contourColor}
          onChange={(event) => update({ contourColor: event.target.value })}
        />
      </div>
    </>
  );
}

/** The terrain as a section of its own (in the style editor). */
export default function Terrain(props: Props) {
  return (
    <Section title="Terrain" id="editor-terrain">
      <TerrainControls {...props} />
    </Section>
  );
}
