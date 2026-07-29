#!/usr/bin/env python3
"""Generate 18th-century fortification masonry and walkway textures.

Coursed squared rubble in the manner of English bastioned fronts of the
1700s (Berwick, Tilbury, Fort George): warm grey-buff limestone laid in
uneven courses with thin lime mortar, restrained weathering and no bright
moss confetti. The sheets tile horizontally — the renderer samples a
world-UV strip so neighbouring wall modules must join without a seam.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "buildings"

# English curtain: cool grey limestone with buff undertones. Values stay in a
# narrow family — variety comes from tone, never from hue swings.
ENGLISH_STONE = [
    (107, 106, 96), (96, 95, 86), (118, 116, 105), (88, 88, 80),
    (126, 123, 111), (101, 99, 88), (112, 109, 97), (93, 93, 86),
    (121, 119, 109), (84, 84, 77), (131, 128, 117),
]
ENGLISH_MORTAR = (77, 76, 68)
ENGLISH_MORTAR_LIT = (98, 96, 86)

# Ottoman curtain: warmer sandy ashlar.
OTTOMAN_STONE = [
    (150, 138, 116), (137, 126, 106), (162, 149, 126), (128, 118, 100),
    (156, 144, 121), (143, 132, 111), (122, 113, 96), (168, 155, 131),
    (147, 136, 114), (133, 123, 104), (158, 146, 123),
]
OTTOMAN_MORTAR = (108, 99, 83)
OTTOMAN_MORTAR_LIT = (131, 121, 102)

WALK_STONE = [
    (104, 102, 94), (93, 92, 85), (114, 112, 103), (86, 85, 79),
    (120, 117, 107), (98, 96, 89), (108, 106, 97),
]
WALK_MORTAR = (70, 69, 62)


def clamp(value: float, low: int = 0, high: int = 255) -> int:
    return max(low, min(high, int(round(value))))


def tone(color: tuple[int, int, int], delta: float) -> tuple[int, int, int]:
    """Shift value only — hue and saturation stay in the stone family."""
    return tuple(clamp(channel + delta) for channel in color)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(clamp(a[i] * (1 - t) + b[i] * t) for i in range(3))


def mortar_bed(size: int, mortar, mortar_lit, rng) -> Image.Image:
    image = Image.new("RGB", (size, size), mortar)
    pixels = image.load()
    for y in range(size):
        wave = math.sin(y * 0.045) * 3.5
        for x in range(size):
            n = (
                math.sin(x * 0.031 + y * 0.017) * 3.0
                + wave
                + rng.uniform(-4.5, 4.5)
            )
            base = mortar if rng.random() < 0.8 else mortar_lit
            pixels[x, y] = tone(base, n)
    return image


def draw_stone(draw, rng, x0, y0, x1, y1, base, wrap_size=None):
    """One squared-rubble block with a soft bevel: lit top/left arris, shaded
    bed joint, faint tool marks. Coordinates may run past the sheet edge when
    wrap_size is given, in which case the block is repeated shifted by the
    sheet width so the texture tiles horizontally."""
    width = x1 - x0
    height = y1 - y0
    if width < 4 or height < 4:
        return
    face = tone(base, rng.uniform(-7, 7))
    spans = [(x0, y0, x1, y1)]
    if wrap_size is not None:
        if x1 > wrap_size:
            spans.append((x0 - wrap_size, y0, x1 - wrap_size, y1))
        if x0 < 0:
            spans.append((x0 + wrap_size, y0, x1 + wrap_size, y1))
    for sx0, sy0, sx1, sy1 in spans:
        # Slightly irregular quad — hand-squared, not sawn.
        jitter = min(2.5, width * 0.06)
        poly = [
            (sx0 + rng.uniform(0, jitter), sy0 + rng.uniform(0, jitter)),
            (sx1 - rng.uniform(0, jitter), sy0 + rng.uniform(0, jitter)),
            (sx1 - rng.uniform(0, jitter * 0.6), sy1 - rng.uniform(0, jitter)),
            (sx0 + rng.uniform(0, jitter * 0.6), sy1 - rng.uniform(0, jitter)),
        ]
        draw.polygon(poly, fill=face)
        # Bevels: lit upper arris, shaded bed.
        draw.line([poly[0], poly[1]], fill=tone(face, 16), width=1)
        draw.line([poly[0], poly[3]], fill=tone(face, 9), width=1)
        draw.line([poly[3], poly[2]], fill=tone(face, -18), width=2)
        draw.line([poly[1], poly[2]], fill=tone(face, -10), width=1)
        # Sparse tool marks / spalls.
        for _ in range(rng.randint(0, 2)):
            mx = rng.uniform(sx0 + width * 0.2, sx1 - width * 0.2)
            my = rng.uniform(sy0 + height * 0.25, sy1 - height * 0.2)
            length = rng.uniform(3, min(9, width * 0.3))
            angle = rng.uniform(-0.5, 0.5)
            draw.line(
                [(mx, my), (mx + math.cos(angle) * length, my + math.sin(angle) * length)],
                fill=tone(face, -13),
                width=1,
            )
        if rng.random() < 0.22:
            fx = rng.uniform(sx0 + 3, sx1 - 3)
            fy = rng.uniform(sy0 + 3, sy1 - 3)
            draw.ellipse((fx - 1.5, fy - 1, fx + 1.5, fy + 1), fill=tone(face, 11))


def paint_coursed_rubble(
    size: int,
    stones,
    mortar,
    mortar_lit,
    seed: int,
    weathering: float = 1.0,
) -> Image.Image:
    rng = random.Random(seed)
    image = mortar_bed(size, mortar, mortar_lit, rng)
    draw = ImageDraw.Draw(image)

    # Uneven courses; occasional taller "riser" course, thin bed joints.
    y = -rng.randint(4, 14)
    course = 0
    while y < size + 8:
        course_h = rng.randint(30, 44)
        if course % 5 == 3:
            course_h = rng.randint(48, 62)  # riser course
        joint = rng.randint(3, 5)
        x = -rng.randint(6, 48)
        while x < size:
            w = rng.uniform(course_h * 1.1, course_h * 2.6)
            if rng.random() < 0.14:
                w = course_h * rng.uniform(0.8, 1.05)  # header stone
            base = rng.choice(stones)
            h = course_h * rng.uniform(0.92, 1.0)
            draw_stone(draw, rng, x, y, x + w, y + h, base, wrap_size=size)
            # Occasional pinning stone in the joint above.
            if rng.random() < 0.18:
                px = x + w * rng.uniform(0.2, 0.8)
                draw_stone(
                    draw, rng, px, y + h - 2, px + rng.uniform(8, 16),
                    y + h + joint + 2, tone(rng.choice(stones), -6), wrap_size=size,
                )
            x += w + joint
        y += course_h + joint
        course += 1

    pixels = image.load()

    # Damp rising from the foot of the wall (bottom of sheet) — value shift
    # only, restrained.
    damp_rows = int(size * 0.22 * weathering)
    for row in range(damp_rows):
        yy = size - 1 - row
        strength = (1 - row / max(1, damp_rows)) * 0.30 * weathering
        for x in range(size):
            if rng.random() < 0.6:
                pixels[x, yy] = mix(pixels[x, yy], (52, 54, 47), strength * rng.uniform(0.5, 1.0))

    # A few thin water stains under imagined drips.
    for _ in range(int(10 * weathering)):
        sx = rng.randrange(size)
        sy = rng.randrange(0, size // 2)
        length = rng.randint(30, 130)
        for step in range(length):
            px = clamp(sx + rng.randint(-1, 1), 0, size - 1)
            py = clamp(sy + step, 0, size - 1)
            fade = 1 - step / length
            pixels[px, py] = mix(pixels[px, py], (58, 60, 52), 0.20 * fade)
            sx = px

    # Restrained lichen: dusty grey-green and pale ochre rosettes, low alpha.
    for _ in range(int(140 * weathering)):
        lx = rng.randrange(size)
        ly = rng.randrange(size)
        radius = rng.uniform(1.2, 4.6)
        colour = (110, 112, 88) if rng.random() < 0.6 else (128, 118, 86)
        alpha = rng.uniform(0.10, 0.26)
        for _ in range(int(radius * radius * 1.8)):
            ang = rng.uniform(0, math.tau)
            r = radius * math.sqrt(rng.random())
            px = clamp(lx + math.cos(ang) * r, 0, size - 1)
            py = clamp(ly + math.sin(ang) * r, 0, size - 1)
            pixels[px, py] = mix(pixels[px, py], colour, alpha * rng.uniform(0.5, 1.0))

    # Grain, gentle contrast; keep joints readable after downscale.
    noise = Image.effect_noise((size, size), 16).convert("L")
    image = Image.blend(image, Image.merge("RGB", (noise, noise, noise)), 0.05)
    image = ImageEnhance.Contrast(image).enhance(1.06)
    image = ImageEnhance.Sharpness(image).enhance(1.12)
    return image.filter(ImageFilter.SMOOTH)


def paint_walkway(size: int, seed: int) -> Image.Image:
    """Broad worn flagstones for the terreplein walk, with dressed kerb bands
    along the top and bottom edges (the renderer samples those separately)."""
    rng = random.Random(seed)
    image = mortar_bed(size, WALK_MORTAR, tone(WALK_MORTAR, 16), rng)
    draw = ImageDraw.Draw(image)

    y = -10
    row = 0
    while y < size + 30:
        row_h = rng.randint(56, 88)
        joint = rng.randint(3, 5)
        x = -rng.randint(10, 60) + (row % 2) * 34
        while x < size:
            w = rng.uniform(row_h * 1.0, row_h * 1.9)
            base = rng.choice(WALK_STONE)
            draw_stone(draw, rng, x, y, x + w, y + row_h, base, wrap_size=size)
            x += w + joint
        y += row_h + joint
        row += 1

    pixels = image.load()

    # Dressed kerb bands top and bottom.
    for band_y0, band_y1 in ((0, int(size * 0.16)), (int(size * 0.84), size)):
        x = -rng.randint(0, 30)
        while x < size:
            w = rng.randint(70, 130)
            base = tone(rng.choice(WALK_STONE), 14)
            draw_stone(draw, rng, x, band_y0 + 2, x + w, band_y1 - 2, base, wrap_size=size)
            x += w + 4

    # Foot-worn sheen down the centre of the walk.
    centre = size * 0.5
    for _ in range(size * 10):
        x = int(clamp(rng.gauss(centre, size * 0.16), 0, size - 1))
        yy = rng.randrange(size)
        pixels[x, yy] = tone(pixels[x, yy], rng.uniform(4, 12))

    # Faint damp patches, no bright moss.
    for _ in range(240):
        lx = rng.randrange(size)
        ly = rng.randrange(size)
        pixels[lx, ly] = mix(pixels[lx, ly], (84, 90, 72), rng.uniform(0.12, 0.3))

    # Per-stone speckle and grit so the flags keep tooth after compression —
    # the walk is the plane players stare at when troops man the parapet.
    for _ in range(size * size // 9):
        gx = rng.randrange(size)
        gy = rng.randrange(size)
        pixels[gx, gy] = tone(pixels[gx, gy], rng.uniform(-9, 9))

    noise = Image.effect_noise((size, size), 14).convert("L")
    image = Image.blend(image, Image.merge("RGB", (noise, noise, noise)), 0.05)
    image = ImageEnhance.Contrast(image).enhance(1.05)
    return image.filter(ImageFilter.SMOOTH)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    english = paint_coursed_rubble(
        1536, ENGLISH_STONE, ENGLISH_MORTAR, ENGLISH_MORTAR_LIT, seed=1801, weathering=1.0,
    )
    ottoman = paint_coursed_rubble(
        1536, OTTOMAN_STONE, OTTOMAN_MORTAR, OTTOMAN_MORTAR_LIT, seed=1802, weathering=0.6,
    )
    shared = paint_coursed_rubble(
        1536, ENGLISH_STONE, ENGLISH_MORTAR, ENGLISH_MORTAR_LIT, seed=1803, weathering=1.0,
    )
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
