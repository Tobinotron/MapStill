"""Local HTTP API between the UI and the Python side.

The UI draws the map and decides everything about it; this side does what a web view
cannot: keep presets and settings as files, write large images, search for places.

Security: the server listens on 127.0.0.1 only, requires a per-launch token (header
``X-Map-Token``), and rejects foreign ``Host`` headers (DNS rebinding).
"""

from __future__ import annotations

import mimetypes
import re
import secrets
import subprocess
import sys
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import VERSION, geocode
from .stitch import SUFFIXES, ExportError, ExportImage, check_size, unused_path
from .store import NameTaken, Store, exports_dir

TOKEN_HEADER = "X-Map-Token"

# Windows takes file types from the registry, where other programs can set .js to
# text/plain; a browser refuses to run scripts (and module workers) served like that.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


def _reveal(path: Path) -> None:
    """Show the file in the system's file manager."""
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", str(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])


@dataclass
class AppContext:
    token: str | None = None  # None disables the check (tests only)
    store: Store = field(default_factory=Store)
    exports_dir: Path = field(default_factory=exports_dir)
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost", "testserver")
    search: Callable[[str], list[dict[str, Any]]] = geocode.search  # tests: fake
    reveal: Callable[[Path], None] = _reveal  # tests: fake
    export: ExportImage | None = None  # one at a time
    export_id: str | None = None
    exported: set[Path] = field(default_factory=set)  # files this run wrote (for reveal)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def close(self) -> None:
        with self.lock:
            if self.export is not None:
                self.export.close()
            self.export = self.export_id = None


class PresetIn(BaseModel):
    name: str = Field(min_length=1)
    settings: dict[str, Any]


class StyleIn(BaseModel):
    name: str = Field(min_length=1)
    style: dict[str, Any]
    overwrite: bool = False  # replace a style that has this name


class ExportIn(BaseModel):
    width: int
    height: int
    format: Literal["png", "jpeg"] = "png"
    path: str | None = None  # from the save dialog; None: the exports folder
    name: str = "map"  # the file name to use in the exports folder


class RevealIn(BaseModel):
    path: str


def _file_name(name: str) -> str:
    """``name`` without what a file name must not contain."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f\s]+', " ", name).strip(" .")[:120] or "map"


def create_app(ctx: AppContext, static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="MapStill", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def guard(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        host = (request.headers.get("host") or "").rsplit(":", 1)[0]
        if host not in ctx.allowed_hosts:
            return PlainTextResponse("forbidden host", status_code=403)
        if request.url.path.startswith("/api/") and ctx.token is not None:
            given = request.headers.get(TOKEN_HEADER, "")
            if not secrets.compare_digest(given.encode(), ctx.token.encode()):
                return JSONResponse({"detail": "missing or wrong token"}, status_code=401)
        return await call_next(request)

    @app.exception_handler(ExportError)
    async def export_error(_request: Request, exc: ExportError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=400)

    def current_export(export_id: str) -> ExportImage:
        if ctx.export is None or ctx.export_id != export_id:
            raise HTTPException(404, "this export is no longer running")
        return ctx.export

    @app.get("/api/app")
    def app_info() -> dict[str, Any]:
        return {"version": VERSION, "exports_dir": str(ctx.exports_dir)}

    # --- settings and presets ------------------------------------------------------------------

    @app.get("/api/settings")
    def get_settings() -> dict[str, Any] | None:
        return ctx.store.settings()

    @app.put("/api/settings")
    def put_settings(settings: dict[str, Any]) -> None:
        ctx.store.save_settings(settings)

    @app.get("/api/window")
    def get_window() -> dict[str, Any] | None:
        return ctx.store.window()

    @app.put("/api/window")
    def put_window(window: dict[str, Any]) -> None:
        ctx.store.save_window(window)

    @app.get("/api/presets")
    def get_presets() -> list[dict[str, Any]]:
        return ctx.store.presets()

    @app.put("/api/presets")
    def put_preset(preset: PresetIn) -> dict[str, Any]:
        try:
            return ctx.store.save_preset(preset.name, preset.settings)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.delete("/api/presets")
    def delete_preset(name: str = Query()) -> None:
        if not ctx.store.delete_preset(name):
            raise HTTPException(404, f"there is no preset “{name}”")

    @app.get("/api/styles")
    def get_styles() -> list[dict[str, Any]]:
        return ctx.store.styles()

    @app.put("/api/styles")
    def put_style(body: StyleIn) -> dict[str, Any]:
        try:
            return ctx.store.save_style(body.name, body.style, body.overwrite)
        except NameTaken as exc:
            raise HTTPException(409, f"there is already a style “{exc.existing}”") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.delete("/api/styles")
    def delete_style(name: str = Query()) -> None:
        if not ctx.store.delete_style(name):
            raise HTTPException(404, f"there is no style “{name}”")

    # --- places --------------------------------------------------------------------------------

    @app.get("/api/places")
    def places(q: str = Query(min_length=1, max_length=200)) -> list[dict[str, Any]]:
        try:
            return ctx.search(q)
        except geocode.GeocodeError as exc:
            raise HTTPException(502, str(exc)) from exc

    # --- exports -------------------------------------------------------------------------------

    @app.post("/api/exports")
    def start_export(body: ExportIn) -> dict[str, Any]:
        check_size(body.width, body.height, body.format)
        suffixes = SUFFIXES[body.format]
        if body.path:
            path = Path(body.path)
            if path.suffix.lower() not in suffixes:
                path = path.with_name(path.name + suffixes[0])
        else:
            path = unused_path(ctx.exports_dir / (_file_name(body.name) + suffixes[0]))
        try:
            export = ExportImage(body.width, body.height, body.format, path)
        except MemoryError as exc:
            raise ExportError("not enough memory for an image of this size") from exc
        with ctx.lock:
            if ctx.export is not None:
                ctx.export.close()  # an export the UI abandoned
            ctx.export, ctx.export_id = export, secrets.token_urlsafe(8)
            return {"id": ctx.export_id, "path": str(path)}

    @app.put("/api/exports/{export_id}/chunks")
    async def add_chunk(
        export_id: str, request: Request, x: int = Query(), y: int = Query()
    ) -> None:
        export = current_export(export_id)
        png = await request.body()
        await run_in_threadpool(export.add_chunk, x, y, png)

    @app.post("/api/exports/{export_id}/finish")
    def finish_export(export_id: str) -> dict[str, Any]:
        with ctx.lock:
            export = current_export(export_id)
            ctx.export = ctx.export_id = None
        try:
            size = export.save()
        except OSError as exc:
            raise ExportError(f"the image could not be written: {exc}") from exc
        ctx.exported.add(export.path)
        return {"path": str(export.path), "bytes": size}

    @app.delete("/api/exports/{export_id}")
    def cancel_export(export_id: str) -> None:
        with ctx.lock:
            if ctx.export is not None and ctx.export_id == export_id:
                ctx.export.close()
                ctx.export = ctx.export_id = None

    @app.post("/api/reveal")
    def reveal(body: RevealIn) -> None:
        path = Path(body.path)
        if path not in ctx.exported or not path.is_file():
            raise HTTPException(404, "this file was not exported in this session")
        ctx.reveal(path)

    if static_dir is not None:
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    return app
