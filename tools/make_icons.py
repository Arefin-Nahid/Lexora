#!/usr/bin/env python3
"""Draws the Lexora icons (192, 512, maskable 512, apple-touch 180) with Pillow. Run: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MINT = (22, 118, 93, 255)
LIGHT = (213, 233, 222, 255)
WHITE = (250, 252, 250, 255)
SS = 4  # supersampling


def gradient(s):
    top, bot = (34, 142, 112), (12, 84, 66)
    g = Image.new("RGBA", (s, s))
    px = g.load()
    for y in range(s):
        for x in range(s):
            t = min(1.0, max(0.0, (x * 0.35 + y * 0.65) / s))
            px[x, y] = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    return g


def draw(size, rounded, content):
    """Minimal monogram: a white L (the stem is the word, the foot is the path to it) and two short bars
    beside the stem, one solid and one soft, standing for a synonym and an antonym."""
    s = size * SS
    img = gradient(s)
    if rounded:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.225), fill=255)
        img.putalpha(mask)
    d = ImageDraw.Draw(img)
    c = s * content
    x0 = (s - c) / 2
    y0 = (s - c) / 2
    w = c * 0.15
    r = w / 2
    sx = x0 + c * 0.14
    top, bot = y0 + c * 0.02, y0 + c * 0.98
    d.rounded_rectangle([sx, top, sx + w, bot], radius=r, fill=WHITE)
    d.rounded_rectangle([sx, bot - w, x0 + c * 0.9, bot], radius=r, fill=WHITE)
    bx = sx + w + c * 0.14
    d.rounded_rectangle([bx, y0 + c * 0.24, bx + c * 0.46, y0 + c * 0.24 + w * 0.8], radius=w * 0.4, fill=WHITE)
    d.rounded_rectangle([bx, y0 + c * 0.47, bx + c * 0.3, y0 + c * 0.47 + w * 0.8], radius=w * 0.4, fill=(190, 226, 212, 255))
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    draw(192, True, 0.62).save(out / "icon-192.png")
    draw(512, True, 0.62).save(out / "icon-512.png")
    draw(512, False, 0.46).save(out / "maskable-512.png")       # safe zone: content inside the middle 80%
    draw(180, False, 0.6).convert("RGB").save(out / "apple-touch-icon.png")
    print("icons written to", out)


if __name__ == "__main__":
    main()
