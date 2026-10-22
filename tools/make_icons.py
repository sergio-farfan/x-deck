#!/usr/bin/env python3
"""Render the XDeck toolbar icons (icons/icon{16,32,48,128}.png) without
external dependencies: a rounded accent square with three white column bars,
drawn on a 32-unit grid and supersampled for anti-aliasing."""

import os
import struct
import zlib

ACCENT = (0x1D, 0x9B, 0xF0)
WHITE = (0xFF, 0xFF, 0xFF)
BG_RADIUS = 8.0
BARS = [(7.0, 8.0, 4.5, 18.0), (14.0, 8.0, 4.5, 13.0), (21.0, 8.0, 4.5, 16.0)]
BAR_RADIUS = 1.5
SS = 4  # samples per axis


def in_round_rect(px, py, x, y, w, h, r):
    if px < x or py < y or px > x + w or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    rows = []
    scale = 32.0 / size
    for j in range(size):
        row = bytearray([0])  # PNG filter type 0
        for i in range(size):
            acc = [0.0, 0.0, 0.0]
            alpha = 0
            for sj in range(SS):
                for si in range(SS):
                    px = (i + (si + 0.5) / SS) * scale
                    py = (j + (sj + 0.5) / SS) * scale
                    if not in_round_rect(px, py, 0, 0, 32, 32, BG_RADIUS):
                        continue
                    color = ACCENT
                    for (x, y, w, h) in BARS:
                        if in_round_rect(px, py, x, y, w, h, BAR_RADIUS):
                            color = WHITE
                            break
                    acc[0] += color[0]
                    acc[1] += color[1]
                    acc[2] += color[2]
                    alpha += 1
            if alpha:
                row += bytes([round(acc[0] / alpha), round(acc[1] / alpha), round(acc[2] / alpha), round(255 * alpha / (SS * SS))])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(png(size, render(size)))
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
