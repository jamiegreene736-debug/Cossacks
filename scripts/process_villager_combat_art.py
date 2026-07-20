#!/usr/bin/env python3
"""Turn the generated civilian-musket study into a transparent 4x2 sheet."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


COLUMNS = 4
ROWS = 2
CELL_WIDTH = 384
CELL_HEIGHT = 512
MAX_FIGURE_WIDTH = 354
MAX_FIGURE_HEIGHT = 452
BASELINE = 480


def is_dark_slate(pixel: tuple[int, int, int], strict: bool = False) -> bool:
    """Identify the cool neutral studio matte without matching brown clothing."""

    red, green, blue = pixel
    limit = 68 if strict else 96
    spread = max(pixel) - min(pixel)
    return (
        max(pixel) <= limit
        and spread <= (16 if strict else 25)
        and green >= red - 1
        and blue >= green - 2
        and blue >= red + (3 if strict else 1)
    )


def remove_backdrop(cell: Image.Image) -> Image.Image:
    rgb = cell.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    exterior = Image.new("L", rgb.size, 0)
    mask = exterior.load()
    pending: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if mask[x, y] or not is_dark_slate(pixels[x, y]):
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

    # Small matte islands between limbs and weapon furniture are not always
    # edge-connected. The stricter signature removes only those cool pixels.
    for y in range(height):
        for x in range(width):
            if is_dark_slate(pixels[x, y], strict=True):
                mask[x, y] = 255

    exterior = exterior.filter(ImageFilter.GaussianBlur(0.85))
    alpha = exterior.point(lambda value: 255 - value)
    output = rgb.convert("RGBA")
    output.putalpha(alpha)
    return output


def split_frames(source: Image.Image) -> list[Image.Image]:
    frames = []
    for row in range(ROWS):
        top = round(row * source.height / ROWS)
        bottom = round((row + 1) * source.height / ROWS)
        for column in range(COLUMNS):
            left = round(column * source.width / COLUMNS)
            right = round((column + 1) * source.width / COLUMNS)
            frames.append(remove_backdrop(source.crop((left, top, right, bottom))))
    return frames


def compose_sheet(frames: list[Image.Image]) -> Image.Image:
    boxes = []
    for frame in frames:
        alpha = frame.getchannel("A")
        box = alpha.point(lambda value: 255 if value > 18 else 0).getbbox()
        if not box:
            raise ValueError("A villager combat frame lost its subject during backdrop removal.")
        boxes.append(box)

    max_width = max(right - left for left, _top, right, _bottom in boxes)
    max_height = max(bottom - top for _left, top, _right, bottom in boxes)
    scale = min(MAX_FIGURE_WIDTH / max_width, MAX_FIGURE_HEIGHT / max_height)

    sheet = Image.new("RGBA", (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS), (0, 0, 0, 0))
    for index, (frame, box) in enumerate(zip(frames, boxes, strict=True)):
        figure = frame.crop(box)
        width = max(1, round(figure.width * scale))
        height = max(1, round(figure.height * scale))
        figure = figure.resize((width, height), Image.Resampling.LANCZOS)
        column = index % COLUMNS
        row = index // COLUMNS
        x = column * CELL_WIDTH + (CELL_WIDTH - width) // 2
        y = row * CELL_HEIGHT + BASELINE - height
        sheet.alpha_composite(figure, (x, y))
    return sheet


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Image.open(args.source).convert("RGB")
    sheet = compose_sheet(split_frames(source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, "WEBP", lossless=True, method=6, exact=True)


if __name__ == "__main__":
    main()
