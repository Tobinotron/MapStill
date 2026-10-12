"""Desktop app entry point: API server + PyWebView window.

    uv run python main.py             # the app (serves frontend/dist; build it first)
    uv run python main.py --dev       # API on :8766, UI from the Vite dev server (npm run dev)
    uv run python main.py --browser   # no window: open the UI in the default browser
    uv run python main.py --self-test # check the installation (UI, API, images), no window

As a packaged program (packaging/build.py) the UI is bundled inside the program.

The API listens on 127.0.0.1 with a per-launch token, which the window receives in
the URL fragment.
"""

from __future__ import annotations

import argparse
import logging
import secrets
import sys
import webbrowser
from pathlib import Path
from typing import Any

from mapstill.app import AppContext, create_app
from mapstill.server import start_server
from mapstill.store import Store, adopt_former_app_dir, app_dir

FROZEN = bool(getattr(sys, "frozen", False))  # running as the packaged program
# packaged: data files are unpacked to sys._MEIPASS
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
DIST = BUNDLE / "frontend" / "dist"
NAME = "MapStill"
DEV_API_PORT = 8766
DEV_UI_URL = "http://localhost:5174"


class ShellApi:
    """Native functions the UI can call as ``window.pywebview.api.*``.

    PyWebView exposes every public attribute to the page and walks into it, so the
    window is kept in a private attribute.
    """

    def __init__(self) -> None:
        self._window: Any = None

    def pick_save_path(self, name: str, fmt: str) -> str | None:
        """Ask where to save an image; None if the dialog was cancelled."""
        import webview

        kinds = {"png": "PNG image (*.png)", "jpeg": "JPEG image (*.jpg;*.jpeg)"}
        suffix = ".jpg" if fmt == "jpeg" else ".png"
        chosen = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=str(name)[:120] + suffix,
            file_types=(kinds.get(fmt, kinds["png"]),),
        )
        if not chosen:
            return None
        return str(Path(chosen if isinstance(chosen, str) else chosen[0]))


def setup_environment() -> None:
    """A windowed program has no console, so it logs to a file."""
    if FROZEN and sys.stderr is None:
        logs = app_dir() / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        # written line by line; open for as long as the program runs
        log = open(logs / "app.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stderr = log
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )


def self_test(report: str | None = None) -> int:
    """Check that everything the app needs works here (also in the packaged program).

    The packaged program has no console, so ``report`` names a file for the results.
    """
    import io
    import tempfile
    import urllib.request

    from PIL import Image

    from mapstill.stitch import ExportImage

    checks: list[tuple[str, str]] = []

    def check(name: str, fn: Any) -> None:
        try:
            checks.append((name, f"ok  {fn() or ''}".rstrip()))
        except Exception as exc:
            checks.append((name, f"FAILED  {type(exc).__name__}: {exc}"))

    def ui() -> str:
        if not (DIST / "index.html").is_file():
            raise FileNotFoundError(DIST / "index.html")
        return str(DIST)

    def api() -> str:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = AppContext(token="t", store=Store(Path(tmp)))
            server = start_server(create_app(ctx, static_dir=DIST))
            try:
                req = urllib.request.Request(f"{server.url}/api/app", headers={"X-Map-Token": "t"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    return f"{server.url} -> {r.status}"
            finally:
                server.stop()

    def images() -> str:
        chunk = io.BytesIO()
        Image.new("RGBA", (64, 64), "red").save(chunk, "PNG")
        with tempfile.TemporaryDirectory() as tmp:
            export = ExportImage(100, 64, "png", Path(tmp) / "test ü.png")
            export.add_chunk(0, 0, chunk.getvalue())
            export.add_chunk(64, 0, chunk.getvalue())
            size = export.save()
            with Image.open(export.path) as written:
                return f"{written.size[0]}x{written.size[1]} px, {size} bytes"

    def window() -> str:
        import webview

        return f"pywebview, save dialog {webview.FileDialog.SAVE.name}"

    check("UI files", ui)
    check("local API", api)
    check("image writing", images)
    check("window", window)
    width = max(len(n) for n, _ in checks)
    text = "".join(f"{name:<{width}}  {result}\n" for name, result in checks)
    if report:
        Path(report).write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0 if all(r.startswith("ok") for _, r in checks) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"{NAME} desktop app")
    parser.add_argument("--dev", action="store_true", help="use the Vite dev server for the UI")
    parser.add_argument("--browser", action="store_true", help="open in the browser, no window")
    parser.add_argument("--debug", action="store_true", help="web inspector in the window")
    parser.add_argument(
        "--self-test",
        nargs="?",
        const="",
        metavar="REPORT",
        help="check the installation (results to REPORT, a file, if given)",
    )
    args = parser.parse_args(argv)
    # before anything is written: what the app kept while it had another name
    adopted = adopt_former_app_dir()
    setup_environment()
    logging.getLogger("mapstill").info(
        "starting (%s)", "packaged program" if FROZEN else "from source"
    )
    if adopted is not None:
        logging.getLogger("mapstill").info("took over the data in %s", adopted)
    if args.self_test is not None:
        return self_test(args.self_test or None)

    if not args.dev and not (DIST / "index.html").is_file():
        print(  # only from a source checkout: the packaged program bundles the UI
            "The UI is not built yet. Run:\n  cd frontend\n  npm install\n  npm run build",
            file=sys.stderr,
        )
        return 2

    ctx = AppContext(token=secrets.token_urlsafe(24))
    app = create_app(ctx, static_dir=None if args.dev else DIST)
    server = start_server(app, port=DEV_API_PORT if args.dev else None)
    url = f"{DEV_UI_URL if args.dev else server.url}/#token={ctx.token}"
    try:
        if args.browser:
            print(f"Open: {url}\nPress Ctrl+C to quit.")
            webbrowser.open(url)
            server.thread.join()
            return 0

        import webview

        shell = ShellApi()
        window = webview.create_window(
            NAME, url, js_api=shell, width=1440, height=900, min_size=(960, 600)
        )
        if window is None:
            raise RuntimeError("could not create the window")
        shell._window = window
        # not private: the web view keeps its cache (map tiles seen before load faster)
        # in the app's folder
        webview.start(debug=args.debug, private_mode=False, storage_path=str(app_dir() / "webview"))
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        ctx.close()  # an unfinished export is dropped
        server.stop()


if __name__ == "__main__":
    raise SystemExit(main())
