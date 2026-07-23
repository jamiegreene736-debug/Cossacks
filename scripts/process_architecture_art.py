#!/usr/bin/env python3
"""Prepare generated architecture art for the production-art registry.

The generator returns a pale checkerboard as RGB pixels.  This processor
removes only neutral, bright pixels connected to a sheet edge, preserving the
warm limestone highlights inside each sprite while opening scaffold and gate
negative space.  Equal cell geometry is intentionally retained because the
renderer addresses the 2x2 sheets by source rectangle.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


BUILDING_SLUGS = frozenset(
    {
        "town-center",
        "house",
        "mill",
        "lumber-camp",
        "mine",
        "marketplace",
        "barracks",
        "stable",
        "foundry",
        "tower",
    }
)


def is_exterior_checker(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return min(pixel) >= 222 and max(pixel) - min(pixel) <= 7


def remove_exterior_checkerboard(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    pixels = image.load()
    exterior = Image.new("L", image.size, 0)
    mask = exterior.load()
    pending: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if mask[x, y] or not is_exterior_checker(pixels[x, y]):
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

    # Feather one pixel at the cut so down-sampling does not reveal a white
    # fringe around ropes, merlons, or window mouldings.
    exterior = exterior.filter(ImageFilter.GaussianBlur(0.65))
    alpha = exterior.point(lambda value: 255 - value)
    output = image.convert("RGBA")
    output.putalpha(alpha)
    return output


def write_art(source: Path, destination: Path, *, lossless: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = remove_exterior_checkerboard(source)
    if lossless:
        image.save(destination, "WEBP", lossless=True, method=6, exact=True)
    else:
        # Individual structures are displayed far below their authored source
        # dimensions. A very-high-quality encode keeps carved stone and timber
        # joints intact while avoiding multi-megabyte preload costs per sprite.
        image.save(
            destination,
            "WEBP",
            lossless=False,
            quality=94,
            alpha_quality=100,
            method=6,
            exact=True,
        )


def parse_building_art(value: str) -> tuple[str, Path]:
    slug, separator, source = value.partition("=")
    if not separator or slug not in BUILDING_SLUGS or not source:
        valid = ", ".join(sorted(BUILDING_SLUGS))
        raise argparse.ArgumentTypeError(
            f"expected BUILDING=PATH where BUILDING is one of: {valid}"
        )
    return slug, Path(source)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nation", choices=("england", "ottoman"), required=True)
    parser.add_argument("--fortifications", type=Path, required=True)
    parser.add_argument("--construction", type=Path, required=True)
    parser.add_argument("--fortification-construction", type=Path, required=True)
    parser.add_argument("--gate-closed", type=Path)
    parser.add_argument(
        "--building-art",
        action="append",
        default=[],
        type=parse_building_art,
        metavar="BUILDING=PATH",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prefix = args.nation
    write_art(
        args.fortifications,
        args.output_dir / f"{prefix}-fortifications.webp",
        lossless=True,
    )
    write_art(
        args.construction,
        args.output_dir / f"{prefix}-construction.webp",
        lossless=True,
    )
    write_art(
        args.fortification_construction,
        args.output_dir / f"{prefix}-fortification-construction.webp",
        lossless=True,
    )
    if args.gate_closed:
        write_art(
            args.gate_closed,
            args.output_dir / f"{prefix}-gate-closed.webp",
            lossless=True,
        )
    for slug, source in args.building_art:
        write_art(source, args.output_dir / f"{prefix}-{slug}.webp", lossless=False)


if __name__ == "__main__":
    main()
