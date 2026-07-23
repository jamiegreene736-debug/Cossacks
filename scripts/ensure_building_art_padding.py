#!/usr/bin/env python3
"""Ensure completed building production art has transparent edge padding.

Renderer sprites are cached and scaled as complete images. If a source asset has
painted pixels touching the image edge, the game can show a dead-straight cut
through the building when that edge lands in the visible scene. This processor
keeps the original asset dimensions but fits visible pixels inward, preserving
the renderer's aspect-ratio contract while adding a small transparent margin.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
DEFAULT_MARGIN = 14


def edge_margin(bounds: tuple[int, int, int, int], size: tuple[int, int]) -> int:
  left, top, right, bottom = bounds
  width, height = size
  return min(left, top, width - right, height - bottom)


def ensure_padding(path: Path, margin: int) -> bool:
  image = Image.open(path).convert("RGBA")
  bounds = image.getbbox()
  if not bounds:
    return False
  if edge_margin(bounds, image.size) >= margin:
    return False

  cropped = image.crop(bounds)
  available_width = max(1, image.width - margin * 2)
  available_height = max(1, image.height - margin * 2)
  scale = min(
    available_width / cropped.width,
    available_height / cropped.height,
    1,
  )
  fitted = cropped.resize(
    (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
    RESAMPLE,
  )
  output = Image.new("RGBA", image.size, (0, 0, 0, 0))
  left = round((image.width - fitted.width) / 2)
  top = image.height - margin - fitted.height
  if top < margin:
    top = round((image.height - fitted.height) / 2)
  output.alpha_composite(fitted, (left, top))
  save_image(output, path)
  return True


def save_image(image: Image.Image, path: Path) -> None:
  if path.suffix.lower() == ".webp":
    image.save(path, "WEBP", lossless=True, method=6, exact=True)
    return
  image.save(path, path.suffix.lstrip(".").upper())


def padding_failure(path: Path, margin: int) -> str | None:
  image = Image.open(path).convert("RGBA")
  bounds = image.getbbox()
  if not bounds:
    return None
  actual = edge_margin(bounds, image.size)
  if actual >= margin:
    return None
  return f"{path}: visible pixels are {actual}px from an edge; expected at least {margin}px"


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser()
  parser.add_argument("paths", nargs="+", type=Path)
  parser.add_argument("--check", action="store_true")
  parser.add_argument("--margin", type=int, default=DEFAULT_MARGIN)
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  if args.check:
    failures = [
      failure
      for path in args.paths
      if (failure := padding_failure(path, args.margin))
    ]
    if failures:
      for failure in failures:
        print(failure)
      raise SystemExit(1)
    return

  for path in args.paths:
    if ensure_padding(path, args.margin):
      print(path)


if __name__ == "__main__":
  main()
