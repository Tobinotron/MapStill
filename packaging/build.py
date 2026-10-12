"""Builds the desktop program (nothing else to install to run it).

    uv run python packaging/build.py              # → build/dist/MapStill/
    uv run python packaging/build.py --install    # Windows: also install for this user
                                                  #   (%LOCALAPPDATA%/Programs, Start menu)

Steps: build the UI (npm), bundle Python and the app (PyInstaller, see
mapstill.spec), write the licence notices, and run the program's self-test.

The program needs the WebView2 runtime, which is part of Windows 11. On macOS the
result is build/dist/MapStill.app (not tested: the program has only
been built on Windows so far).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DIST = BUILD / "dist"
NAME = "MapStill"
WINDOWS = sys.platform == "win32"


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, shell=WINDOWS and cmd[0] in ("npm", "npx"))


def program_dir() -> Path:
    if sys.platform == "darwin":
        return DIST / f"{NAME}.app" / "Contents" / "MacOS"
    return DIST / NAME


def build_ui() -> None:
    frontend = ROOT / "frontend"
    if not (frontend / "node_modules").is_dir():
        run(["npm", "ci"], cwd=frontend)
    run(["npm", "run", "build"], cwd=frontend)


def build_program() -> None:
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            str(DIST),
            "--workpath",
            str(BUILD / "work"),
            str(ROOT / "packaging" / "mapstill.spec"),
        ]
    )


def write_notices() -> None:
    """THIRD-PARTY-NOTICES.txt: what is inside the program and under which licences."""
    lines = [
        f"{NAME} contains the following third-party software.",
        "",
        "In the user interface:",
        "  MapLibre GL JS (https://maplibre.org): BSD 3-Clause",
        "  maplibre-contour (https://github.com/onthegomap/maplibre-contour): BSD 3-Clause",
        "  React (https://react.dev): MIT",
        "  Lucide icons (https://lucide.dev): ISC",
        "",
        "The maps it draws are not part of the program; they are loaded when it runs:",
        "  Map data © OpenStreetMap contributors (ODbL), as vector tiles and styles from",
        "  OpenFreeMap (https://openfreemap.org, © OpenMapTiles).",
        "  Terrain from Mapterhorn (https://mapterhorn.com/attribution).",
        "  Place search by Nominatim (https://nominatim.org), with OpenStreetMap data.",
        "",
        "Python packages:",
    ]
    seen = set()
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        name = dist.metadata["Name"]
        if name.lower() in seen or name.lower() in ("pyinstaller", "pyinstaller-hooks-contrib"):
            continue
        seen.add(name.lower())
        licence = (
            dist.metadata.get("License-Expression")
            or next(
                (
                    c.split("::")[-1].strip()
                    for c in dist.metadata.get_all("Classifier") or []
                    if c.startswith("License ::")
                ),
                None,
            )
            or (dist.metadata.get("License") or "see the package").splitlines()[0][:80]
        )
        lines.append(f"  {name} {dist.version}: {licence}")
    lines += ["", f"Python {sys.version.split()[0]}: Python Software Foundation License"]
    (program_dir() / "THIRD-PARTY-NOTICES.txt").write_text("\n".join(lines) + "\n", "utf-8")


def self_test() -> None:
    exe = program_dir() / (f"{NAME}.exe" if WINDOWS else NAME)
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "self-test.txt"
        done = subprocess.run([str(exe), "--self-test", str(report)], check=False)
        print("\nSelf-test of the built program:")
        print(report.read_text("utf-8") if report.is_file() else "(no report)")
        if done.returncode != 0:
            sys.exit("the built program failed its self-test")


def install() -> None:
    """Windows: copy to %LOCALAPPDATA%/Programs and add a Start menu shortcut."""
    if not WINDOWS:
        sys.exit("--install is for Windows; on macOS drag the .app into Applications")
    target = Path(os.environ["LOCALAPPDATA"]) / "Programs" / NAME
    if target.exists():
        shutil.rmtree(target)  # an older version (the program must not be running)
    shutil.copytree(program_dir(), target)
    exe = target / f"{NAME}.exe"
    menu = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    link = menu / f"{NAME}.lnk"
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); "
        "$s.TargetPath = $env:EXE; $s.WorkingDirectory = $env:DIR; $s.Save()"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        env={**os.environ, "LNK": str(link), "EXE": str(exe), "DIR": str(target)},
        check=True,
    )
    print(f"\nInstalled to {target}\nStart menu: {NAME}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-ui", action="store_true", help="use the existing UI build")
    parser.add_argument("--install", action="store_true", help="Windows: install for this user")
    args = parser.parse_args()
    if not args.skip_ui:
        build_ui()
    build_program()
    write_notices()
    self_test()
    size = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"\nBuilt {program_dir()} ({size / 1e6:.0f} MB)")
    if args.install:
        install()


if __name__ == "__main__":
    main()
