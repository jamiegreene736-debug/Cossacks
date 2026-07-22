#!/usr/bin/env python3
"""Generate original StarWars-inspired production art.

The assets intentionally use broad space-opera motifs instead of copying named
ships, characters, logos, or costumes: desert moisture machinery, stacked
spaceport forms, monastery spires, domes, glowing utility strips, layered
travel robes, helmets, tools, skiffs, and pulse artillery.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILDING_DIR = ROOT / "assets" / "buildings"
UNIT_DIR = ROOT / "assets" / "units"

BUILDING_SIZE = (720, 560)
UNIT_CELL = (384, 448)
UNIT_COLUMNS = 4
UNIT_ROWS = 6


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
  value = hex_color.lstrip("#")
  return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
  return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def jitter(color: tuple[int, int, int, int], amount: int, rng: random.Random) -> tuple[int, int, int, int]:
  r, g, b, a = color
  return (
    max(0, min(255, r + rng.randint(-amount, amount))),
    max(0, min(255, g + rng.randint(-amount, amount))),
    max(0, min(255, b + rng.randint(-amount, amount))),
    a,
  )


def iso_poly(cx: float, cy: float, w: float, d: float) -> list[tuple[float, float]]:
  return [(cx, cy - d), (cx + w, cy), (cx, cy + d), (cx - w, cy)]


def draw_poly(draw: ImageDraw.ImageDraw, points, fill, outline=None, width: int = 1) -> None:
  draw.polygon(points, fill=fill)
  if outline:
    draw.line(points + [points[0]], fill=outline, width=width, joint="curve")


def lit_panel(draw: ImageDraw.ImageDraw, points, base, lit, shade, outline) -> None:
  draw_poly(draw, points, base, outline, 2)
  cx = sum(p[0] for p in points) / len(points)
  cy = sum(p[1] for p in points) / len(points)
  for scale, color in [(0.76, lit), (0.48, mix(lit, shade, 0.35))]:
    inner = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in points]
    draw_poly(draw, inner, color, None)


def draw_shadow(draw: ImageDraw.ImageDraw, cx: int, cy: int, rx: int, ry: int) -> None:
  for i in range(8, 0, -1):
    alpha = int(8 + i * 5)
    draw.ellipse((cx - rx * i / 8, cy - ry * i / 8, cx + rx * i / 8, cy + ry * i / 8),
                 fill=(25, 25, 38, alpha))


def add_surface_texture(image: Image.Image, seed: int, strength: int = 9, flecks: int = 900) -> None:
  rng = random.Random(seed)
  pix = image.load()
  width, height = image.size
  for y in range(height):
    for x in range(width):
      r, g, b, a = pix[x, y]
      if a <= 0:
        continue
      n = rng.randint(-strength, strength)
      pix[x, y] = (
        max(0, min(255, r + n)),
        max(0, min(255, g + n)),
        max(0, min(255, b + n)),
        a,
      )
  draw = ImageDraw.Draw(image, "RGBA")
  for _ in range(flecks):
    x = rng.randrange(width)
    y = rng.randrange(height)
    if pix[x, y][3] <= 0:
      continue
    c = (255, 245, 210, rng.randint(12, 34)) if rng.random() < 0.55 else (12, 18, 31, rng.randint(16, 42))
    draw.rectangle((x, y, x + rng.randint(1, 3), y + rng.randint(1, 2)), fill=c)


def draw_glow(draw: ImageDraw.ImageDraw, x: float, y: float, rx: float, ry: float, color: tuple[int, int, int, int]) -> None:
  for i in range(7, 0, -1):
    alpha = int(color[3] * (i / 7) ** 2 * 0.42)
    draw.ellipse((x - rx * i / 7, y - ry * i / 7, x + rx * i / 7, y + ry * i / 7),
                 fill=(color[0], color[1], color[2], alpha))
  draw.ellipse((x - rx * 0.24, y - ry * 0.24, x + rx * 0.24, y + ry * 0.24), fill=color)


def draw_pipe_bundle(draw: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float, rng: random.Random) -> None:
  for i in range(5):
    off = (i - 2) * 5
    color = jitter(rgba("#77808b"), 10, rng)
    draw.line((x0, y0 + off, x1, y1 + off * 0.45), fill=rgba("#1b202a"), width=8)
    draw.line((x0, y0 + off - 1, x1, y1 + off * 0.45 - 1), fill=color, width=4)


def draw_spire(draw: ImageDraw.ImageDraw, cx: float, base_y: float, h: float, w: float, color, trim, rng: random.Random) -> None:
  left = cx - w / 2
  right = cx + w / 2
  top = base_y - h
  draw.polygon([(left, base_y), (right, base_y), (right - 7, top + 24), (cx, top), (left + 7, top + 24)],
               fill=color, outline=rgba("#182032"))
  draw.line((left + 7, base_y - 8, cx, top + 12, right - 7, base_y - 8), fill=trim, width=3)
  for i in range(5):
    y = base_y - 20 - i * h / 6
    draw.line((left + 5, y, right - 5, y - 2), fill=jitter(rgba("#2c3444"), 6, rng), width=3)
  draw_glow(draw, cx, top + 18, 8, 10, rgba("#74e8ff", 180))


def draw_dome(draw: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float, base, lit, outline) -> None:
  draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=base, outline=outline, width=2)
  draw.arc((cx - rx + 8, cy - ry + 7, cx + rx - 12, cy + ry - 4), 188, 342, fill=lit, width=4)
  for i in range(-2, 3):
    x = cx + i * rx * 0.28
    draw.line((x, cy - ry * 0.75, x + i * 4, cy + ry * 0.55), fill=rgba("#293341", 120), width=2)


def draw_moisture_tower(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float, rng: random.Random) -> None:
  metal = rgba("#aeb3aa")
  dark = rgba("#29313c")
  draw.line((x, y, x, y - 86 * scale), fill=dark, width=7)
  draw.line((x, y, x, y - 86 * scale), fill=metal, width=4)
  for i in range(5):
    yy = y - (18 + i * 13) * scale
    draw.line((x - 24 * scale, yy, x + 24 * scale, yy - 4 * scale), fill=dark, width=4)
    draw.line((x - 21 * scale, yy - 1, x + 21 * scale, yy - 5 * scale), fill=jitter(metal, 8, rng), width=2)
  draw.ellipse((x - 11 * scale, y - 99 * scale, x + 11 * scale, y - 77 * scale),
               fill=rgba("#d7d7c8"), outline=dark, width=2)
  draw_glow(draw, x + 14 * scale, y - 62 * scale, 5 * scale, 5 * scale, rgba("#66d9ff", 170))


def draw_building(slug: str, seed: int) -> Image.Image:
  rng = random.Random(seed)
  image = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw = ImageDraw.Draw(image, "RGBA")
  cx, cy = BUILDING_SIZE[0] // 2, 394
  sand = rgba("#bca071")
  stone = rgba("#b9b4a8")
  stone_lit = rgba("#e5ddc9")
  stone_shade = rgba("#6d7280")
  metal = rgba("#858f99")
  dark = rgba("#182032")
  blue = rgba("#66d9ff")
  amber = rgba("#f1c66b")

  draw_shadow(draw, cx + 42, cy + 68, 230, 64)
  apron = iso_poly(cx, cy + 44, 245, 92)
  lit_panel(draw, apron, rgba("#786f66", 190), rgba("#9d9586", 150), rgba("#34343b", 120), rgba("#20242c", 180))
  for i in range(14):
    px = cx - 190 + i * 29
    draw.line((px, cy - 32, px + 70, cy + 72), fill=rgba("#272b33", 70), width=2)
  for i in range(8):
    py = cy - 18 + i * 14
    draw.line((cx - 218, py, cx + 218, py + 4), fill=rgba("#e5d4ac", 38), width=2)

  if slug == "town-center":
    lit_panel(draw, [(cx - 168, cy - 64), (cx + 128, cy - 88), (cx + 184, cy + 18), (cx - 122, cy + 54)],
              rgba("#a99f91"), stone_lit, rgba("#5f6571"), dark)
    lit_panel(draw, [(cx - 118, cy - 160), (cx + 120, cy - 186), (cx + 146, cy - 82), (cx - 140, cy - 60)],
              rgba("#c4b8a4"), rgba("#eee1c9"), rgba("#707784"), dark)
    draw_dome(draw, cx - 78, cy - 169, 64, 38, rgba("#d2c4ae"), rgba("#fff1cc"), dark)
    draw_dome(draw, cx + 86, cy - 194, 58, 32, rgba("#a5afbd"), rgba("#eff7ff"), dark)
    for dx, h, w in [(-182, 152, 38), (166, 182, 44), (16, 226, 52)]:
      draw_spire(draw, cx + dx, cy - 58, h, w, rgba("#818b9a"), blue, rng)
    for i in range(9):
      draw_glow(draw, cx - 104 + i * 28, cy - 84 - (i % 2) * 7, 6, 4, rgba("#71e4ff", 170))
    draw_pipe_bundle(draw, cx - 160, cy + 24, cx + 124, cy - 36, rng)
  elif slug == "house":
    lit_panel(draw, [(cx - 150, cy - 34), (cx + 96, cy - 68), (cx + 140, cy + 24), (cx - 108, cy + 58)],
              rgba("#bca886"), rgba("#e8d9b5"), rgba("#736852"), dark)
    for dx in [-112, -44, 34, 94]:
      draw_dome(draw, cx + dx, cy - 70 - abs(dx) * 0.06, 42, 27, rgba("#d6c5a3"), rgba("#fff3cc"), dark)
    for dx in [-176, 160]:
      draw_moisture_tower(draw, cx + dx, cy + 58, 0.72, rng)
    for i in range(11):
      draw_glow(draw, cx - 118 + i * 24, cy - 22 + (i % 2) * 5, 4, 3, rgba("#6ee7ff", 155))
  elif slug == "mill":
    lit_panel(draw, [(cx - 135, cy - 42), (cx + 116, cy - 76), (cx + 156, cy + 12), (cx - 96, cy + 48)],
              rgba("#9b9487"), rgba("#d8d0bd"), rgba("#5b6070"), dark)
    for dx in [-86, -22, 42, 104]:
      draw_moisture_tower(draw, cx + dx, cy + 30 + (dx % 3) * 5, 0.86, rng)
    draw.arc((cx - 132, cy - 108, cx + 150, cy + 88), 205, 330, fill=blue, width=8)
    draw.line((cx - 95, cy + 42, cx + 138, cy - 50), fill=rgba("#263040"), width=7)
    draw.line((cx - 95, cy + 38, cx + 138, cy - 54), fill=rgba("#b8c2c5"), width=3)
  elif slug == "lumber-camp":
    lit_panel(draw, [(cx - 164, cy - 28), (cx + 120, cy - 70), (cx + 162, cy + 30), (cx - 120, cy + 68)],
              rgba("#8e8171"), rgba("#cfc0a1"), rgba("#4b4b50"), dark)
    for i in range(10):
      x = cx - 150 + i * 33
      draw.rounded_rectangle((x, cy - 86 + (i % 3) * 8, x + 92, cy - 74 + (i % 3) * 8),
                             radius=6, fill=jitter(rgba("#826344"), 10, rng), outline=rgba("#2d2119"))
      draw.line((x + 5, cy - 82 + (i % 3) * 8, x + 86, cy - 78 + (i % 3) * 8),
                fill=rgba("#d4ae74", 110), width=2)
    draw_spire(draw, cx + 142, cy - 20, 150, 34, metal, blue, rng)
    draw_pipe_bundle(draw, cx - 130, cy + 38, cx + 104, cy - 30, rng)
  elif slug == "mine":
    lit_panel(draw, [(cx - 170, cy - 20), (cx + 118, cy - 82), (cx + 176, cy + 16), (cx - 102, cy + 74)],
              rgba("#7b746f"), rgba("#c1b8a9"), rgba("#424953"), dark)
    for i in range(7):
      x = cx - 118 + i * 38
      draw.polygon([(x, cy + 22), (x + 32, cy + 8), (x + 48, cy + 26), (x + 14, cy + 42)],
                   fill=jitter(rgba("#696f78"), 15, rng), outline=dark)
      draw_glow(draw, x + 26, cy + 20, 6, 4, rgba("#8defff", 150))
    draw_spire(draw, cx - 160, cy - 22, 112, 30, metal, amber, rng)
    draw_spire(draw, cx + 158, cy - 42, 132, 34, metal, blue, rng)
  elif slug == "barracks":
    lit_panel(draw, [(cx - 184, cy - 48), (cx + 144, cy - 92), (cx + 194, cy + 24), (cx - 138, cy + 72)],
              rgba("#8d929b"), rgba("#dce0dd"), rgba("#4d5562"), dark)
    for i in range(8):
      x = cx - 140 + i * 40
      draw.rounded_rectangle((x, cy - 86 - (i % 2) * 8, x + 24, cy - 22 - (i % 2) * 8),
                             radius=4, fill=jitter(rgba("#66717c"), 10, rng), outline=dark, width=2)
      draw_glow(draw, x + 12, cy - 70 - (i % 2) * 8, 5, 18, rgba("#76e6ff", 120))
    draw.arc((cx - 210, cy - 120, cx + 210, cy + 86), 202, 333, fill=rgba("#cfd8dc", 190), width=6)
  elif slug == "stable":
    lit_panel(draw, [(cx - 174, cy - 36), (cx + 136, cy - 80), (cx + 184, cy + 18), (cx - 124, cy + 62)],
              rgba("#90959b"), rgba("#dde0d5"), rgba("#545a64"), dark)
    for i in range(5):
      x = cx - 125 + i * 62
      draw.ellipse((x - 30, cy - 62, x + 30, cy - 14), fill=jitter(rgba("#697887"), 10, rng), outline=dark, width=2)
      draw.line((x - 34, cy - 38, x + 34, cy - 58), fill=rgba("#d7e7e7", 140), width=4)
      draw_glow(draw, x + 8, cy - 40, 6, 5, rgba("#6ee7ff", 155))
    draw_pipe_bundle(draw, cx - 170, cy + 34, cx + 150, cy - 35, rng)
  elif slug == "foundry":
    lit_panel(draw, [(cx - 174, cy - 36), (cx + 140, cy - 88), (cx + 188, cy + 22), (cx - 120, cy + 72)],
              rgba("#787f87"), rgba("#c8d0d1"), rgba("#3e4751"), dark)
    for dx, h in [(-130, 128), (-52, 166), (56, 148), (142, 118)]:
      draw.rounded_rectangle((cx + dx - 20, cy - h, cx + dx + 20, cy - 30), radius=9,
                             fill=jitter(metal, 8, rng), outline=dark, width=2)
      draw_glow(draw, cx + dx, cy - h + 20, 9, 18, rgba("#f7ba5b", 118))
    for i in range(6):
      draw_glow(draw, cx - 115 + i * 46, cy - 22 + (i % 2) * 8, 7, 5, rgba("#6ee7ff", 150))
  elif slug == "tower":
    draw_spire(draw, cx, cy + 28, 265, 82, rgba("#798493"), blue, rng)
    draw_spire(draw, cx - 86, cy + 50, 152, 42, rgba("#969eaa"), amber, rng)
    draw_spire(draw, cx + 86, cy + 42, 176, 46, rgba("#8a95a2"), blue, rng)
    for r in [118, 86, 54]:
      draw.arc((cx - r, cy - 170 - r * 0.25, cx + r, cy + r * 0.25), 205, 335, fill=rgba("#74e8ff", 135), width=4)
  elif slug == "castle":
    lit_panel(draw, [(cx - 230, cy - 44), (cx + 188, cy - 122), (cx + 250, cy + 34), (cx - 154, cy + 102)],
              rgba("#8e929a"), rgba("#d9ddd9"), rgba("#474f59"), dark)
    lit_panel(draw, [(cx - 170, cy - 156), (cx + 154, cy - 222), (cx + 190, cy - 102), (cx - 142, cy - 48)],
              rgba("#b3b2a9"), rgba("#f1ead4"), rgba("#666d78"), dark)
    for dx, h, w in [(-220, 184, 46), (-112, 235, 58), (0, 286, 70), (118, 230, 54), (224, 190, 46)]:
      draw_spire(draw, cx + dx, cy - 42, h, w, rgba("#788494"), blue if dx != 0 else amber, rng)
    for i in range(14):
      draw_glow(draw, cx - 170 + i * 28, cy - 92 - (i % 3) * 9, 5, 4, rgba("#74e8ff", 150))
    draw.arc((cx - 260, cy - 228, cx + 260, cy + 96), 205, 335, fill=rgba("#cfd8dc", 180), width=8)

  for _ in range(260):
    x = rng.randint(110, 610)
    y = rng.randint(120, 445)
    if rng.random() < 0.35:
      draw.line((x, y, x + rng.randint(8, 38), y + rng.randint(-5, 5)),
                fill=rgba("#1a202b", rng.randint(35, 78)), width=rng.randint(1, 3))
    else:
      draw.rectangle((x, y, x + rng.randint(2, 7), y + rng.randint(1, 5)),
                     fill=rgba("#e8dcc0", rng.randint(26, 72)))

  add_surface_texture(image, seed + 991, 10, 2600)
  return image.filter(ImageFilter.UnsharpMask(radius=1.4, percent=72, threshold=3))


def draw_limb(draw: ImageDraw.ImageDraw, xy, color, width=18) -> None:
  draw.line(xy, fill=rgba("#111827"), width=width + 5, joint="curve")
  draw.line(xy, fill=color, width=width, joint="curve")
  draw.line(xy, fill=(255, 255, 255, 42), width=max(2, width // 4), joint="curve")


def draw_character_cell(unit: str, frame: int, seed: int) -> Image.Image:
  rng = random.Random(seed)
  cell = Image.new("RGBA", UNIT_CELL, (0, 0, 0, 0))
  draw = ImageDraw.Draw(cell, "RGBA")
  cx, gy = UNIT_CELL[0] // 2, 386
  lean = [-4, 4, 0, 6][frame]
  step = [-10, 12, -4, 8][frame]
  dark = rgba("#17202c")
  cloth = rgba("#756b5e")
  robe = rgba("#92826a")
  metal = rgba("#9aa4aa")
  blue = rgba("#63ddff")
  amber = rgba("#efbf62")
  violet = rgba("#7365d6")

  draw.ellipse((cx - 58, gy - 10, cx + 64, gy + 15), fill=(20, 24, 35, 90))

  if unit == "starwars_skiff_rider":
    draw.polygon([(cx - 110, gy - 58), (cx + 82, gy - 80), (cx + 128, gy - 44), (cx - 54, gy - 16)],
                 fill=rgba("#6b737d"), outline=dark)
    draw.line((cx - 88, gy - 47, cx + 105, gy - 72), fill=rgba("#e7e0c8", 120), width=4)
    for dx in [-60, 12, 82]:
      draw_glow(draw, cx + dx, gy - 40, 16, 6, rgba("#67e8ff", 130))
    gy -= 34

  if unit == "starwars_pulse_cannon":
    draw.rounded_rectangle((cx - 98, gy - 88, cx + 96, gy - 38), radius=20,
                           fill=rgba("#68727e"), outline=dark, width=4)
    draw.rounded_rectangle((cx - 40, gy - 115, cx + 112, gy - 80), radius=16,
                           fill=rgba("#8c969e"), outline=dark, width=4)
    draw.line((cx + 70, gy - 98, cx + 142, gy - 126), fill=dark, width=17)
    draw.line((cx + 70, gy - 100, cx + 142, gy - 128), fill=rgba("#c4ccd0"), width=9)
    draw_glow(draw, cx + 134, gy - 126, 18, 12, rgba("#7d8cff", 180 if frame == 2 else 110))
    for dx in [-68, 58]:
      draw.ellipse((cx + dx - 30, gy - 48, cx + dx + 30, gy - 6), fill=rgba("#333a45"), outline=dark, width=4)
      draw.ellipse((cx + dx - 14, gy - 38, cx + dx + 14, gy - 16), fill=rgba("#8f98a0"))
    add_surface_texture(cell, seed + 77, 6, 420)
    return cell

  leg_a = (cx - 18 + lean, gy - 112, cx - 28 - step, gy - 18)
  leg_b = (cx + 16 + lean, gy - 111, cx + 28 + step, gy - 20)
  draw_limb(draw, leg_a, rgba("#4e5560"), 16)
  draw_limb(draw, leg_b, rgba("#636b72"), 16)
  draw.ellipse((leg_a[2] - 18, gy - 24, leg_a[2] + 14, gy - 10), fill=dark)
  draw.ellipse((leg_b[2] - 12, gy - 25, leg_b[2] + 20, gy - 10), fill=dark)

  if unit in {"starwars_robed_villager", "starwars_blade_guard"}:
    draw.polygon([(cx - 50 + lean, gy - 250), (cx + 44 + lean, gy - 250),
                  (cx + 62 + lean, gy - 82), (cx + 24 + step, gy - 30),
                  (cx - 56 - step, gy - 32), (cx - 68 + lean, gy - 88)],
                 fill=robe, outline=dark)
    for i in range(7):
      x = cx - 42 + i * 15 + lean
      draw.line((x, gy - 228, x + rng.randint(-8, 8), gy - 48), fill=rgba("#352a20", 90), width=2)
  else:
    draw.rounded_rectangle((cx - 42 + lean, gy - 248, cx + 42 + lean, gy - 108), radius=24,
                           fill=cloth if unit == "starwars_mechanic" else rgba("#5e6570"),
                           outline=dark, width=4)
    draw.polygon([(cx - 38 + lean, gy - 230), (cx + 42 + lean, gy - 235),
                  (cx + 34 + lean, gy - 178), (cx - 46 + lean, gy - 170)],
                 fill=rgba("#d6c49c", 180), outline=rgba("#2e3440", 120))

  belt_y = gy - 142
  draw.line((cx - 50 + lean, belt_y, cx + 52 + lean, belt_y - 4), fill=dark, width=10)
  draw.line((cx - 46 + lean, belt_y - 2, cx + 48 + lean, belt_y - 6), fill=amber, width=3)
  for i in range(6):
    draw.rounded_rectangle((cx - 34 + i * 13 + lean, belt_y - 9, cx - 27 + i * 13 + lean, belt_y + 4),
                           radius=2, fill=jitter(metal, 8, rng), outline=rgba("#202633"))

  if unit in {"starwars_sentinel", "starwars_mechanic", "starwars_skiff_rider"}:
    head_box = (cx - 31 + lean, gy - 306, cx + 31 + lean, gy - 246)
    draw.rounded_rectangle(head_box, radius=20, fill=metal, outline=dark, width=4)
    draw.polygon([(cx - 31 + lean, gy - 279), (cx + 31 + lean, gy - 283),
                  (cx + 24 + lean, gy - 264), (cx - 25 + lean, gy - 260)],
                 fill=rgba("#263444"), outline=dark)
    draw_glow(draw, cx + lean, gy - 271, 22, 5, rgba("#70e9ff", 150))
  else:
    draw.ellipse((cx - 27 + lean, gy - 304, cx + 29 + lean, gy - 248),
                 fill=rgba("#d7ad8c"), outline=dark, width=3)
    hood = [(cx - 42 + lean, gy - 282), (cx - 16 + lean, gy - 322), (cx + 38 + lean, gy - 292),
            (cx + 31 + lean, gy - 246), (cx - 34 + lean, gy - 248)]
    draw.polygon(hood, fill=rgba("#6a5a49"), outline=dark)
    draw.ellipse((cx - 20 + lean, gy - 292, cx + 18 + lean, gy - 256), fill=rgba("#d7ad8c"))

  left_hand = (cx - 62 + lean, gy - 160 + step * 0.3)
  right_hand = (cx + 72 + lean, gy - 176 - step * 0.2)
  draw_limb(draw, (cx - 34 + lean, gy - 216, left_hand[0], left_hand[1]), rgba("#5d626a"), 14)
  draw_limb(draw, (cx + 34 + lean, gy - 214, right_hand[0], right_hand[1]), rgba("#717882"), 14)
  draw.ellipse((left_hand[0] - 9, left_hand[1] - 8, left_hand[0] + 9, left_hand[1] + 8), fill=rgba("#d7ad8c"), outline=dark)
  draw.ellipse((right_hand[0] - 9, right_hand[1] - 8, right_hand[0] + 9, right_hand[1] + 8), fill=rgba("#d7ad8c"), outline=dark)

  if unit in {"starwars_sentinel", "starwars_mechanic", "starwars_robed_villager", "starwars_skiff_rider"}:
    muzzle = (right_hand[0] + 66, right_hand[1] - 20)
    draw.line((right_hand[0] - 8, right_hand[1] + 2, muzzle[0], muzzle[1]), fill=dark, width=11)
    draw.line((right_hand[0] - 5, right_hand[1], muzzle[0], muzzle[1] - 1), fill=rgba("#87949d"), width=5)
    if frame == 2 or unit == "starwars_sentinel":
      draw_glow(draw, muzzle[0] + 5, muzzle[1] - 1, 13, 8, rgba("#66d9ff", 170))
  if unit == "starwars_blade_guard":
    blade_end = (right_hand[0] + 80, right_hand[1] - 76)
    draw.line((right_hand[0], right_hand[1], blade_end[0], blade_end[1]), fill=rgba("#eefcff", 120), width=14)
    draw.line((right_hand[0], right_hand[1], blade_end[0], blade_end[1]), fill=blue, width=7)
    draw.line((right_hand[0], right_hand[1], blade_end[0], blade_end[1]), fill=rgba("#ffffff", 220), width=2)
  if unit == "starwars_mechanic" and frame in {1, 3}:
    draw.line((left_hand[0], left_hand[1], left_hand[0] - 42, left_hand[1] + 38), fill=dark, width=7)
    draw.line((left_hand[0], left_hand[1], left_hand[0] - 42, left_hand[1] + 38), fill=metal, width=3)
    draw.rectangle((left_hand[0] - 52, left_hand[1] + 34, left_hand[0] - 30, left_hand[1] + 48),
                   fill=rgba("#aeb6b8"), outline=dark)

  for _ in range(90):
    x = rng.randint(92, 292)
    y = rng.randint(70, 392)
    if cell.getpixel((x, y))[3] <= 0:
      continue
    draw.point((x, y), fill=(255, 245, 210, rng.randint(25, 80)))
  add_surface_texture(cell, seed + 707, 7, 460)
  return cell


def generate_units() -> Image.Image:
  units = [
    "starwars_mechanic",
    "starwars_robed_villager",
    "starwars_sentinel",
    "starwars_blade_guard",
    "starwars_skiff_rider",
    "starwars_pulse_cannon",
  ]
  sheet = Image.new("RGBA", (UNIT_CELL[0] * UNIT_COLUMNS, UNIT_CELL[1] * UNIT_ROWS), (0, 0, 0, 0))
  for row, unit in enumerate(units):
    for frame in range(UNIT_COLUMNS):
      cell = draw_character_cell(unit, frame, 4100 + row * 97 + frame * 11)
      sheet.alpha_composite(cell, (frame * UNIT_CELL[0], row * UNIT_CELL[1]))
  return sheet.filter(ImageFilter.UnsharpMask(radius=1.1, percent=68, threshold=3))


def main() -> None:
  BUILDING_DIR.mkdir(parents=True, exist_ok=True)
  UNIT_DIR.mkdir(parents=True, exist_ok=True)
  slugs = [
    "town-center", "house", "mill", "lumber-camp", "mine",
    "barracks", "stable", "foundry", "tower", "castle",
  ]
  for index, slug in enumerate(slugs):
    image = draw_building(slug, 1700 + index * 137)
    image.save(BUILDING_DIR / f"starwars-{slug}.webp", "WEBP", lossless=True, method=6, exact=True)
  generate_units().save(UNIT_DIR / "starwars-citizens.webp", "WEBP", lossless=True, method=6, exact=True)


if __name__ == "__main__":
  main()
