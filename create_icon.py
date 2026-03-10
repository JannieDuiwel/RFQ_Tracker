#!/usr/bin/env python3
"""Creates rfq_icon.ico for RFQ Tracker Pro. Run this BEFORE building the .exe."""
from PIL import Image, ImageDraw
import os

def create_icon():
    sizes = [256, 128, 64, 48, 32, 16]
    images = []

    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d   = ImageDraw.Draw(img)

        m = max(1, size // 12)
        # Dark blue background
        d.rounded_rectangle([m, m, size - m, size - m],
                             radius=size // 6, fill="#2d3561")

        # Purple clip at top
        cw = size // 4
        ch = size // 8
        cx = (size - cw) // 2
        d.rounded_rectangle([cx, m - ch // 2, cx + cw, m + ch],
                             radius=2, fill="#6c5ce7")

        # Three coloured lines
        lm   = size // 5
        sy   = size // 3
        gap  = max(3, size // 8)
        th   = max(2, size // 20)
        for i, color in enumerate(["#00b894", "#74b9ff", "#fdcb6e"]):
            y = sy + i * gap
            d.rounded_rectangle([lm, y, size - lm, y + th], radius=1, fill=color)

        # Green checkmark circle
        cs  = size // 4
        cx2 = size - m - cs
        cy2 = size - m - cs
        d.ellipse([cx2, cy2, size - m, size - m], fill="#00b894")
        if size >= 32:
            t  = cs // 5
            lw = max(1, size // 32)
            d.line([cx2 + t, cy2 + cs // 2,
                    cx2 + cs // 2 - t, cy2 + cs - t * 2,
                    size - m - t, cy2 + t * 2],
                   fill="white", width=lw)

        images.append(img)

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rfq_icon.ico")
    images[0].save(out, format="ICO",
                   sizes=[(s, s) for s in sizes],
                   append_images=images[1:])
    print(f"Icon saved: {out}")

if __name__ == "__main__":
    create_icon()
