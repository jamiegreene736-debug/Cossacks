#!/usr/bin/env python3
"""Generate irregular-rubble fortification masonry and walkway textures.

True random-rubble sheets (no brick courses): voronoi-like stone cells, thick
lime mortar, chips, lichen and damp staining for 18th-century curtain walls.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "buildings"

ENGLISH_STONE = [
    (52, 60, 54), (38, 46, 40), (70, 78, 71), (30, 38, 33),
    (62, 68, 63), (46, 54, 49), (24, 32, 27), (78, 84, 78),
    (58, 64, 58), (42, 50, 45), (66, 72, 66),
]
OTTOMAN_STONE = [
    (118, 112, 100), (102, 97, 86), (136, 129, 116), (86, 82, 74),
    (124, 118, 104), (108, 103, 92), (80, 76, 68), (146, 138, 124),
    (112, 106, 94), (94, 90, 80), (130, 124, 110),
]
MORTAR_EN = (102, 108, 100)
MORTAR_OT = (160, 153, 136)
WALK_STONE = [
    (68, 70, 66), (54, 56, 52), (84, 86, 80), (44, 46, 42),
    (92, 94, 88), (60, 62, 58), (76, 78, 72),
]


def clamp(value: float, low: int = 0, high: int = 255) -> int:
    return max(low, min(high, int(round(value))))


def jitter(color: tuple[int, int, int], amount: float, rng: random.Random) -> tuple[int, int, int]:
    return tuple(clamp(channel + rng.uniform(-amount, amount)) for channel in color)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(clamp(a[i] * (1 - t) + b[i] * t) for i in range(3))


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
    pixels = image.load()

    # Mottled lime mortar bed — never a flat fill.
    for y in range(size):
        for x in range(size):
            n = (
                math.sin(x * 0.07 + seed) * 4
                + math.cos(y * 0.09 - seed) * 3
                + rng.uniform(-6, 6)
            )
            pixels[x, y] = jitter(
                (clamp(mortar[0] + n), clamp(mortar[1] + n * 0.9), clamp(mortar[2] + n * 0.8)),
                0,
                rng,
            )

    # Seed points for voronoi-like rubble cells — deliberately non-grid.
    count = int((size / 28) ** 2 * 1.35)
    points = []
    for _ in range(count):
        points.append((
            rng.uniform(0, size),
            rng.uniform(0, size),
            rng.choice(stones),
            rng.uniform(0.85, 1.25),
        ))

    # Paint each cell as an irregular polygon around its seed.
    for cx, cy, base, scale in points:
        radius = rng.uniform(14, 34) * scale
        sides = rng.randint(5, 8)
        poly = []
        for i in range(sides):
            ang = (i / sides) * math.tau + rng.uniform(-0.25, 0.25)
            r = radius * rng.uniform(0.55, 1.15)
            poly.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
        # Shrink slightly so thick mortar joints remain between stones.
        inset = 1.8 + rng.uniform(0, 1.6)
        mid_x = sum(p[0] for p in poly) / len(poly)
        mid_y = sum(p[1] for p in poly) / len(poly)
        shrunk = []
        for px, py in poly:
            dx, dy = px - mid_x, py - mid_y
            length = math.hypot(dx, dy) or 1
            shrunk.append((
                mid_x + dx * (1 - inset / length),
                mid_y + dy * (1 - inset / length),
            ))
        color = jitter(base, 16, rng)
        draw.polygon(shrunk, fill=color)
        # Bevel: lit top-left edge, shaded bottom-right.
        if len(shrunk) >= 3:
            draw.line([shrunk[0], shrunk[1]], fill=tuple(clamp(c + 26) for c in color), width=1)
            draw.line(
                [shrunk[len(shrunk) // 2], shrunk[(len(shrunk) // 2 + 1) % len(shrunk)]],
                fill=tuple(clamp(c - 30) for c in color),
                width=2,
            )
        if rng.random() < 0.4:
            chip_x = mid_x + rng.uniform(-radius * 0.3, radius * 0.3)
            chip_y = mid_y + rng.uniform(-radius * 0.3, radius * 0.3)
            draw.line(
                [(chip_x - 3, chip_y), (chip_x + 4, chip_y + 2)],
                fill=tuple(clamp(c - 38) for c in color),
                width=1,
            )

    # Secondary smaller fill stones in gaps (reads as packed rubble, not ashlar).
    for _ in range(count // 2):
        cx = rng.uniform(0, size)
        cy = rng.uniform(0, size)
        sample = pixels[int(cx) % size, int(cy) % size]
        # Only drop fillers onto mortar-ish pixels.
        if abs(sample[0] - mortar[0]) > 28:
            continue
        r = rng.uniform(6, 14)
        poly = []
        for i in range(5):
            ang = (i / 5) * math.tau + rng.uniform(-0.3, 0.3)
            poly.append((cx + math.cos(ang) * r * rng.uniform(0.7, 1.1),
                         cy + math.sin(ang) * r * rng.uniform(0.7, 1.1)))
        draw.polygon(poly, fill=jitter(rng.choice(stones), 12, rng))

    # Water stains.
    for _ in range(55 if mossier else 34):
        sx = rng.randrange(size)
        sy = rng.randrange(size // 6, size)
        length = rng.randint(24, 110)
        width = rng.randint(2, 7)
        for step in range(length):
            px = clamp(sx + rng.randint(-1, 1), 0, size - 1)
            py = clamp(sy + step, 0, size - 1)
            base = pixels[px, py]
            damp = mix(base, (28, 32, 28), 0.28)
            draw.ellipse((px - width, py - 1, px + width, py + 1), fill=damp)
            sx = px

    # Moss / lichen freckles.
    lichen = 900 if mossier else 480
    for _ in range(lichen):
        lx = rng.randrange(size)
        ly = rng.randrange(size)
        radius = rng.uniform(0.7, 3.2)
        green = (rng.randint(78, 125), rng.randint(100, 145), rng.randint(58, 95))
        alpha = rng.uniform(0.16, 0.48)
        base = pixels[lx, ly]
        mixed = mix(base, green, alpha)
        draw.ellipse((lx - radius, ly - radius, lx + radius, ly + radius), fill=mixed)

    # Soft grain + slight contrast so joints survive downscale.
    noise = Image.effect_noise((size, size), 22).convert("L")
    image = Image.blend(image, Image.merge("RGB", (noise, noise, noise)), 0.07)
    image = ImageEnhance.Contrast(image).enhance(1.12)
    image = ImageEnhance.Sharpness(image).enhance(1.18)
    return image.filter(ImageFilter.SMOOTH_MORE)


def paint_walkway(size: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new("RGB", (size, size), (48, 50, 46))
    draw = ImageDraw.Draw(image)
    pixels = image.load()

    for y in range(size):
        for x in range(size):
            n = rng.randint(-10, 10)
            base = rng.choice(WALK_STONE)
            pixels[x, y] = tuple(clamp(c + n) for c in base)

    y = -12
    row = 0
    while y < size + 30:
        row_h = rng.randint(20, 38)
        x = -rng.randint(8, 30) + (row % 2) * 14
        while x < size + 30:
            w = rng.randint(24, 60)
            h = int(row_h * rng.uniform(0.75, 1.15))
            color = jitter(rng.choice(WALK_STONE), 16, rng)
            inset = 2
            box = [x + inset, y + inset, x + w - inset, y + h - inset]
            draw.rectangle(box, fill=color)
            if rng.random() < 0.35:
                cx = (box[0] + box[2]) / 2
                cy = (box[1] + box[3]) / 2
                draw.line(
                    [(cx - 6, cy), (cx + 7, cy + 3)],
                    fill=tuple(clamp(c - 35) for c in color), width=1,
                )
            draw.line((box[0], box[1], box[2], box[1]), fill=tuple(clamp(c + 24) for c in color))
            draw.line((box[0], box[3], box[2], box[3]), fill=tuple(clamp(c - 28) for c in color), width=2)
            x += w + rng.randint(2, 5)
        y += int(row_h * rng.uniform(0.88, 1.05)) + 2
        row += 1

    for band_y0, band_y1 in ((0, int(size * 0.16)), (int(size * 0.84), size)):
        x = 0
        while x < size:
            w = rng.randint(28, 58)
            color = jitter((130, 132, 124), 14, rng)
            draw.rectangle((x + 2, band_y0 + 2, min(size - 1, x + w - 2), band_y1 - 2), fill=color)
            draw.line((x + 2, band_y0 + 2, min(size - 1, x + w - 2), band_y0 + 2), fill=(170, 172, 164))
            for _ in range(40):
                gx = rng.randint(x + 2, min(size - 1, x + w - 2))
                gy = rng.randint(band_y0 + 2, band_y1 - 2)
                pixels[gx, gy] = jitter(color, 22, rng)
            x += w + 3

    for _ in range(size * 6):
        x = int(size * 0.5 + rng.uniform(-size * 0.2, size * 0.2))
        y = rng.randrange(size)
        base = pixels[x, y]
        pixels[x, y] = tuple(clamp(c + rng.randint(6, 18)) for c in base)

    for _ in range(600):
        x = rng.randrange(size)
        y = rng.randrange(size)
        base = pixels[x, y]
        pixels[x, y] = (
            clamp(base[0] * 0.7 + 70 * 0.3),
            clamp(base[1] * 0.7 + 110 * 0.3),
            clamp(base[2] * 0.7 + 60 * 0.3),
        )

    image = ImageEnhance.Contrast(image).enhance(1.1)
    return image.filter(ImageFilter.SMOOTH)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    english = paint_rubble_sheet(1536, ENGLISH_STONE, MORTAR_EN, seed=1801, mossier=True)
    ottoman = paint_rubble_sheet(1536, OTTOMAN_STONE, MORTAR_OT, seed=1802, mossier=False)
    shared = paint_rubble_sheet(1536, ENGLISH_STONE, MORTAR_EN, seed=1803, mossier=True)
    walk = paint_walkway(1536, seed=1810)

    english_path = OUT / "english-fortification-masonry.png"
    ottoman_path = OUT / "ottoman-fortification-masonry.png"
    shared_path = OUT / "fortification-masonry.webp"
    walk_path = OUT / "fortification-walkway.webp"

    english.save(english_path, format="PNG", optimize=True)
    ottoman.save(ottoman_path, format="PNG", optimize=True)
    shared.save(shared_path, format="WEBP", lossless=True, method=6)
    walk.save(walk_path, format="WEBP", lossless=True, method=6)

    print(f"wrote {english_path.relative_to(ROOT)} ({english_path.stat().st_size})")
    print(f"wrote {ottoman_path.relative_to(ROOT)} ({ottoman_path.stat().st_size})")
    print(f"wrote {shared_path.relative_to(ROOT)} ({shared_path.stat().st_size})")
    print(f"wrote {walk_path.relative_to(ROOT)} ({walk_path.stat().st_size})")


if __name__ == "__main__":
    main()
