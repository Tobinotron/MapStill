// The only module that talks to the Python side: the local API, and the desktop
// shell's native dialogs. UI components call these functions; they never build URLs
// or handle tokens themselves.

import type { ImageFormat, NamedStyle, Place, Preset, Settings, StyleDoc } from "./types";

// The desktop shell opens the UI at `…/#token=<secret>`; the fragment never reaches
// the server's logs. Kept in sessionStorage so an in-app reload keeps working.
function readToken(): string {
  const match = /token=([^&]+)/.exec(window.location.hash);
  if (match) {
    sessionStorage.setItem("map-token", match[1]);
    history.replaceState(null, "", window.location.pathname);
    return match[1];
  }
  return sessionStorage.getItem("map-token") ?? "";
}

const TOKEN = readToken();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const binary = body instanceof Blob;
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "X-Map-Token": TOKEN,
      ...(body === undefined || binary ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: an error page from something in between
  }
  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : `The app's own server answered ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export const getSettings = () => request<unknown>("GET", "/settings");
export const putSettings = (settings: Settings) => request<void>("PUT", "/settings", settings);

/** How the window was left (ui/memory.ts). */
export const getWindow = () => request<unknown>("GET", "/window");
export const putWindow = (window: Record<string, unknown>) => request<void>("PUT", "/window", window);

export const getPresets = () => request<Preset[]>("GET", "/presets");
export const putPreset = (name: string, settings: Settings) => request<Preset>("PUT", "/presets", { name, settings });
export const deletePreset = (name: string) => request<void>("DELETE", `/presets?name=${encodeURIComponent(name)}`);

/** The user's own styles, as the files have them: to be checked before use. */
export const getStyles = () => request<unknown>("GET", "/styles");
/** Fails with status 409 if the name is taken and `overwrite` is not set. */
export const putStyle = (name: string, style: StyleDoc, overwrite: boolean) => request<NamedStyle>("PUT", "/styles", { name, style, overwrite });
export const deleteStyle = (name: string) => request<void>("DELETE", `/styles?name=${encodeURIComponent(name)}`);

export const findPlaces = (query: string) => request<Place[]>("GET", `/places?q=${encodeURIComponent(query)}`);

export interface ExportRequest {
  width: number;
  height: number;
  format: ImageFormat;
  /** Where to write the image; null: the app's exports folder, under `name`. */
  path: string | null;
  name: string;
}

export const startExport = (body: ExportRequest) => request<{ id: string; path: string }>("POST", "/exports", body);
export const putChunk = (id: string, x: number, y: number, png: Blob) =>
  request<void>("PUT", `/exports/${id}/chunks?x=${x}&y=${y}`, png);
export const finishExport = (id: string) => request<{ path: string; bytes: number }>("POST", `/exports/${id}/finish`);
export const cancelExport = (id: string) => request<void>("DELETE", `/exports/${id}`);
export const reveal = (path: string) => request<void>("POST", "/reveal", { path });

declare global {
  interface Window {
    pywebview?: { api?: { pick_save_path?(name: string, format: string): Promise<string | null> } };
  }
}

/**
 * Asks where to save an image. null: the user cancelled. undefined: there is no
 * dialog (the UI runs in a browser), and the image goes to the exports folder.
 */
export async function pickSavePath(name: string, format: ImageFormat): Promise<string | null | undefined> {
  const pick = window.pywebview?.api?.pick_save_path;
  return pick ? await pick(name, format) : undefined;
}
