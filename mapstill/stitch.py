"""Assembling an exported image from the chunks the UI renders.

The web view draws the map in chunks (a WebGL canvas cannot be as large as the images
this app is for) and sends each as a PNG; here they are pasted into one image. The
whole image is held in memory, three bytes per pixel, until it is saved.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Literal

from PIL import Image

Format = Literal["png", "jpeg"]

MAX_SIDE = 100_000
MAX_PIXELS = 1_000_000_000  # 3 GB in memory
JPEG_MAX_SIDE = 65_535  # the format's limit
SUFFIXES: dict[Format, tuple[str, ...]] = {"png": (".png",), "jpeg": (".jpg", ".jpeg")}


class ExportError(ValueError):
    """The export cannot be made as asked; the message is for the user."""


def check_size(width: int, height: int, fmt: Format) -> None:
    if width < 1 or height < 1:
        raise ExportError("the image needs a width and a height")
    if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
        raise ExportError(
            f"{width} × {height} px is too large: at most {MAX_PIXELS // 1_000_000} megapixels"
        )
    if fmt == "jpeg" and max(width, height) > JPEG_MAX_SIDE:
        raise ExportError(f"a JPEG cannot be larger than {JPEG_MAX_SIDE} px; choose PNG")


def unused_path(path: Path) -> Path:
    """``path``, or ``name (2).png`` and so on if it is taken."""
    candidate, n = path, 1
    while candidate.exists():
        n += 1
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
    return candidate


class ExportImage:
    def __init__(self, width: int, height: int, fmt: Format, path: Path) -> None:
        check_size(width, height, fmt)
        self.width, self.height, self.format, self.path = width, height, fmt, path
        self.image: Image.Image | None = Image.new("RGB", (width, height))

    def add_chunk(self, x: int, y: int, png: bytes) -> None:
        """Paste a chunk with its top left corner at (x, y). What reaches beyond the
        image (the last row and column of chunks) is cut off."""
        if self.image is None:
            raise ExportError("the export is already finished")
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise ExportError(f"a chunk at ({x}, {y}) is outside the image")
        try:
            with Image.open(io.BytesIO(png)) as chunk:
                self.image.paste(chunk.convert("RGB"), (x, y))
        except OSError as exc:
            raise ExportError(f"a chunk is not a readable image: {exc}") from exc

    def save(self) -> int:
        """Write the image and release it. Returns the file's size in bytes."""
        if self.image is None:
            raise ExportError("the export is already finished")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        part = self.path.with_name(self.path.name + ".part")
        try:
            if self.format == "jpeg":
                # no chroma subsampling: thin coloured lines stay sharp
                self.image.save(part, "JPEG", quality=92, subsampling=0)
            else:
                # level 3 instead of 6: half the time for a few percent more size
                self.image.save(part, "PNG", compress_level=3)
            part.replace(self.path)
        finally:
            part.unlink(missing_ok=True)
            self.close()
        return self.path.stat().st_size

    def close(self) -> None:
        if self.image is not None:
            self.image.close()
            self.image = None
