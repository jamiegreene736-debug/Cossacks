#!/usr/bin/env python3
"""Prepare generated military sheets for the production-art registry.

The source renders use a softly graded warm studio backdrop.  This processor
removes only backdrop-coloured pixels that are connected to the outside edge,
so pale uniform details and muzzle flashes enclosed by painted outlines remain
intact.  The original equal-cell geometry is deliberately preserved because
the renderer addresses each animation pose by source rectangle.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def is_exterior_backdrop(pixel: tuple[int, int, int]) -> bool:
    """Return whether an RGB pixel belongs to the warm generated backdrop."""

    red, green, blue = pixel
    return (
        min(pixel) >= 205
        and red >= green - 2
        and green >= blue - 2
        and max(pixel) - min(pixel) <= 34
    )


def is_exact_backdrop(pixel: tuple[int, int, int]) -> bool:
    """Match the studio matte closely enough to remove enclosed pale islands."""

    red, green, blue = pixel
    return (
        228 <= red <= 245
        and 220 <= green <= 240
        and 208 <= blue <= 232
        and 3 <= red - green <= 11
        and 7 <= green - blue <= 14
    )


def remove_exterior_backdrop(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    pixels = image.load()
    exterior = Image.new("L", image.size, 0)
    mask = exterior.load()
    pending: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if mask[x, y] or not is_exterior_backdrop(pixels[x, y]):
            return
        mask[x, y] = 255
        pending.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while pending:
        x, y = pending.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    # Contact shadows and crossed legs can enclose small regions of matte that
    # are no longer edge-connected.  Their channel spacing is extremely
    # consistent, unlike the warmer pipeclay, linen, turban and smoke colours,
    # so remove only this tighter backdrop signature everywhere in the sheet.
    for y in range(height):
        for x in range(width):
            if is_exact_backdrop(pixels[x, y]):
                mask[x, y] = 255

    # A sub-pixel feather prevents the studio matte from surviving as a pale
    # fringe after the browser downsamples a 384- or 768-pixel source cell.
    exterior = exterior.filter(ImageFilter.GaussianBlur(0.7))
    alpha = exterior.point(lambda value: 255 - value)
    output = image.convert("RGBA")
    output.putalpha(alpha)
    cool_contact_shadows(output, 512)
    return output


def cool_contact_shadows(image: Image.Image, cell_height: int) -> None:
    """Turn pale studio-floor residue into a cool translucent ground shadow."""

    pixels = image.load()
    for y in range(image.height):
        if y % cell_height < cell_height * 0.79:
            continue
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            if (
                alpha <= 96
                and min(red, green, blue) > 210
                and max(red, green, blue) - min(red, green, blue) <= 28
            ):
                pixels[x, y] = (35, 42, 58, alpha)
                continue
            if not (
                140 <= min(red, green, blue) <= 210
                and max(red, green, blue) - min(red, green, blue) <= 26
                and red >= green - 4
                and green >= blue - 4
            ):
                continue

            luminance = (red + green + blue) / 3
            shadow_alpha = round(max(0.08, min(0.48, (234 - luminance) / 190)) * 255)
            pixels[x, y] = (35, 42, 58, min(alpha, shadow_alpha))


def write_sheet(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = remove_exterior_backdrop(source)
    image.save(destination, "WEBP", lossless=True, method=6, exact=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--musketeers", type=Path, required=True)
    parser.add_argument("--partisans", type=Path, required=True)
    parser.add_argument("--cavalry", type=Path, required=True)
    parser.add_argument("--artillery", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    write_sheet(args.musketeers, args.output_dir / "musketeers.webp")
    write_sheet(args.partisans, args.output_dir / "partisans.webp")
    write_sheet(args.cavalry, args.output_dir / "cavalry.webp")
    write_sheet(args.artillery, args.output_dir / "artillery.webp")


if __name__ == "__main__":
    main()
