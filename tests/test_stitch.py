from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from mapstill.stitch import ExportError, ExportImage, check_size, unused_path


def png(size: tuple[int, int], colour: str, mode: str = "RGBA") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, colour).save(buffer, "PNG")
    return buffer.getvalue()


def test_chunks_land_where_they_belong(tmp_path: Path) -> None:
    export = ExportImage(6, 4, "png", tmp_path / "out.png")
    export.add_chunk(0, 0, png((4, 4), "red"))
    export.add_chunk(4, 0, png((4, 4), "blue"))  # two columns reach beyond the image
    size = export.save()

    assert size == (tmp_path / "out.png").stat().st_size
    with Image.open(tmp_path / "out.png") as image:
        assert image.size == (6, 4)
        assert image.mode == "RGB"
        assert image.getpixel((3, 3)) == (255, 0, 0)
        assert image.getpixel((4, 0)) == (0, 0, 255)
        assert image.getpixel((5, 3)) == (0, 0, 255)


def test_jpeg_keeps_the_size(tmp_path: Path) -> None:
    export = ExportImage(8, 8, "jpeg", tmp_path / "out.jpg")
    export.add_chunk(0, 0, png((8, 8), "white"))
    export.save()
    with Image.open(tmp_path / "out.jpg") as image:
        assert (image.format, image.size) == ("JPEG", (8, 8))


def test_no_part_file_is_left_behind(tmp_path: Path) -> None:
    export = ExportImage(2, 2, "png", tmp_path / "deep" / "out.png")
    export.save()
    assert [p.name for p in (tmp_path / "deep").iterdir()] == ["out.png"]


def test_a_finished_export_takes_no_more_chunks(tmp_path: Path) -> None:
    export = ExportImage(2, 2, "png", tmp_path / "out.png")
    export.save()
    with pytest.raises(ExportError):
        export.add_chunk(0, 0, png((2, 2), "red"))
    with pytest.raises(ExportError):
        export.save()


def test_bad_chunks_are_refused(tmp_path: Path) -> None:
    export = ExportImage(2, 2, "png", tmp_path / "out.png")
    with pytest.raises(ExportError, match="outside"):
        export.add_chunk(2, 0, png((2, 2), "red"))
    with pytest.raises(ExportError, match="readable"):
        export.add_chunk(0, 0, b"not an image")


@pytest.mark.parametrize(
    ("width", "height", "fmt"),
    [(0, 10, "png"), (100_001, 10, "png"), (40_000, 40_000, "png"), (70_000, 10, "jpeg")],
)
def test_impossible_sizes(width: int, height: int, fmt: str) -> None:
    with pytest.raises(ExportError):
        check_size(width, height, fmt)  # type: ignore[arg-type]


def test_unused_path(tmp_path: Path) -> None:
    first = tmp_path / "map.png"
    assert unused_path(first) == first
    first.touch()
    assert unused_path(first) == tmp_path / "map (2).png"
    (tmp_path / "map (2).png").touch()
    assert unused_path(first) == tmp_path / "map (3).png"
