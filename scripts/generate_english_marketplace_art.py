#!/usr/bin/env python3
"""Generate the English Marketplace production render.

Historical brief used for this render:
- English market houses commonly had open covered trading space at ground level.
- Upper rooms could be used for civic business, meetings, storage, or exchange.
- Seventeenth and eighteenth-century examples mix timber frame, brick infill,
  stone piers, tiled roofs, stalls, barrels, sacks, and a market-square apron.

The output is intentionally transparent WebP production art, matching the
checked-in architecture assets consumed by js/gfx/art-assets.js.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILDING_DIR = ROOT / "assets" / "buildings"
OUT = BUILDING_DIR / "english-marketplace.webp"
SIZE = (768, 640)


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
  hex_color = hex_color.lstrip("#")
  return (
    int(hex_color[0:2], 16),
    int(hex_color[2:4], 16),
    int(hex_color[4:6], 16),
    alpha,
  )


def shade(color: tuple[int, int, int, int], amount: int) -> tuple[int, int, int, int]:
  r, g, b, a = color
  return (
    max(0, min(255, r + amount)),
    max(0, min(255, g + amount)),
    max(0, min(255, b + amount)),
    a,
  )


def poly(draw: ImageDraw.ImageDraw, pts, fill, outline=None, width=1) -> None:
  draw.polygon(pts, fill=fill)
  if outline:
    draw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


def line(draw: ImageDraw.ImageDraw, pts, fill, width=1) -> None:
  draw.line(pts, fill=fill, width=width, joint="curve")


def soft_ellipse(canvas: Image.Image, box, color, blur=8) -> None:
  layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
  d = ImageDraw.Draw(layer, "RGBA")
  d.ellipse(box, fill=color)
  canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def draw_paving(canvas: Image.Image) -> None:
  draw = ImageDraw.Draw(canvas, "RGBA")
  soft_ellipse(canvas, (132, 410, 664, 565), rgba("#12110d", 80), 12)
  apron = [(145, 460), (383, 350), (640, 452), (394, 570)]
  poly(draw, apron, rgba("#7a6b52", 128), rgba("#9e8a66", 150), 2)
  rng = random.Random(1700)
  for y in range(374, 558, 14):
    offset = ((y - 374) // 14) % 2 * 16
    for x in range(170 - offset, 632, 33):
      jitter = rng.randint(-3, 3)
      p = [(x, y + jitter), (x + 30, y + 11 + jitter),
           (x + 4, y + 24 + jitter), (x - 26, y + 12 + jitter)]
      if 125 < x < 666:
        poly(draw, p, rgba("#8c7c5e", rng.randint(52, 88)), rgba("#514834", 40), 1)


def draw_goods(draw: ImageDraw.ImageDraw) -> None:
  # foreground baskets, crates and sacks that identify the building as trade.
  for x, y, w, h in [(224, 457, 46, 24), (543, 457, 52, 26), (485, 488, 44, 22)]:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=4,
                           fill=rgba("#7b5331", 230), outline=rgba("#2d1d12", 210), width=2)
    for lx in range(x + 8, x + w, 11):
      line(draw, [(lx, y + 3), (lx - 4, y + h - 3)], rgba("#b38957", 115), 1)
  for x, y in [(290, 472), (317, 483), (575, 486), (603, 476), (196, 488)]:
    draw.ellipse((x - 14, y - 9, x + 15, y + 11), fill=rgba("#c8b078", 225),
                 outline=rgba("#5a482e", 190), width=2)
    line(draw, [(x - 8, y - 2), (x + 9, y + 3)], rgba("#f0dc9f", 150), 1)
  for x, y in [(247, 432), (522, 433)]:
    draw.ellipse((x - 15, y - 22, x + 15, y + 22), fill=rgba("#6e4324", 230),
                 outline=rgba("#26170f", 220), width=2)
    line(draw, [(x - 15, y), (x + 15, y)], rgba("#b68a56", 130), 2)
    line(draw, [(x, y - 20), (x, y + 20)], rgba("#352015", 100), 1)


def draw_stall(draw: ImageDraw.ImageDraw, x: int, y: int, flip: int = 1) -> None:
  roof = [(x, y), (x + 76 * flip, y - 18), (x + 105 * flip, y + 5), (x + 25 * flip, y + 25)]
  poly(draw, roof, rgba("#b84438", 230), rgba("#5e241d", 210), 2)
  for i in range(5):
    sx = x + (15 + i * 16) * flip
    poly(draw, [(sx, y - 3), (sx + 12 * flip, y - 6), (sx + 18 * flip, y + 12), (sx + 4 * flip, y + 15)],
         rgba("#e6d39c" if i % 2 else "#ad3b31", 210), None, 1)
  line(draw, [(x + 12 * flip, y + 20), (x + 14 * flip, y + 62)], rgba("#3d281c", 220), 3)
  line(draw, [(x + 88 * flip, y + 9), (x + 90 * flip, y + 54)], rgba("#3d281c", 220), 3)
  draw.rectangle((min(x + 18 * flip, x + 86 * flip), y + 48,
                  max(x + 18 * flip, x + 86 * flip), y + 61),
                 fill=rgba("#714625", 215), outline=rgba("#24160d", 190), width=1)


def draw_market_house(canvas: Image.Image) -> None:
  draw = ImageDraw.Draw(canvas, "RGBA")
  # Main masses: an isometric market house, open arcade below and timber/brick room above.
  left = [(219, 334), (383, 269), (383, 398), (219, 464)]
  front = [(383, 269), (557, 335), (557, 462), (383, 398)]
  side = [(219, 334), (383, 398), (557, 462), (390, 536), (219, 464)]
  poly(draw, side, rgba("#6f5439", 230), rgba("#2a2018", 210), 2)
  poly(draw, left, rgba("#a36f45", 238), rgba("#2f2419", 220), 2)
  poly(draw, front, rgba("#b57b4d", 238), rgba("#2f2419", 220), 2)

  # Open stone arcade.
  arch_centers = [(265, 379), (326, 355), (438, 355), (501, 379)]
  for cx, cy in arch_centers:
    draw.rectangle((cx - 24, cy - 2, cx + 24, cy + 80), fill=rgba("#241c16", 205))
    draw.ellipse((cx - 25, cy - 31, cx + 25, cy + 31), fill=rgba("#241c16", 205))
    draw.rectangle((cx - 18, cy + 4, cx + 18, cy + 78), fill=rgba("#17110d", 230))
    draw.ellipse((cx - 19, cy - 23, cx + 19, cy + 23), fill=rgba("#17110d", 230))
    line(draw, [(cx - 27, cy + 1), (cx - 27, cy + 81)], rgba("#d8c39a", 210), 5)
    line(draw, [(cx + 27, cy + 1), (cx + 27, cy + 81)], rgba("#6c583d", 210), 5)
    draw.arc((cx - 29, cy - 31, cx + 29, cy + 31), 180, 360, fill=rgba("#ead5aa", 220), width=5)

  # Upper timber frame and brick infill.
  timber = rgba("#2e221a", 245)
  light_timber = rgba("#5f3c25", 220)
  for x0, y0, x1, y1 in [
      (231, 318, 374, 263), (391, 266, 544, 325),
      (223, 347, 381, 284), (389, 290, 553, 352),
      (223, 405, 382, 341), (389, 348, 553, 410),
  ]:
    line(draw, [(x0, y0), (x1, y1)], timber, 4)
  for x in [252, 290, 332, 416, 460, 505]:
    line(draw, [(x, 297 if x < 380 else 300), (x, 430 if x < 380 else 432)], timber, 4)
  for x, y, w, h in [(251, 309, 31, 38), (298, 291, 31, 38), (423, 309, 32, 38), (476, 329, 32, 38)]:
    draw.rectangle((x, y, x + w, y + h), fill=rgba("#1c1814", 225), outline=rgba("#e8d2a6", 190), width=2)
    line(draw, [(x + w // 2, y + 2), (x + w // 2, y + h - 2)], rgba("#dbc497", 160), 1)
    line(draw, [(x + 3, y + h // 2), (x + w - 3, y + h // 2)], rgba("#dbc497", 160), 1)
  for _ in range(85):
    x = random.randint(224, 552)
    y = random.randint(286, 427)
    if random.random() < 0.48:
      draw.point((x, y), fill=rgba("#e4a46a", random.randint(40, 90)))
    else:
      draw.point((x, y), fill=rgba("#5b3723", random.randint(35, 80)))

  # Roof planes with tile courses and dormers.
  roof_l = [(190, 329), (383, 227), (392, 272), (219, 352)]
  roof_r = [(383, 227), (590, 326), (557, 352), (392, 272)]
  poly(draw, roof_l, rgba("#563d36", 245), rgba("#1d1514", 235), 3)
  poly(draw, roof_r, rgba("#6c4c40", 245), rgba("#1d1514", 235), 3)
  for i in range(9):
    t = i / 9
    line(draw, [(198 + 20 * i, 325 - 10 * i), (222 + 20 * i, 345 - 9 * i)],
         rgba("#a37760", 115), 1)
    line(draw, [(392 + 20 * i, 276 + 10 * i), (562 + 3 * i, 348 + 1 * i)],
         rgba("#2c211f", 65), 1)
    y = 247 + i * 8
    line(draw, [(229 + i * 18, y + 50), (397 + i * 18, y + 7)], rgba("#916d5c", 70), 1)
  for dx, dy in [(310, 261), (474, 297)]:
    poly(draw, [(dx - 20, dy + 14), (dx, dy - 22), (dx + 23, dy + 16)],
         rgba("#4b342e", 245), rgba("#1a1210", 230), 2)
    draw.rectangle((dx - 12, dy + 13, dx + 13, dy + 42), fill=rgba("#8e6040", 230),
                   outline=rgba("#2a1c14", 220), width=2)
    draw.rectangle((dx - 6, dy + 22, dx + 7, dy + 35), fill=rgba("#201814", 220),
                   outline=rgba("#dac39a", 130), width=1)

  # Cupola/sign and hanging market scales.
  poly(draw, [(364, 235), (384, 203), (406, 235), (384, 250)], rgba("#4a3731", 240), rgba("#1a1312", 230), 2)
  draw.rectangle((372, 235, 397, 263), fill=rgba("#a9784b", 230), outline=rgba("#2c2017", 220), width=2)
  draw.rectangle((352, 430, 418, 458), fill=rgba("#3c2919", 240), outline=rgba("#d5b16d", 210), width=2)
  draw.text((363, 435), "MARKET", fill=rgba("#e7d099", 235))
  line(draw, [(384, 398), (384, 430)], rgba("#1d1510", 220), 3)
  line(draw, [(355, 457), (413, 457)], rgba("#d9b66f", 170), 1)

  draw_stall(draw, 168, 405, 1)
  draw_stall(draw, 608, 408, -1)
  draw_goods(draw)


def add_depth_finishing(canvas: Image.Image) -> Image.Image:
  # Warm glazing and tiny highlight/shadow speckles make the render read as a
  # detailed pre-rendered asset after it is scaled down in the game.
  rng = random.Random(1747)
  layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
  d = ImageDraw.Draw(layer, "RGBA")
  alpha = canvas.getchannel("A").filter(ImageFilter.GaussianBlur(1.0))
  for _ in range(1900):
    x = rng.randrange(155, 640)
    y = rng.randrange(225, 545)
    if alpha.getpixel((x, y)) < 12:
      continue
    if rng.random() < 0.55:
      color = rgba("#fff0c3", rng.randint(10, 28))
    else:
      color = rgba("#21170f", rng.randint(12, 34))
    d.point((x, y), fill=color)
  canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.25)))
  return canvas.filter(ImageFilter.UnsharpMask(radius=1.05, percent=82, threshold=2))


def main() -> None:
  canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
  draw_paving(canvas)
  draw_market_house(canvas)
  finished = add_depth_finishing(canvas)
  OUT.parent.mkdir(parents=True, exist_ok=True)
  finished.save(OUT, "WEBP", lossless=True, method=6, exact=True)
  print(OUT)


if __name__ == "__main__":
  main()
