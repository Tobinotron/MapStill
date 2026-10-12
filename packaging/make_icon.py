"""Draws the program's icon: a pin on a map in the greys of the "Mono light" style.

    uv run python packaging/make_icon.py    # → packaging/icon.ico, packaging/icon.png

The result is committed; run this again only to change the icon.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SIZE = 1024  # drawn large and scaled down, for smooth edges
RADIUS = SIZE // 5
LAND, PARK, WOODS, ROAD, WATER = "#ffffff", "#e7e7e7", "#d8d8d8", "#dddddd", "#a7a7a7"
EDGE, PIN = "#bdbdbd", "#333333"


def the_map() -> Image.Image:
    art = Image.new("RGBA", (SIZE, SIZE), LAND)
    pen = ImageDraw.Draw(art)
    pen.polygon([(0, 560), (300, 520), (420, 760), (360, 1024), (0, 1024)], fill=PARK)
    pen.polygon([(700, 0), (1024, 0), (1024, 250), (820, 300), (660, 150)], fill=WOODS)
    for line in [
        (180, 0, 330, 1024),
        (0, 250, 1024, 110),
        (610, 0, 760, 1024),
        (0, 900, 1024, 800),
        (330, 420, 1024, 560),
    ]:
        pen.line(line, fill=ROAD, width=40)
    river = [(-80, 470), (150, 330), (380, 420), (560, 620), (800, 660), (1100, 480)]
    pen.line(river, fill=WATER, width=150, joint="curve")
    for x, y in river[1:-1]:  # round the bends
        pen.ellipse((x - 75, y - 75, x + 75, y + 75), fill=WATER)
    return art


def the_pin() -> Image.Image:
    """The pin and the shadow it stands on, on a transparent layer."""
    cx, cy, r, tip = 512, 400, 200, 830
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((cx - 130, tip - 30, cx + 130, tip + 34), fill=(0, 0, 0, 70))
    layer = shadow.filter(ImageFilter.GaussianBlur(18))
    pen = ImageDraw.Draw(layer)
    pen.polygon([(cx - r * 0.87, cy + r * 0.5), (cx + r * 0.87, cy + r * 0.5), (cx, tip)], fill=PIN)
    pen.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PIN)
    pen.ellipse((cx - 78, cy - 78, cx + 78, cy + 78), fill=LAND)
    return layer


def draw() -> Image.Image:
    art = Image.alpha_composite(the_map(), the_pin())
    # a thin edge: the map is white, and so are many backgrounds
    ImageDraw.Draw(art).rounded_rectangle(
        (0, 0, SIZE - 1, SIZE - 1), radius=RADIUS, outline=EDGE, width=22
    )
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=RADIUS, fill=255)
    art.putalpha(mask)
    return art


def main() -> None:
    art = draw()
    art.resize((512, 512), Image.Resampling.LANCZOS).save(HERE / "icon.png")
    sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    art.resize((256, 256), Image.Resampling.LANCZOS).save(HERE / "icon.ico", sizes=sizes)
    print(f"wrote {HERE / 'icon.png'} and {HERE / 'icon.ico'}")


if __name__ == "__main__":
    main()
