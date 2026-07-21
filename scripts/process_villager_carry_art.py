#!/usr/bin/env python3
"""Prepare generated carrying-villager studies as transparent production sheets.

Each source is a four-column, two-row study: firewood on the first row and a
general resource sack on the second.  The processor removes the cool studio
matte one cell at a time, normalizes every pose to one gameplay scale, and
preserves the equal-cell geometry consumed by the renderer.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


COLUMNS = 4
ROWS = 2
SOURCE_CELL_WIDTH = 384
SOURCE_CELL_HEIGHT = 512
OUTPUT_CELL_WIDTH = 384
OUTPUT_CELL_HEIGHT = 448
MAX_FIGURE_WIDTH = 356
MAX_FIGURE_HEIGHT = 408
BASELINE = 430


def is_studio_matte(pixel: tuple[int, int, int]) -> bool:
    """Identify the generated cool slate without matching brown clothing."""

    red, green, blue = pixel
    return (
        max(pixel) <= 105
        and blue >= green + 2
        and green >= red - 1
        and blue >= red + 5
        and max(pixel) - min(pixel) <= 46
    )


def remove_studio_matte(cell: Image.Image) -> Image.Image:
    rgb = cell.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    exterior = Image.new("L", rgb.size, 0)
    mask = exterior.load()
    pending: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if mask[x, y] or not is_studio_matte(pixels[x, y]):
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
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    exterior = exterior.filter(ImageFilter.GaussianBlur(0.8))
    output = rgb.convert("RGBA")
    output.putalpha(exterior.point(lambda value: 255 - value))
    return output


def split_frames(source_path: Path) -> list[Image.Image]:
    source = Image.open(source_path).convert("RGB")
    expected_size = (SOURCE_CELL_WIDTH * COLUMNS, SOURCE_CELL_HEIGHT * ROWS)
    if source.size != expected_size:
        raise ValueError(f"{source_path} must be {expected_size[0]}x{expected_size[1]}")

    frames = []
    for row in range(ROWS):
        for column in range(COLUMNS):
            left = column * SOURCE_CELL_WIDTH
            top = row * SOURCE_CELL_HEIGHT
            frames.append(remove_studio_matte(source.crop((
                left,
                top,
                left + SOURCE_CELL_WIDTH,
                top + SOURCE_CELL_HEIGHT,
            ))))
    return frames


def compose_sheet(frames: list[Image.Image]) -> Image.Image:
    boxes = []
    for frame in frames:
        box = frame.getchannel("A").point(lambda value: 255 if value > 18 else 0).getbbox()
        if not box:
            raise ValueError("A carrying-villager frame lost its subject during matte removal.")
        boxes.append(box)

    max_width = max(right - left for left, _top, right, _bottom in boxes)
    max_height = max(bottom - top for _left, top, _right, bottom in boxes)
    scale = min(MAX_FIGURE_WIDTH / max_width, MAX_FIGURE_HEIGHT / max_height)

    sheet = Image.new(
        "RGBA",
        (OUTPUT_CELL_WIDTH * COLUMNS, OUTPUT_CELL_HEIGHT * ROWS),
        (0, 0, 0, 0),
    )
    for index, (frame, box) in enumerate(zip(frames, boxes, strict=True)):
        figure = frame.crop(box)
        width = max(1, round(figure.width * scale))
        height = max(1, round(figure.height * scale))
        figure = figure.resize((width, height), Image.Resampling.LANCZOS)
        column = index % COLUMNS
        row = index // COLUMNS
        x = column * OUTPUT_CELL_WIDTH + (OUTPUT_CELL_WIDTH - width) // 2
        y = row * OUTPUT_CELL_HEIGHT + BASELINE - height
        sheet.alpha_composite(figure, (x, y))
    return sheet


def write_sheet(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    compose_sheet(split_frames(source)).save(
        destination,
        "WEBP",
        lossless=True,
        method=6,
        exact=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--ottoman", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    write_sheet(args.english, args.output_dir / "english-villager-carry.webp")
    write_sheet(args.ottoman, args.output_dir / "ottoman-villager-carry.webp")


if __name__ == "__main__":
    main()
