"""Generates the app icon (build/icon.png + build/icon.ico).

Run: python tools/gen_icon.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 1024
COLORS = [
    (102, 217, 255),
    (125, 255, 206),
    (255, 224, 102),
    (255, 159, 110),
    (255, 123, 156),
    (197, 155, 255),
    (110, 168, 255),
    (155, 225, 93),
]
# Same ordering as src/core/sectors.ts: button 1 at the top, clockwise.
ANGLES = [270, 315, 0, 45, 90, 135, 180, 225]


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "build"
    out.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.24), fill=(7, 10, 18, 255))

    # Soft radial glow behind the ring.
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        [S * 0.16, S * 0.16, S * 0.84, S * 0.84],
        fill=(80, 160, 255, 52),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=S * 0.08))
    image.alpha_composite(glow)

    cx = cy = S / 2
    ring = S * 0.33
    draw.ellipse(
        [cx - ring, cy - ring, cx + ring, cy + ring],
        outline=(124, 224, 255, 80),
        width=int(S * 0.006),
    )

    dot = S * 0.052
    for angle, color in zip(ANGLES, COLORS):
        rad = math.radians(angle)
        x = cx + math.cos(rad) * ring
        y = cy + math.sin(rad) * ring
        draw.ellipse([x - dot, y - dot, x + dot, y + dot], fill=(*color, 255))
        inner = dot * 0.38
        draw.ellipse([x - inner, y - inner, x + inner, y + inner], fill=(7, 10, 18, 255))

    center = S * 0.085
    draw.ellipse([cx - center, cy - center, cx + center, cy + center], fill=(12, 19, 34, 255))
    draw.ellipse(
        [cx - center, cy - center, cx + center, cy + center],
        outline=(255, 93, 115, 235),
        width=int(S * 0.014),
    )
    draw.ellipse(
        [cx - center * 0.34, cy - center * 0.34, cx + center * 0.34, cy + center * 0.34],
        fill=(124, 224, 255, 235),
    )

    png = image.resize((512, 512), Image.LANCZOS)
    png.save(out / "icon.png")
    image.save(
        out / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {out / 'icon.png'} and {out / 'icon.ico'}")


if __name__ == "__main__":
    main()
