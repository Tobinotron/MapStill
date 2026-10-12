"""What the app remembers between runs: presets, the user's own map styles, and the
last-used settings.

Everything is a plain JSON file in the app's folder, so presets and styles can be
copied, shared and edited by hand. What is in them belongs to the UI; this side
stores it as it comes.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

APP_DIR_ENV = "MAPSTILL_APP_DIR"
# what the app's folder was called while the app had another name
FORMER_APP_DIRS = ("stylized-maps",)
NAME_MAX = 80


def app_dir() -> Path:
    """``%APPDATA%/mapstill`` (Windows), ``~/Library/Application Support/…`` (macOS),
    ``$XDG_CONFIG_HOME/mapstill`` elsewhere. ``MAPSTILL_APP_DIR`` overrides."""
    override = os.environ.get(APP_DIR_ENV)
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "mapstill"


def adopt_former_app_dir(new: Path | None = None) -> Path | None:
    """Take over what the app kept under a former name: once, when it first runs under
    the new one (there is no folder of that name yet). Returns the folder taken over.

    The folder is renamed. If that fails (the former program is running and has files
    in it open), what matters is copied instead: settings, presets and styles.
    """
    if new is None:
        if os.environ.get(APP_DIR_ENV):
            return None  # a folder chosen on purpose is used as it is
        new = app_dir()
    if new.exists():
        return None
    for name in FORMER_APP_DIRS:
        old = new.with_name(name)
        if not old.is_dir():
            continue
        try:
            old.rename(new)
        except OSError:
            new.mkdir(parents=True, exist_ok=True)
            for kept in ("settings.json", "presets", "styles"):
                source = old / kept
                if source.is_dir():
                    shutil.copytree(source, new / kept, dirs_exist_ok=True)
                elif source.is_file():
                    shutil.copy2(source, new / kept)
        return old
    return None


def exports_dir() -> Path:
    """Where images go when no place was chosen (the UI opened in a browser)."""
    return Path.home() / "Pictures" / "MapStill"


class NameTaken(ValueError):
    """There is already something under this name (``existing`` is how it is spelled)."""

    def __init__(self, existing: str) -> None:
        super().__init__(existing)
        self.existing = existing


def slug(name: str) -> str:
    """The file name of a preset or style: two names that differ only in case or
    punctuation are the same one."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _read(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


class Store:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or app_dir()

    @property
    def presets_dir(self) -> Path:
        return self.root / "presets"

    def settings(self) -> dict[str, Any] | None:
        """The settings the app was last closed with; None on the first run."""
        return _read(self.root / "settings.json")

    def save_settings(self, settings: dict[str, Any]) -> None:
        _write(self.root / "settings.json", settings)

    def window(self) -> dict[str, Any] | None:
        """How the window was left (which sections are folded away): about the
        window, not about an image, and so not part of the settings."""
        return _read(self.root / "window.json")

    def save_window(self, window: dict[str, Any]) -> None:
        _write(self.root / "window.json", window)

    def presets(self) -> list[dict[str, Any]]:
        found = (_read(p) for p in self.presets_dir.glob("*.json"))
        valid = [p for p in found if p and isinstance(p.get("name"), str) and "settings" in p]
        return sorted(valid, key=lambda p: p["name"].lower())

    def save_preset(self, name: str, settings: dict[str, Any]) -> dict[str, Any]:
        name = name.strip()[:NAME_MAX]
        if not slug(name):
            raise ValueError("a preset name needs at least one letter or digit")
        preset = {"name": name, "settings": settings}
        _write(self.presets_dir / f"{slug(name)}.json", preset)
        return preset

    def delete_preset(self, name: str) -> bool:
        return _delete(self.presets_dir, name)

    @property
    def styles_dir(self) -> Path:
        return self.root / "styles"

    def styles(self) -> list[dict[str, Any]]:
        """The user's own map styles, by name."""
        found = (_read(p) for p in self.styles_dir.glob("*.json"))
        valid = [s for s in found if s and isinstance(s.get("name"), str) and "style" in s]
        return sorted(valid, key=lambda s: s["name"].lower())

    def save_style(
        self, name: str, style: dict[str, Any], overwrite: bool = False
    ) -> dict[str, Any]:
        """Keep a style under a name. A name that is taken is only replaced on request
        (``NameTaken`` otherwise): a style is work that a typo should not destroy."""
        name = name.strip()[:NAME_MAX]
        if not slug(name):
            raise ValueError("a style name needs at least one letter or digit")
        path = self.styles_dir / f"{slug(name)}.json"
        existing = _read(path) if path.is_file() else None
        if existing is not None and not overwrite:
            raise NameTaken(str(existing.get("name") or name))
        saved = {"name": name, "style": style}
        _write(path, saved)
        return saved

    def delete_style(self, name: str) -> bool:
        return _delete(self.styles_dir, name)


def _delete(folder: Path, name: str) -> bool:
    path = folder / f"{slug(name)}.json"
    if not slug(name) or not path.is_file():
        return False
    path.unlink()
    return True
