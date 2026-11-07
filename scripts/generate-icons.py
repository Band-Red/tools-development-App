#!/usr/bin/env python3
"""Generates the application icons (PNG, ICO, ICNS) for every platform."""

import os
import struct
import zlib
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "icons")
os.makedirs(OUT, exist_ok=True)

SIZE = 1024
BG_TOP = (86, 140, 255)
BG_BOTTOM = (150, 96, 245)
FG = (255, 255, 255)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def find_font() -> str:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("No suitable font found - install fonts-dejavu-core")


def make_base() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Rounded square with a vertical gradient.
    gradient = Image.new("RGB", (1, SIZE))
    pixels = gradient.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        pixels[0, y] = (
            int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        )
    gradient = gradient.resize((SIZE, SIZE))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=220, fill=255)

    image.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(image)

    # A simple "plug" mark: two prongs + a body, hinting at connected tools.
    draw.rounded_rectangle([250, 210, 774, 300], radius=45, fill=FG)
    draw.rounded_rectangle([356, 300, 668, 560], radius=60, fill=FG)
    draw.rounded_rectangle([356, 560, 668, 814], radius=60, fill=(255, 255, 255, 235))
    draw.ellipse([436, 660, 588, 812], outline=BG_TOP, width=26)

    font = ImageFont.truetype(find_font(), 150)
    text = "TD"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    draw.text(
        ((SIZE - text_width) / 2 - box[0], SIZE - 175),
        text,
        font=font,
        fill=(255, 255, 255, 0),
    )

    return image


def write_png(image: Image.Image, path: str) -> None:
    image.save(path, "PNG")
    print(f"  {os.path.relpath(path, ROOT)}")


def write_ico(image: Image.Image, path: str) -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [image.resize((size, size), Image.LANCZOS) for size in sizes]
    payloads = []
    for img in images:
        buffer = os.path.join(OUT, f".tmp_{img.width}.png")
        img.save(buffer, "PNG")
        with open(buffer, "rb") as handle:
            payloads.append(handle.read())
        os.remove(buffer)

    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for img, payload in zip(images, payloads):
        entries += struct.pack(
            "<BBBBHHII",
            img.width if img.width < 256 else 0,
            img.height if img.height < 256 else 0,
            0,
            0,
            1,
            32,
            len(payload),
            offset,
        )
        offset += len(payload)

    with open(path, "wb") as handle:
        handle.write(header + entries + b"".join(payloads))
    print(f"  {os.path.relpath(path, ROOT)}")


def write_icns(image: Image.Image, path: str) -> None:
    entries = [
        (b"ic11", 32),
        (b"ic12", 64),
        (b"ic07", 128),
        (b"ic13", 256),
        (b"ic08", 256),
        (b"ic14", 512),
        (b"ic09", 512),
        (b"ic10", 1024),
    ]
    chunks = []
    for kind, size in entries:
        buffer = os.path.join(OUT, f".tmp_icns_{size}_{kind.decode()}.png")
        image.resize((size, size), Image.LANCZOS).save(buffer, "PNG")
        with open(buffer, "rb") as handle:
            data = handle.read()
        os.remove(buffer)
        chunks.append(kind + struct.pack(">I", len(data) + 8) + data)

    payload = b"".join(chunks)
    with open(path, "wb") as handle:
        handle.write(b"icns" + struct.pack(">I", len(payload) + 8) + payload)
    print(f"  {os.path.relpath(path, ROOT)}")


def main() -> None:
    base = make_base()
    print("Generating icons:")
    write_png(base, os.path.join(OUT, "icon.png"))
    for size in (16, 32, 48, 64, 128, 256, 512, 1024):
        write_png(base.resize((size, size), Image.LANCZOS), os.path.join(OUT, f"{size}x{size}.png"))
    write_ico(base, os.path.join(OUT, "icon.ico"))
    write_icns(base, os.path.join(OUT, "icon.icns"))


if __name__ == "__main__":
    main()
