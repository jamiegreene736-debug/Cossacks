#!/usr/bin/env python3
"""Generate high-detail themed architecture sprites.

The English housing set composes new, explicit house choices from the existing
high-resolution Georgian source so the in-game build buttons are deterministic
instead of ID-seeded variants. The StarWars-inspired set keeps to broad
space-opera motifs: desert masonry, luminous utility strips, moisture towers,
temple spires, skiff hangars, and industrial machinery without logos or exact
named prop replicas.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILDING_DIR = ROOT / "assets" / "buildings"
BUILDING_SIZE = (720, 560)
RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
  value = hex_color.lstrip("#")
  return (
    int(value[0:2], 16),
    int(value[2:4], 16),
    int(value[4:6], 16),
    alpha,
  )


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


def crop_alpha(image: Image.Image) -> Image.Image:
  box = image.getchannel("A").getbbox()
  return image.crop(box) if box else image


def resized(image: Image.Image, width: int) -> Image.Image:
  height = max(1, round(width * image.height / image.width))
  return image.resize((width, height), RESAMPLE)


def tint_image(image: Image.Image, color: tuple[int, int, int, int] | None) -> Image.Image:
  if not color:
    return image
  overlay = Image.new("RGBA", image.size, color)
  output = Image.alpha_composite(image, overlay)
  output.putalpha(image.getchannel("A"))
  return output


def paste_bottom(canvas: Image.Image, source: Image.Image, cx: int, bottom: int, width: int,
                 tint: tuple[int, int, int, int] | None = None) -> tuple[int, int, int, int]:
  sprite = tint_image(resized(source, width), tint)
  left = round(cx - sprite.width / 2)
  top = bottom - sprite.height
  canvas.alpha_composite(sprite, (left, top))
  return left, top, sprite.width, sprite.height


def draw_soft_shadow(canvas: Image.Image, cx: int, cy: int, rx: int, ry: int, alpha: int = 105) -> None:
  shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
  d = ImageDraw.Draw(shadow, "RGBA")
  for step in range(8, 0, -1):
    a = round(alpha * (step / 8) ** 2)
    d.ellipse((
      cx - rx * step / 8,
      cy - ry * step / 8,
      cx + rx * step / 8,
      cy + ry * step / 8,
    ), fill=(17, 19, 25, a))
  canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5)))


def iso_poly(cx: float, cy: float, w: float, d: float) -> list[tuple[float, float]]:
  return [(cx, cy - d), (cx + w, cy), (cx, cy + d), (cx - w, cy)]


def polygon(draw: ImageDraw.ImageDraw, points, fill, outline=None, width: int = 1) -> None:
  draw.polygon(points, fill=fill)
  if outline:
    draw.line(points + [points[0]], fill=outline, width=width, joint="curve")


def draw_english_ground(canvas: Image.Image, cx: int, cy: int, rx: int, ry: int, seed: int) -> None:
  rng = random.Random(seed)
  draw_soft_shadow(canvas, cx + 36, cy + 22, rx, ry, 95)
  draw = ImageDraw.Draw(canvas, "RGBA")
  apron = iso_poly(cx, cy, rx, ry)
  polygon(draw, apron, rgba("#807b70", 150), rgba("#3b3834", 80), 1)
  for i in range(16):
    x = cx - rx + i * rx * 2 / 15
    draw.line((x, cy - ry * 0.78, x + rx * 0.38, cy + ry * 0.52),
              fill=rgba("#f0e4ca", rng.randint(18, 42)), width=1)
  for i in range(8):
    y = cy - ry * 0.60 + i * ry * 0.18
    draw.line((cx - rx * 0.72, y, cx + rx * 0.72, y + ry * 0.16),
              fill=rgba("#292622", rng.randint(16, 36)), width=1)


def draw_columned_porch(draw: ImageDraw.ImageDraw, cx: int, bottom: int, scale: float) -> None:
  stone = rgba("#d9d1bf", 230)
  shade = rgba("#6b6257", 150)
  w = 58 * scale
  h = 62 * scale
  top = bottom - h
  draw.polygon([(cx - w / 2, top), (cx + w / 2, top), (cx + w * 0.34, bottom),
                (cx - w * 0.34, bottom)], fill=rgba("#b8ad9c", 205), outline=shade)
  for off in [-w * 0.32, w * 0.32]:
    draw.rounded_rectangle((cx + off - 5 * scale, top + 8 * scale,
                            cx + off + 5 * scale, bottom), radius=2,
                           fill=stone, outline=shade, width=max(1, round(1.5 * scale)))
  draw.polygon([(cx - w * 0.62, top + 8 * scale), (cx, top - 16 * scale),
                (cx + w * 0.62, top + 8 * scale)], fill=stone, outline=shade)
  for step in range(4):
    inset = step * 9 * scale
    y = bottom + step * 5 * scale
    draw.rounded_rectangle((cx - w * 0.52 - inset, y, cx + w * 0.52 + inset, y + 4 * scale),
                           radius=2, fill=mix(stone, rgba("#6b6257"), 0.18 + step * 0.05))


def draw_thatch_roof(draw: ImageDraw.ImageDraw, cx: int, ridge_y: int, width: int, depth: int,
                     seed: int) -> None:
  rng = random.Random(seed)
  roof = [
    (cx - width * 0.55, ridge_y + depth * 0.50),
    (cx, ridge_y - depth * 0.46),
    (cx + width * 0.58, ridge_y + depth * 0.42),
    (cx + width * 0.43, ridge_y + depth * 0.68),
    (cx - width * 0.46, ridge_y + depth * 0.75),
  ]
  polygon(draw, roof, rgba("#a98954", 236), rgba("#4e3a24", 155), 2)
  for i in range(120):
    x = rng.randint(round(cx - width * 0.47), round(cx + width * 0.48))
    y = rng.randint(round(ridge_y - depth * 0.20), round(ridge_y + depth * 0.72))
    draw.line((x, y, x + rng.randint(-8, 10), y + rng.randint(8, 22)),
              fill=jitter(rgba("#d8bc79", rng.randint(95, 170)), 18, rng), width=1)


def draw_dead_tree(draw: ImageDraw.ImageDraw, x: int, y: int, scale: float) -> None:
  trunk = rgba("#241f20", 235)
  draw.line((x, y, x + 18 * scale, y - 115 * scale), fill=trunk, width=round(8 * scale))
  branches = [
    (x + 12 * scale, y - 75 * scale, x - 44 * scale, y - 122 * scale),
    (x + 18 * scale, y - 96 * scale, x + 72 * scale, y - 148 * scale),
    (x + 9 * scale, y - 44 * scale, x - 30 * scale, y - 78 * scale),
    (x + 21 * scale, y - 65 * scale, x + 47 * scale, y - 86 * scale),
  ]
  for x0, y0, x1, y1 in branches:
    draw.line((x0, y0, x1, y1), fill=trunk, width=max(1, round(3 * scale)))


def generate_english_housing() -> None:
  source = crop_alpha(Image.open(BUILDING_DIR / "english-house.webp").convert("RGBA"))
  BUILDING_DIR.mkdir(parents=True, exist_ok=True)

  specs = {
    "english-cottage.webp": lambda: compose_english_cottage(source),
    "english-townhouse.webp": lambda: compose_english_townhouse(source),
    "english-mansion.webp": lambda: compose_english_mansion(source),
    "english-spooky-house.webp": lambda: compose_english_spooky(source),
  }
  for filename, factory in specs.items():
    factory().save(BUILDING_DIR / filename, "WEBP", lossless=True, method=6, exact=True)


def compose_english_cottage(source: Image.Image) -> Image.Image:
  canvas = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw_english_ground(canvas, 356, 430, 185, 64, 3101)
  paste_bottom(canvas, source, 356, 414, 268, rgba("#fff1cc", 18))
  draw = ImageDraw.Draw(canvas, "RGBA")
  draw_columned_porch(draw, 356, 414, 0.68)
  for i in range(44):
    x = 184 + i * 8
    draw.line((x, 438, x + 5, 423 + (i % 3)), fill=rgba("#7a674a", 150), width=2)
  for i in range(26):
    x = 236 + i * 10
    y = 418 + (i % 4)
    draw.ellipse((x, y, x + 7, y + 5), fill=rgba("#465b31", 145))
  return canvas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=3))


def compose_english_townhouse(source: Image.Image) -> Image.Image:
  canvas = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw_english_ground(canvas, 360, 438, 235, 70, 3201)
  for index, cx in enumerate([260, 360, 460]):
    tint = [rgba("#4b241d", 18), rgba("#f3d7aa", 12), rgba("#2f3e53", 12)][index]
    paste_bottom(canvas, source, cx, 420 - index * 3, 245, tint)
  draw = ImageDraw.Draw(canvas, "RGBA")
  for x in [254, 360, 466]:
    draw_columned_porch(draw, x, 420, 0.54)
  draw.line((210, 232, 514, 217), fill=rgba("#f0eadb", 145), width=3)
  draw.line((212, 407, 515, 393), fill=rgba("#2f2b28", 80), width=2)
  return canvas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=76, threshold=3))


def compose_english_mansion(source: Image.Image) -> Image.Image:
  canvas = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw_english_ground(canvas, 360, 447, 292, 90, 3301)
  paste_bottom(canvas, source, 232, 420, 255, rgba("#322b28", 28))
  paste_bottom(canvas, source, 488, 420, 255, rgba("#322b28", 28))
  paste_bottom(canvas, source, 360, 411, 345, rgba("#fff3d8", 10))
  draw = ImageDraw.Draw(canvas, "RGBA")
  draw_columned_porch(draw, 360, 421, 1.06)
  for x in [205, 515]:
    draw.rounded_rectangle((x - 24, 226, x + 24, 399), radius=4,
                           fill=rgba("#5e5c61", 172), outline=rgba("#1f2025", 130), width=2)
    draw.polygon([(x - 42, 229), (x, 156), (x + 42, 229)],
                 fill=rgba("#3b414c", 230), outline=rgba("#181b22", 145))
    for y in [268, 315, 360]:
      draw.rectangle((x - 9, y, x + 9, y + 24), fill=rgba("#1d2430", 130),
                     outline=rgba("#d7cdb8", 120))
  for i in range(28):
    x = 178 + i * 14
    draw.line((x, 461, x + 6, 440), fill=rgba("#ded5c2", 130), width=2)
  return canvas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=80, threshold=3))


def compose_english_spooky(source: Image.Image) -> Image.Image:
  canvas = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw_english_ground(canvas, 360, 448, 258, 84, 3401)
  paste_bottom(canvas, source, 356, 421, 330, rgba("#15121a", 92))
  draw = ImageDraw.Draw(canvas, "RGBA")
  draw.rounded_rectangle((254, 221, 310, 407), radius=4,
                         fill=rgba("#292630", 220), outline=rgba("#09090d", 170), width=2)
  draw.polygon([(238, 224), (282, 136), (326, 224)],
               fill=rgba("#202632", 242), outline=rgba("#08090d", 190))
  for y in [260, 312, 364]:
    draw.rectangle((272, y, 292, y + 30), fill=rgba("#f0bb58", 120),
                   outline=rgba("#0b0d12", 175))
  draw_dead_tree(draw, 172, 438, 1.0)
  for i in range(7):
    x = 432 + i * 23
    draw.rectangle((x, 413 - (i % 2) * 4, x + 8, 440), fill=rgba("#3a3739", 160))
  draw.ellipse((455, 140, 489, 174), fill=rgba("#ddd1a2", 122))
  return canvas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=82, threshold=3))


def draw_textured_apron(draw: ImageDraw.ImageDraw, cx: int, cy: int, rx: int, ry: int,
                        seed: int, base: tuple[int, int, int, int]) -> None:
  rng = random.Random(seed)
  apron = iso_poly(cx, cy, rx, ry)
  polygon(draw, apron, base, rgba("#252833", 95), 1)
  for i in range(18):
    x = cx - rx + i * rx * 2 / 17
    draw.line((x, cy - ry * 0.84, x + rx * 0.42, cy + ry * 0.55),
              fill=rgba("#f2e2ba", rng.randint(20, 48)), width=1)
  for i in range(10):
    y = cy - ry * 0.70 + i * ry * 0.15
    draw.line((cx - rx * 0.78, y, cx + rx * 0.82, y + ry * 0.18),
              fill=rgba("#1c2230", rng.randint(18, 42)), width=1)


def draw_block(draw: ImageDraw.ImageDraw, cx: float, bottom: float, width: float,
               height: float, depth: float, base: tuple[int, int, int, int],
               rng: random.Random) -> None:
  lit = mix(base, rgba("#f7efd8"), 0.32)
  shade = mix(base, rgba("#1b2130"), 0.42)
  top = bottom - height
  off = depth * 0.48
  right = [(cx + width / 2, top), (cx + width / 2 + depth, top - off),
           (cx + width / 2 + depth, bottom - off), (cx + width / 2, bottom)]
  front = [(cx - width / 2, top), (cx + width / 2, top),
           (cx + width / 2, bottom), (cx - width / 2, bottom)]
  roof = [(cx - width / 2, top), (cx + width / 2, top),
          (cx + width / 2 + depth, top - off), (cx - width / 2 + depth, top - off)]
  polygon(draw, right, shade, rgba("#1a1e27", 110), 1)
  polygon(draw, front, base, rgba("#1a1e27", 105), 1)
  polygon(draw, roof, lit, rgba("#1a1e27", 100), 1)
  for i in range(max(4, round(width / 18))):
    x = cx - width * 0.42 + i * width / max(1, round(width / 18))
    draw.line((x, top + 12, x + rng.randint(-6, 8), bottom - 8),
              fill=rgba("#fff1ce", rng.randint(18, 38)), width=1)


def draw_glow(draw: ImageDraw.ImageDraw, x: float, y: float, rx: float, ry: float,
              color: tuple[int, int, int, int]) -> None:
  for step in range(7, 0, -1):
    alpha = round(color[3] * (step / 7) ** 2 * 0.33)
    draw.ellipse((x - rx * step / 7, y - ry * step / 7,
                  x + rx * step / 7, y + ry * step / 7),
                 fill=(color[0], color[1], color[2], alpha))
  draw.ellipse((x - rx * 0.22, y - ry * 0.22, x + rx * 0.22, y + ry * 0.22),
               fill=color)


def draw_dome(draw: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float,
              base: tuple[int, int, int, int], rng: random.Random) -> None:
  draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=base, outline=rgba("#242832", 120), width=1)
  draw.arc((cx - rx + 8, cy - ry + 6, cx + rx - 12, cy + ry - 4),
           194, 338, fill=mix(base, rgba("#fff3cf"), 0.45), width=4)
  for i in range(-3, 4):
    x = cx + i * rx * 0.18
    draw.line((x, cy - ry * 0.75, x + i * 3, cy + ry * 0.52),
              fill=rgba("#28303c", rng.randint(45, 80)), width=1)


def draw_spire(draw: ImageDraw.ImageDraw, cx: float, base_y: float, height: float,
               width: float, base: tuple[int, int, int, int], glow, rng: random.Random) -> None:
  top = base_y - height
  points = [(cx - width / 2, base_y), (cx + width / 2, base_y),
            (cx + width * 0.28, top + height * 0.18), (cx, top),
            (cx - width * 0.28, top + height * 0.18)]
  polygon(draw, points, base, rgba("#151a24", 135), 1)
  draw.line((cx - width * 0.32, base_y - 8, cx, top + 12, cx + width * 0.32, base_y - 8),
            fill=mix(base, rgba("#e8f8ff"), 0.35), width=2)
  for i in range(5):
    y = base_y - 24 - i * height / 7
    draw.line((cx - width * 0.30, y, cx + width * 0.30, y - 3),
              fill=rgba("#f4eed9", rng.randint(40, 78)), width=2)
  draw_glow(draw, cx, top + height * 0.16, width * 0.16, width * 0.18, glow)


def draw_moisture_tower(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float,
                        rng: random.Random) -> None:
  dark = rgba("#202633", 210)
  metal = rgba("#aeb7b8", 215)
  draw.line((x, y, x + 5 * scale, y - 108 * scale), fill=dark, width=max(2, round(8 * scale)))
  draw.line((x, y, x + 5 * scale, y - 108 * scale), fill=metal, width=max(1, round(4 * scale)))
  for i in range(6):
    yy = y - (20 + i * 14) * scale
    draw.line((x - 30 * scale, yy, x + 35 * scale, yy - 8 * scale),
              fill=dark, width=max(1, round(4 * scale)))
    draw.line((x - 27 * scale, yy - 1, x + 32 * scale, yy - 9 * scale),
              fill=jitter(metal, 14, rng), width=max(1, round(2 * scale)))
  draw_glow(draw, x + 16 * scale, y - 72 * scale, 6 * scale, 6 * scale, rgba("#67e8ff", 170))


def draw_starwars_windows(draw: ImageDraw.ImageDraw, cx: int, top: int, count: int, rng: random.Random) -> None:
  for i in range(count):
    x = cx - (count - 1) * 17 + i * 34
    y = top + rng.randint(-4, 4)
    draw.rounded_rectangle((x - 7, y, x + 7, y + 28), radius=4,
                           fill=rgba("#183447", 175), outline=rgba("#b8e9f0", 90), width=1)
    draw_glow(draw, x, y + 8, 5, 10, rgba("#69e8ff", 96))


def generate_basic_starwars_building(slug: str, seed: int) -> Image.Image:
  rng = random.Random(seed)
  image = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw = ImageDraw.Draw(image, "RGBA")
  cx, cy = BUILDING_SIZE[0] // 2, 398
  stone = jitter(rgba("#bdb5a4", 238), 8, rng)
  metal = rgba("#87919b", 236)
  dark_metal = rgba("#4e5968", 238)
  blue = rgba("#66d9ff", 178)
  amber = rgba("#f1c76d", 165)

  draw_soft_shadow(image, cx + 44, cy + 62, 252, 72, 108)
  draw_textured_apron(draw, cx, cy + 36, 252, 94, seed, rgba("#726b61", 178))

  if slug == "town-center":
    draw_block(draw, cx - 40, cy + 16, 300, 112, 70, stone, rng)
    draw_block(draw, cx - 22, cy - 74, 245, 104, 54, rgba("#d2c5ad", 238), rng)
    draw_dome(draw, cx - 92, cy - 196, 62, 36, rgba("#d8c9ad", 235), rng)
    draw_dome(draw, cx + 84, cy - 214, 58, 32, rgba("#9eacbb", 235), rng)
    for dx, h, w, glow in [(-190, 160, 36, blue), (176, 188, 42, blue), (10, 236, 54, amber)]:
      draw_spire(draw, cx + dx, cy - 58, h, w, dark_metal, glow, rng)
    draw_starwars_windows(draw, cx - 16, cy - 126, 8, rng)
  elif slug == "house":
    draw_block(draw, cx - 24, cy + 28, 260, 86, 58, rgba("#c7b28e", 238), rng)
    for dx in [-110, -44, 34, 100]:
      draw_dome(draw, cx + dx, cy - 75 - abs(dx) * 0.05, 42, 25, rgba("#dfcca7", 238), rng)
    for dx in [-178, 170]:
      draw_moisture_tower(draw, cx + dx, cy + 56, 0.76, rng)
    draw_starwars_windows(draw, cx - 10, cy - 34, 7, rng)
  elif slug == "mill":
    draw_block(draw, cx - 12, cy + 18, 272, 88, 62, rgba("#a69f91", 238), rng)
    for dx in [-112, -48, 18, 86]:
      draw_moisture_tower(draw, cx + dx, cy + 34, 0.88, rng)
    for radius in [150, 118, 86]:
      draw.arc((cx - radius, cy - 124 - radius * 0.08, cx + radius, cy + 72),
               204, 334, fill=rgba("#75e8ff", 105), width=4)
  elif slug == "lumber-camp":
    draw_block(draw, cx - 28, cy + 34, 300, 86, 66, rgba("#91816b", 238), rng)
    for i in range(12):
      x = cx - 168 + i * 29
      y = cy - 82 + (i % 4) * 8
      draw.rounded_rectangle((x, y, x + 104, y + 12), radius=5,
                             fill=jitter(rgba("#8a6844", 230), 12, rng), outline=rgba("#38271b", 110))
    draw_spire(draw, cx + 150, cy - 18, 152, 34, metal, blue, rng)
  elif slug == "mine":
    draw_block(draw, cx - 12, cy + 38, 318, 90, 72, rgba("#797775", 240), rng)
    for i in range(9):
      x = cx - 146 + i * 38
      draw.polygon([(x, cy + 18), (x + 34, cy + 2), (x + 55, cy + 24), (x + 16, cy + 48)],
                   fill=jitter(rgba("#606a74", 235), 18, rng), outline=rgba("#171c25", 95))
      draw_glow(draw, x + 27, cy + 20, 5, 4, rgba("#8defff", 115))
    draw_spire(draw, cx - 162, cy - 22, 122, 32, metal, amber, rng)
    draw_spire(draw, cx + 166, cy - 36, 146, 36, dark_metal, blue, rng)
  elif slug == "barracks":
    draw_block(draw, cx - 18, cy + 36, 340, 104, 70, rgba("#8d949d", 240), rng)
    for i in range(10):
      x = cx - 160 + i * 35
      draw.rounded_rectangle((x, cy - 100 - (i % 2) * 9, x + 21, cy - 26 - (i % 2) * 9),
                             radius=4, fill=jitter(rgba("#5f6d79", 230), 10, rng),
                             outline=rgba("#202633", 115), width=1)
      draw_glow(draw, x + 10, cy - 75 - (i % 2) * 9, 4, 20, rgba("#76e6ff", 95))
  elif slug == "stable":
    draw_block(draw, cx - 24, cy + 24, 330, 98, 70, rgba("#90979e", 240), rng)
    for i in range(5):
      x = cx - 128 + i * 64
      draw.ellipse((x - 32, cy - 70, x + 32, cy - 14),
                   fill=jitter(rgba("#657789", 230), 10, rng), outline=rgba("#202633", 120))
      draw.line((x - 34, cy - 40, x + 34, cy - 60), fill=rgba("#d7e7e7", 128), width=4)
  elif slug == "foundry":
    draw_block(draw, cx - 12, cy + 34, 330, 102, 74, rgba("#7e8790", 240), rng)
    for dx, h in [(-135, 138), (-56, 176), (55, 158), (140, 124)]:
      draw.rounded_rectangle((cx + dx - 21, cy - h, cx + dx + 21, cy - 30), radius=10,
                             fill=jitter(metal, 9, rng), outline=rgba("#1b202a", 122), width=1)
      draw_glow(draw, cx + dx, cy - h + 20, 9, 20, rgba("#f7ba5b", 108))
    draw_starwars_windows(draw, cx - 8, cy - 44, 7, rng)
  elif slug == "tower":
    draw_block(draw, cx, cy + 46, 112, 82, 38, rgba("#737f8c", 230), rng)
    draw_spire(draw, cx, cy + 26, 276, 84, dark_metal, blue, rng)
    draw_spire(draw, cx - 88, cy + 52, 162, 44, metal, amber, rng)
    draw_spire(draw, cx + 88, cy + 42, 188, 48, metal, blue, rng)
    for radius in [128, 96, 64]:
      draw.arc((cx - radius, cy - 172 - radius * 0.25, cx + radius, cy + radius * 0.25),
               204, 335, fill=rgba("#74e8ff", 112), width=4)
  elif slug == "castle":
    draw_block(draw, cx - 26, cy + 58, 430, 138, 90, rgba("#91969e", 242), rng)
    draw_block(draw, cx - 8, cy - 54, 330, 116, 66, rgba("#c0baad", 240), rng)
    for dx, h, w, glow in [
      (-218, 192, 46, blue), (-112, 246, 58, blue), (0, 300, 72, amber),
      (120, 242, 56, blue), (222, 198, 46, blue),
    ]:
      draw_spire(draw, cx + dx, cy - 42, h, w, dark_metal, glow, rng)
    draw_starwars_windows(draw, cx - 8, cy - 116, 11, rng)
    draw.arc((cx - 268, cy - 236, cx + 268, cy + 96), 204, 336, fill=rgba("#cfd8dc", 128), width=7)

  add_surface_texture(image, seed + 991, 11, 5200)
  return image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=88, threshold=2))


def add_surface_texture(image: Image.Image, seed: int, strength: int, flecks: int) -> None:
  rng = random.Random(seed)
  pixels = image.load()
  width, height = image.size
  for _ in range(flecks):
    x = rng.randrange(width)
    y = rng.randrange(height)
    r, g, b, a = pixels[x, y]
    if a <= 0:
      continue
    if rng.random() < 0.55:
      color = (255, 245, 210, rng.randint(8, 24))
    else:
      color = (16, 22, 32, rng.randint(10, 28))
    block_w = rng.randint(1, 4)
    block_h = rng.randint(1, 3)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rectangle((x, y, x + block_w, y + block_h), fill=color)
  for y in range(0, height, 2):
    for x in range(0, width, 2):
      r, g, b, a = pixels[x, y]
      if a <= 0:
        continue
      n = rng.randint(-strength, strength)
      pixels[x, y] = (
        max(0, min(255, r + n)),
        max(0, min(255, g + n)),
        max(0, min(255, b + n)),
        a,
      )


STARWARS_SOURCE_BY_SLUG = {
  "town-center": "ottoman-town-center.webp",
  "house": "ottoman-house.webp",
  "mill": "english-foundry.webp",
  "lumber-camp": "ottoman-lumber-camp.webp",
  "mine": "ottoman-mine.webp",
  "barracks": "ottoman-barracks.webp",
  "stable": "ottoman-stable.webp",
  "foundry": "ottoman-foundry.webp",
  "tower": "ottoman-tower.webp",
  "castle": "hogwarts-castle.webp",
}

STARWARS_WIDTH_BY_SLUG = {
  "town-center": 385,
  "house": 292,
  "mill": 300,
  "lumber-camp": 314,
  "mine": 300,
  "barracks": 330,
  "stable": 342,
  "foundry": 340,
  "tower": 268,
  "castle": 430,
}


def stylized_architecture_source(filename: str, tint: tuple[int, int, int, int]) -> Image.Image:
  source = crop_alpha(Image.open(BUILDING_DIR / filename).convert("RGBA"))
  source = ImageEnhance.Color(source).enhance(0.58)
  source = ImageEnhance.Contrast(source).enhance(1.12)
  source = ImageEnhance.Brightness(source).enhance(1.03)
  layer = Image.new("RGBA", source.size, tint)
  output = Image.alpha_composite(source, layer)
  output.putalpha(source.getchannel("A"))
  return output.filter(ImageFilter.UnsharpMask(radius=0.9, percent=58, threshold=3))


def draw_tech_overlay(draw: ImageDraw.ImageDraw, slug: str, seed: int) -> None:
  rng = random.Random(seed)
  cx, cy = BUILDING_SIZE[0] // 2, 398
  blue = rgba("#66d9ff", 160)
  amber = rgba("#f1c76d", 145)
  metal = rgba("#8f9aa5", 215)
  dark = rgba("#202633", 180)

  if slug in {"house", "mill"}:
    for dx in [-178, 168] if slug == "house" else [-120, -54, 26, 96]:
      draw_moisture_tower(draw, cx + dx, cy + 56, 0.72 if slug == "house" else 0.64, rng)
  if slug in {"town-center", "castle", "tower"}:
    spires = {
      "town-center": [(-188, 156, 34, blue), (176, 184, 40, blue), (4, 222, 50, amber)],
      "castle": [(-222, 176, 40, blue), (-110, 220, 50, blue), (0, 280, 66, amber),
                 (118, 222, 50, blue), (222, 178, 40, blue)],
      "tower": [(-82, 128, 34, amber), (0, 228, 62, blue), (84, 142, 36, blue)],
    }[slug]
    for dx, h, w, glow in spires:
      draw_spire(draw, cx + dx, cy - 18, h, w, metal, glow, rng)
  if slug in {"house", "town-center"}:
    for dx in [-96, -28, 42, 112]:
      draw_dome(draw, cx + dx, cy - 92 - abs(dx) * 0.05, 34, 21, rgba("#d7c29b", 192), rng)
  if slug in {"barracks", "stable", "foundry"}:
    for i in range(9 if slug == "barracks" else 6):
      x = cx - 148 + i * (36 if slug == "barracks" else 55)
      y = cy - 112 + (i % 2) * 6
      draw.rounded_rectangle((x, y, x + 22, y + 58), radius=5,
                             fill=rgba("#1d3446", 138), outline=rgba("#b8e9f0", 88))
      draw_glow(draw, x + 11, y + 15, 5, 17, blue)
  if slug in {"lumber-camp", "mine"}:
    for i in range(8):
      x = cx - 152 + i * 42
      y = cy + 4 + (i % 3) * 10
      color = rgba("#855f3f", 190) if slug == "lumber-camp" else rgba("#697481", 190)
      draw.rounded_rectangle((x, y, x + 70, y + 11), radius=5,
                             fill=jitter(color, 10, rng), outline=rgba("#1b202a", 90))
    draw_spire(draw, cx + 160, cy - 18, 132, 32, metal, blue if slug == "mine" else amber, rng)
  if slug == "foundry":
    for dx, h in [(-126, 126), (-44, 164), (58, 146), (132, 112)]:
      draw.rounded_rectangle((cx + dx - 17, cy - h, cx + dx + 17, cy - 30),
                             radius=8, fill=rgba("#727d88", 206), outline=dark)
      draw_glow(draw, cx + dx, cy - h + 20, 8, 18, amber)
  for i in range(12):
    x = cx - 170 + i * 31
    y = cy - 64 + (i % 3) * 18
    draw_glow(draw, x, y, 5, 4, blue if i % 4 else amber)
  for i in range(18):
    x0 = cx - 190 + rng.randint(0, 380)
    y0 = cy - 120 + rng.randint(0, 150)
    draw.line((x0, y0, x0 + rng.randint(18, 58), y0 + rng.randint(-10, 10)),
              fill=rgba("#e8f6ff", rng.randint(42, 76)), width=1)


def generate_starwars_building(slug: str, seed: int) -> Image.Image:
  rng = random.Random(seed)
  image = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
  draw = ImageDraw.Draw(image, "RGBA")
  cx, cy = BUILDING_SIZE[0] // 2, 398
  draw_soft_shadow(image, cx + 42, cy + 62, 250, 72, 112)
  draw_textured_apron(draw, cx, cy + 38, 250, 92, seed, rgba("#756d61", 172))

  tint = rgba("#bca57f", 38) if slug in {"house", "mill", "lumber-camp"} else rgba("#6f8ead", 44)
  if slug in {"castle", "tower", "town-center"}:
    tint = rgba("#8296b2", 34)
  source = stylized_architecture_source(STARWARS_SOURCE_BY_SLUG[slug], tint)
  width = STARWARS_WIDTH_BY_SLUG[slug]
  bottom = {
    "town-center": 416,
    "house": 414,
    "mill": 415,
    "lumber-camp": 419,
    "mine": 420,
    "barracks": 418,
    "stable": 419,
    "foundry": 419,
    "tower": 420,
    "castle": 430,
  }[slug]
  paste_bottom(image, source, cx, bottom, width)
  draw_tech_overlay(ImageDraw.Draw(image, "RGBA"), slug, seed + 229)

  add_surface_texture(image, seed + 991, 4, 1800)
  return image.filter(ImageFilter.UnsharpMask(radius=1.0, percent=86, threshold=2))


def generate_starwars_buildings() -> None:
  BUILDING_DIR.mkdir(parents=True, exist_ok=True)
  slugs = [
    "town-center", "house", "mill", "lumber-camp", "mine",
    "barracks", "stable", "foundry", "tower", "castle",
  ]
  for index, slug in enumerate(slugs):
    image = generate_starwars_building(slug, 1700 + index * 137)
    image.save(BUILDING_DIR / f"starwars-{slug}.webp", "WEBP", lossless=True, method=6, exact=True)


def main() -> None:
  generate_english_housing()
  generate_starwars_buildings()


if __name__ == "__main__":
  main()
