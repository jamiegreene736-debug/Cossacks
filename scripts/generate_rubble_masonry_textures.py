#!/usr/bin/env python3
"""Generate irregular-rubble fortification masonry and walkway textures.

Produces weathered 18th-century Eastern/Central European stone sheets:
random rubble with thick lime mortar, chips, lichen and damp staining.
Outputs overwrite the production assets used by the connected wall renderer.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "buildings"

ENGLISH_STONE = [
    (58, 66, 60), (44, 52, 46), (74, 82, 75), (35, 43, 38),
    (66, 72, 67), (50, 58, 53), (28, 36, 31), (82, 88, 82),
]
OTTOMAN_STONE = [
    (122, 116, 104), (106, 101, 90), (140, 133, 120), (90, 86, 78),
    (128, 122, 108), (112, 107, 96), (84, 80, 72), (150, 142, 128),
]
MORTAR_EN = (110, 116, 108)
MORTAR_OT = (169, 162, 145)
WALK_STONE = [
    (72, 74, 70), (58, 60, 56), (88, 90, 84), (48, 50, 46),
    (96, 98, 92), (64, 66, 62),
]


def clamp(value: float, low: int = 0, high: int = 255) -> int:
    return max(low, min(high, int(round(value))))


def jitter(color: tuple[int, int, int], amount: float, rng: random.Random) -> tuple[int, int, int]:
    return tuple(clamp(channel + rng.uniform(-amount, amount)) for channel in color)


def paint_rubble_sheet(
    size: int,
    stones: list[tuple[int, int, int]],
    mortar: tuple[int, int, int],
    seed: int,
    mossier: bool = False,
) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new("RGB", (size, size), mortar)
    draw = ImageDraw.Draw(image)

    # Slightly mottled mortar bed.
    for _ in range(size * 8):
        x = rng.randrange(size)
        y = rng.randrange(size)
        tone = jitter(mortar, 10, rng)
        draw.point((x, y), fill=tone)

    y = -rng.randint(4, 18)
    row = 0
    while y < size + 20:
        row_h = rng.randint(18, 42)
        x = -rng.randint(8, 36) + (8 if row % 3 == 0 else 0)
        while x < size + 20:
            remain = size - x
            if remain < 14:
                break
            w = rng.randint(22, 70)
            if remain < w + 10:
                w = remain
            h = int(row_h * rng.uniform(0.72, 1.18))
            inset = rng.randint(2, 5)
            left = x + inset
            top = y + inset
            right = min(size - 1, x + w - inset)
            bottom = min(size - 1, y + h - inset)
            if right - left < 8 or bottom - top < 6:
                x += w + rng.randint(3, 8)
                continue
            color = jitter(rng.choice(stones), 14, rng)
            # Slightly irregular polygon instead of a perfect brick.
            points = [
                (left + rng.randint(0, 3), top + rng.randint(0, 2)),
                (right - rng.randint(0, 3), top + rng.randint(0, 3)),
                (right - rng.randint(0, 2), bottom - rng.randint(0, 3)),
                (left + rng.randint(0, 3), bottom - rng.randint(0, 2)),
            ]
            draw.polygon(points, fill=color)
            # Bevel highlight / shade.
            highlight = tuple(clamp(c + 28) for c in color)
            shade = tuple(clamp(c - 32) for c in color)
            draw.line([points[0], points[1]], fill=highlight, width=1)
            draw.line([points[2], points[3]], fill=shade, width=2)
            # Sparse tool marks.
            if rng.random() < 0.35:
                cx = (left + right) // 2 + rng.randint(-6, 6)
                cy = (top + bottom) // 2 + rng.randint(-4, 4)
                draw.line(
                    [(cx - 4, cy - 1), (cx + 5, cy + 2)],
                    fill=tuple(clamp(c - 40) for c in color),
                    width=1,
                )
            x += w + rng.randint(3, 9)
        y += int(row_h * rng.uniform(0.84, 1.02)) + rng.randint(2, 6)
        row += 1

    # Water stains and lichen.
    stain_count = 48 if mossier else 28
    for _ in range(stain_count):
        sx = rng.randrange(size)
        sy = rng.randrange(size // 5, size)
        length = rng.randint(18, 90)
        width = rng.randint(2, 6)
        for step in range(length):
            px = clamp(sx + rng.randint(-1, 1), 0, size - 1)
            py = clamp(sy + step, 0, size - 1)
            base = image.getpixel((px, py))
            damp = tuple(clamp(c * 0.72) for c in base)
            draw.ellipse(
                (px - width, py - 1, px + width, py + 1),
                fill=damp,
            )
            sx = px

    lichen_count = 420 if mossier else 220
    for _ in range(lichen_count):
        lx = rng.randrange(size)
        ly = rng.randrange(size)
        radius = rng.uniform(0.6, 2.8)
        green = (rng.randint(90, 130), rng.randint(110, 150), rng.randint(70, 100))
        alpha = rng.uniform(0.18, 0.45)
        base = image.getpixel((lx, ly))
        mixed = tuple(clamp(base[i] * (1 - alpha) + green[i] * alpha) for i in range(3))
        draw.ellipse((lx - radius, ly - radius, lx + radius, ly + radius), fill=mixed)

    # Soft grain so sheets do not look computer-flat after downscale.
    noise = Image.effect_noise((size, size), 18).convert("L")
    image = Image.blend(image, Image.merge("RGB", (noise, noise, noise)), 0.08)
    return image.filter(ImageFilter.SMOOTH_MORE)


def paint_walkway(size: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new("RGB", (size, size), (54, 56, 52))
    draw = ImageDraw.Draw(image)
    # Gently cambered terreplein: darker centre channel, lighter coping bands.
    for y in range(size):
        for x in range(size):
            across = abs((x / size) - 0.5) * 2
            camber = 1.0 - 0.12 * math.cos(across * math.pi)
            base = rng.choice(WALK_STONE)
            tone = tuple(clamp(c * camber + rng.uniform(-8, 8)) for c in base)
            image.putpixel((x, y), tone)

    # Coping stones along the outer strips.
    for band_y0, band_y1 in ((0, int(size * 0.18)), (int(size * 0.82), size)):
        x = 0
        while x < size:
            w = rng.randint(28, 54)
            color = jitter((130, 132, 124), 12, rng)
            draw.rectangle((x + 2, band_y0 + 2, min(size - 1, x + w - 2), band_y1 - 2), fill=color)
            draw.line((x + 2, band_y0 + 2, min(size - 1, x + w - 2), band_y0 + 2), fill=(170, 172, 164))
            x += w + 3

    # Foot-worn path down the middle.
    for _ in range(size * 3):
        x = int(size * 0.5 + rng.uniform(-size * 0.16, size * 0.16))
        y = rng.randrange(size)
        base = image.getpixel((x, y))
        worn = tuple(clamp(c + rng.randint(6, 18)) for c in base)
        draw.point((x, y), fill=worn)

    return image.filter(ImageFilter.SMOOTH)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # 1536 px sheets keep recessed mortar and lichen readable after the
    # gameplay stamp downscales them into a ~30 px facade.
    english = paint_rubble_sheet(1536, ENGLISH_STONE, MORTAR_EN, seed=1704, mossier=True)
    ottoman = paint_rubble_sheet(1536, OTTOMAN_STONE, MORTAR_OT, seed=1705, mossier=False)
    shared = paint_rubble_sheet(1536, ENGLISH_STONE, MORTAR_EN, seed=1706, mossier=True)
    walk = paint_walkway(1536, seed=1710)

    english_path = OUT / "english-fortification-masonry.png"
    ottoman_path = OUT / "ottoman-fortification-masonry.png"
    shared_path = OUT / "fortification-masonry.webp"
    walk_path = OUT / "fortification-walkway.webp"

    english.save(english_path, format="PNG", optimize=True)
    ottoman.save(ottoman_path, format="PNG", optimize=True)
    # Near-lossless WebP preserves the authored microcontrast the connected
    # renderer projects onto free-angle sections.
    shared.save(shared_path, format="WEBP", lossless=True, method=6)
    walk.save(walk_path, format="WEBP", lossless=True, method=6)

    print(f"wrote {english_path.relative_to(ROOT)}")
    print(f"wrote {ottoman_path.relative_to(ROOT)}")
    print(f"wrote {shared_path.relative_to(ROOT)}")
    print(f"wrote {walk_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
