// Small form parts shared by the sidebar's sections.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { rememberSection, sectionWasOpen } from "./memory";

interface SectionProps {
  title: string;
  /** What the open state is remembered under; the title, if this is not given. */
  id?: string;
  /** Whether the section is open the first time it is shown. */
  open?: boolean;
  /** What the section holds, in a few words: shown while it is folded away. */
  summary?: string;
  children: ReactNode;
}

/** A part of the sidebar. A click on its title folds it away, and that is remembered. */
export function Section({ title, id = title, open: openAtFirst = true, summary, children }: SectionProps) {
  const [open, setOpen] = useState(() => sectionWasOpen(id) ?? openAtFirst);
  const toggle = () => {
    rememberSection(id, !open);
    setOpen(!open);
  };
  return (
    <section className={open ? "section" : "section closed"}>
      <h2>
        <button type="button" className="section-head" aria-expanded={open} onClick={toggle}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{title}</span>
          {!open && summary && <span className="section-summary">{summary}</span>}
        </button>
      </h2>
      {open && children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

interface NumberFieldProps {
  value: number;
  onCommit(value: number): void;
  min: number;
  max: number;
  /** Digits after the decimal point. */
  digits?: number;
  ariaLabel?: string;
}

/**
 * A number that is typed freely and takes effect on Enter or when the field is left:
 * while typing "3840", the map does not jump through 3, 38 and 384.
 */
export function NumberField({ value, onCommit, min, max, digits = 0, ariaLabel }: NumberFieldProps) {
  const shown = value.toFixed(digits);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const typed = Number(text.replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(typed)) return setText(shown);
    const next = Number(Math.min(Math.max(typed, min), max).toFixed(digits));
    setText(next.toFixed(digits));
    // only what was changed: leaving the field must not round the value behind it
    if (next.toFixed(digits) !== shown) onCommit(next);
  };

  return (
    <input
      className="input"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
    />
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
