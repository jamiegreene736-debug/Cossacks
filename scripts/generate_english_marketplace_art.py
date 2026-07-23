#!/usr/bin/env python3
"""Prepare a high-detail English Marketplace source render for the game.

The Marketplace is intentionally sourced from a detailed rendered 1700s English
market-house study rather than drawn procedurally. This script removes the
generated checkerboard backdrop, crops the exterior transparency, fits the
building onto the runtime 768x640 transparent canvas, and writes the production
WebP consumed by js/gfx/art-assets.js.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from process_architecture_art import remove_exterior_checkerboard  # noqa: E402


OUT = ROOT / "assets" / "buildings" / "english-marketplace.webp"
CANVAS_SIZE = (768, 640)
MAX_CONTENT_SIZE = (720, 590)


def prepare_marketplace(source: Path) -> Image.Image:
  image = remove_exterior_checkerboard(source)
  image = remove_light_matte(image)
  bounds = image.getbbox()
  if not bounds:
    raise ValueError(f"{source} did not contain visible marketplace pixels")
  cropped = image.crop(bounds)
  scale = min(
    MAX_CONTENT_SIZE[0] / cropped.width,
    MAX_CONTENT_SIZE[1] / cropped.height,
    1,
  )
  fitted = cropped.resize(
    (round(cropped.width * scale), round(cropped.height * scale)),
    Image.Resampling.LANCZOS,
  )
  canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
  left = (CANVAS_SIZE[0] - fitted.width) // 2
  bottom_padding = 18
  top = CANVAS_SIZE[1] - fitted.height - bottom_padding
  canvas.alpha_composite(fitted, (left, top))
  mute_canvas_highlights(canvas)
  return canvas


def remove_light_matte(image: Image.Image) -> Image.Image:
  output = image.convert("RGBA")
  pixels = output.load()
  for y in range(output.height):
    for x in range(output.width):
      red, green, blue, alpha = pixels[x, y]
      neutral = max(red, green, blue) - min(red, green, blue)
      bright = (red + green + blue) / 3
      if alpha < 238 and bright > 202 and neutral < 26:
        pixels[x, y] = (red, green, blue, 0)
        continue
      if alpha < 252:
        # Checkerboard removal can leave pale RGB values under semi-transparent
        # edge pixels. Nudge those pixels toward a dark warm matte so the asset
        # does not glow when drawn over grass or a dark screenshot viewer.
        blend = (252 - alpha) / 252
        pixels[x, y] = (
          round(red * (1 - blend) + 28 * blend),
          round(green * (1 - blend) + 23 * blend),
          round(blue * (1 - blend) + 18 * blend),
          alpha,
        )
  return output


def mute_canvas_highlights(image: Image.Image) -> None:
  pixels = image.load()
  for y in range(int(image.height * 0.46), image.height):
    for x in range(image.width):
      red, green, blue, alpha = pixels[x, y]
      if alpha < 160:
        continue
      neutral = max(red, green, blue) - min(red, green, blue)
      if red <= 205 or green <= 198 or blue <= 180 or neutral >= 65:
        continue
      luminance = (red * 0.30 + green * 0.59 + blue * 0.11) / 255
      shade = 0.70 + min(0.22, max(0, luminance - 0.70))
      pixels[x, y] = (
        round(142 * shade),
        round(116 * shade),
        round(76 * shade),
        alpha,
      )


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser()
  parser.add_argument("source", type=Path, help="High-detail generated marketplace PNG")
  parser.add_argument("--output", type=Path, default=OUT)
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  image = prepare_marketplace(args.source)
  args.output.parent.mkdir(parents=True, exist_ok=True)
  image.save(
    args.output,
    "WEBP",
    lossless=False,
    quality=96,
    alpha_quality=100,
    method=6,
    exact=True,
  )
  print(args.output)


if __name__ == "__main__":
  main()
