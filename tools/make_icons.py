#!/usr/bin/env python3
"""Draws the Lexora icons (192, 512, maskable 512, apple-touch 180) with Pillow. Run: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MINT = (22, 118, 93, 255)
LIGHT = (213, 233, 222, 255)
WHITE = (250, 252, 250, 255)
SS = 4  # supersampling


def draw(size, rounded, content):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=MINT)
    else:
        d.rectangle([0, 0, s, s], fill=MINT)
    # an "L" made of two rounded bars, with a small leaf-like dot as the spark
    c = s * content                      # width of the safe content box
    x0 = (s - c) / 2
    y0 = (s - c) / 2
    bar = c * 0.2
    r = bar / 2
    stem_x = x0 + c * 0.16
    d.rounded_rectangle([stem_x, y0 + c * 0.04, stem_x + bar, y0 + c * 0.96], radius=r, fill=WHITE)
    d.rounded_rectangle([stem_x, y0 + c * 0.96 - bar, x0 + c * 0.88, y0 + c * 0.96], radius=r, fill=WHITE)
    cx, cy, cr = x0 + c * 0.76, y0 + c * 0.26, c * 0.13
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=LIGHT)
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
