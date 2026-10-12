// What the window remembers between runs: which sections are folded away. Kept by
// the Python side as a file. (The browser's own storage would not do: the app is
// served from another port every time it starts, and that storage goes by address.)

import * as api from "../api";

type Memory = Record<string, unknown>;

let memory: Memory = {};

/** Reads what was remembered; to be awaited once, before the window is drawn. */
export async function loadMemory(): Promise<void> {
  try {
    const stored = await api.getWindow();
    memory = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Memory) : {};
  } catch {
    memory = {}; // without the Python side nothing is remembered
  }
}

const sections = (): Record<string, unknown> => {
  const stored = memory.sections;
  return stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
};

/** Whether a section was left open; null if it was never touched. */
export function sectionWasOpen(id: string): boolean | null {
  const open = sections()[id];
  return typeof open === "boolean" ? open : null;
}

export function rememberSection(id: string, open: boolean): void {
  memory = { ...memory, sections: { ...sections(), [id]: open } };
  void api.putWindow(memory).catch(() => {});
}
