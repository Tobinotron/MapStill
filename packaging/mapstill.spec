# PyInstaller recipe for the desktop app. Used by packaging/build.py, which also builds
# the UI first and adds the licence notices next to the program.
# -*- mode: python -*-

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent  # noqa: F821 (provided by PyInstaller)
NAME = "MapStill"

a = Analysis(  # noqa: F821
    [str(ROOT / "main.py")],
    pathex=[str(ROOT)],
    datas=[
        (str(ROOT / "frontend" / "dist"), "frontend/dist"),  # the built UI
    ],
    hiddenimports=[
        *collect_submodules("uvicorn"),  # loads its protocol/loop modules by name
        *collect_submodules("mapstill"),
    ],
    excludes=["tkinter", "pytest", "IPython", "matplotlib", "PyInstaller"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

icon = ROOT / "packaging" / ("icon.ico" if sys.platform == "win32" else "icon.png")
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # a folder with the program, not one self-extracting file
    name=NAME,
    icon=str(icon),
    console=False,  # a window, no console
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name=NAME, upx=False)  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name=f"{NAME}.app",
        icon=str(icon),
        bundle_identifier="com.tobinotron.mapstill",
        info_plist={"NSHighResolutionCapable": True},
    )
