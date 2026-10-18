"""Placeholder portraits for the README mockup, with no dependencies.

⛔ Obviously generic on purpose. The repository is public and the card is built
around a photograph of a real person, so a flat silhouette says "a photo goes
here" without publishing anyone's face.

⚠️ Pure stdlib: Pillow is not a declared dependency of this project, and
installing one to make a picture is not a reasonable side effect. Rows are
filled as spans rather than per pixel, so 36 images take about a second.
"""
import math
import os
import struct
import zlib

NAMES = [
    'Fatai', 'Marsh', 'Delwin', 'Tracy', 'Backup', 'Steve', 'J.E.', 'Lonnie',
    'Sharon', 'Del ACU', 'Troy', 'Matt', 'Karl', 'Anders', 'Mikey', 'Dan',
    'Jordan', 'Josue', 'Ashlee', 'Shawn c', 'James', 'Hallie', 'Rebekah',
    'Jazmine', 'Stephen', 'Aaron', 'Tom', 'Nick', 'Eugene', 'Brittani',
    'MattW', 'Natrice', 'Mollie', 'Albert', 'Gillen', 'Steph',
]

# Muted stage-light hues, so a wall of them reads like a wall of photographs
# rather than a colour chart.
GROUNDS = [
    ((58, 74, 104), (18, 24, 36)),
    ((92, 60, 92), (30, 20, 32)),
    ((48, 90, 86), (16, 30, 30)),
    ((102, 70, 50), (32, 22, 16)),
    ((70, 66, 110), (20, 20, 34)),
    ((88, 56, 70), (28, 18, 24)),
]

W, H = 600, 800
OUT = os.path.join('config', 'backgrounds')


def write_png(path, rows, width, height):
    raw = bytearray()
    for row in rows:
        raw.append(0)            # filter type 0
        raw.extend(row)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as handle:
        handle.write(png)


def build(index):
    top, bottom = GROUNDS[index % len(GROUNDS)]
    shift = ((index % 5) - 2) * 18
    cx = W // 2 + shift
    head_r = 112
    head_cy = int(H * 0.36)
    sw = head_r * 2.9
    sy = head_cy + head_r * 1.35
    ink = (238, 240, 244)

    rows = []
    for y in range(H):
        # Ease the wash so the lower half goes dark, the way a stage photo does.
        t = (y / (H - 1)) ** 2
        ground = bytes((
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        ))
        row = bytearray(ground * W)

        def span(x0, x1):
            a = max(0, int(x0))
            b = min(W, int(x1))
            if b > a:
                row[a * 3:b * 3] = bytes(ink) * (b - a)

        dy = y - head_cy
        if abs(dy) <= head_r:
            half = math.sqrt(head_r * head_r - dy * dy)
            span(cx - half, cx + half)

        if y >= sy:
            # Shoulders: an elliptical cap at the neck that reaches full width
            # quickly, then straight sides down off the bottom edge. A shape
            # that keeps widening all the way down reads as a cone, not a
            # person — which is what the first attempt drew.
            cap = (H - sy) * 0.42
            if y < sy + cap:
                k = (sy + cap - y) / cap
                half = (sw / 2) * math.sqrt(max(0.0, 1 - k * k))
            else:
                half = sw / 2
            span(cx - half, cx + half)

        rows.append(row)
    return rows


def main():
    os.makedirs(OUT, exist_ok=True)
    made = 0
    for i, name in enumerate(NAMES):
        key = name.strip().lower()
        if not key:
            continue
        write_png(os.path.join(OUT, key + '.png'), build(i), W, H)
        made += 1
    print('wrote', made, 'placeholders to', OUT)


main()
