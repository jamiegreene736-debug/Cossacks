#!/usr/bin/env python3
"""Turn generated four-panel source art into runtime landscape assets."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


FRAME_SIZE = 512


def keep_primary_component(image: Image.Image) -> Image.Image:
    """Remove detached chroma-shadow islands without erasing fine leaf edges."""
    alpha = image.getchannel("A")
    small_size = (max(1, image.width // 4), max(1, image.height // 4))
    connected = alpha.resize(small_size, Image.Resampling.NEAREST).point(
        lambda value: 255 if value > 18 else 0
    ).filter(ImageFilter.MaxFilter(5))
    mask = np.asarray(connected) > 0
    seen = np.zeros(mask.shape, dtype=bool)
    largest: list[tuple[int, int]] = []
    height, width = mask.shape
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            component: list[tuple[int, int]] = []
            queue = deque([(x, y)])
            seen[y, x] = True
            while queue:
                cx, cy = queue.popleft()
                component.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((nx, ny))
            if len(component) > len(largest):
                largest = component
    selected = Image.new("L", small_size)
    selected_pixels = selected.load()
    for x, y in largest:
        selected_pixels[x, y] = 255
    selected = selected.resize(image.size, Image.Resampling.NEAREST).filter(ImageFilter.MaxFilter(9))
    image.putalpha(Image.fromarray(np.minimum(np.asarray(alpha), np.asarray(selected)).astype(np.uint8)))
    return image


def split_panels(source: Image.Image) -> list[Image.Image]:
    panel_width = source.width / 4
    panels: list[Image.Image] = []
    for index in range(4):
        left = round(index * panel_width) + 3
        right = round((index + 1) * panel_width) - 3
        panels.append(source.crop((left, 0, right, source.height)))
    return panels


def remove_magenta(panel: Image.Image, preserve_shadows: bool) -> Image.Image:
    rgb = np.asarray(panel.convert("RGB"), dtype=np.float32)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    chroma_distance = np.sqrt((255 - red) ** 2 + green**2 + (255 - blue) ** 2)
    alpha = np.clip((chroma_distance - 13) / 58, 0, 1)

    # Generated cast shadows are magenta-darkened rather than clean foreground.
    # Preserve their shape while neutralizing the spill into a cool natural grey.
    magenta_like = (
        (red > green * 1.28)
        & (blue > green * 1.08)
        & ((red - blue) > -42)
        & ((red - blue) < 112)
    )
    shadow = magenta_like & (np.maximum(red, blue) < 244)
    shadow_alpha = np.clip((255 - np.maximum(red, blue)) / 172, 0, 0.72)
    if preserve_shadows:
        alpha = np.where(shadow, np.maximum(alpha * 0.22, shadow_alpha), alpha)
        rgb[shadow] = np.array([37, 40, 43], dtype=np.float32)
    else:
        alpha = np.where(magenta_like, 0, alpha)

    edge = (alpha > 0) & (alpha < 0.94) & ~shadow
    rgb[..., 0] = np.where(edge, np.minimum(red, green * 1.16 + 42), rgb[..., 0])
    rgb[..., 2] = np.where(edge, np.minimum(blue, green * 1.12 + 34), rgb[..., 2])

    rgba = np.dstack((np.clip(rgb, 0, 255), np.round(alpha * 255))).astype(np.uint8)
    result = Image.fromarray(rgba, "RGBA")
    return result if preserve_shadows else keep_primary_component(result)


def normalized_frame(
    panel: Image.Image, max_width: int, max_height: int, preserve_shadows: bool
) -> Image.Image:
    keyed = remove_magenta(panel, preserve_shadows)
    bounds = keyed.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("Generated panel contains no foreground art")
    art = keyed.crop(bounds)
    scale = min(max_width / art.width, max_height / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    art = art.resize(size, Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE))
    frame.alpha_composite(art, ((FRAME_SIZE - art.width) // 2, FRAME_SIZE - art.height - 6))
    return frame


def build_sprite_sheet(source_path: Path, output_path: Path, kind: str) -> None:
    source = Image.open(source_path)
    limits = (492, 492) if kind == "trees" else (480, 450)
    frames = [normalized_frame(panel, *limits, preserve_shadows=False) for panel in split_panels(source)]
    sheet = Image.new("RGBA", (FRAME_SIZE * 4, FRAME_SIZE))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, "WEBP", quality=92, alpha_quality=100, method=4)


def mirrored_tile(panel: Image.Image, size: int = 1024) -> Image.Image:
    half = size // 2
    source = ImageOps.fit(panel.convert("RGB"), (half, half), method=Image.Resampling.LANCZOS)
    tile = Image.new("RGB", (size, size))
    tile.paste(source, (0, 0))
    tile.paste(ImageOps.mirror(source), (half, 0))
    tile.paste(ImageOps.flip(source), (0, half))
    tile.paste(ImageOps.flip(ImageOps.mirror(source)), (half, half))
    return tile


def build_materials(source_path: Path, output_directory: Path) -> None:
    names = ("country-road", "country-water", "country-soil", "country-stubble")
    source = Image.open(source_path)
    output_directory.mkdir(parents=True, exist_ok=True)
    for name, panel in zip(names, split_panels(source), strict=True):
        mirrored_tile(panel).save(output_directory / f"{name}.jpg", "JPEG", quality=88, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trees", required=True, type=Path)
    parser.add_argument("--accents", required=True, type=Path)
    parser.add_argument("--materials", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build_sprite_sheet(args.trees, args.output / "country-trees.webp", "trees")
    build_sprite_sheet(args.accents, args.output / "landscape-accents.webp", "accents")
    build_materials(args.materials, args.output)


if __name__ == "__main__":
    main()
