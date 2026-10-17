#!/usr/bin/env python3
"""Cut every icon target from one definition of the mark (#176).

⭐ The mark is **Channels**: six channel blocks on a 64-unit grid, two of them
lit. Chosen from six directions on the 2.0 artwork canvas because it is the only
one that survives 16px as a single drawing -- six blocks of flat colour is the
easiest thing a small grid can draw -- and the only one that shows more than one
state at once, which is what the product is.

⛔ **Do not hand-resize the output.** Every target is rendered from the geometry
below at that exact pixel count. A 16px icon downsampled from 1024 goes to mush.

⛔ **The mark is NOT the "Card" direction.** The canvas's *One source, five
targets* artboard is drawn with Card as a worked example and says so in its own
caption; three other artboards repeat that drawing. Channels is the chosen one
(*Six mark directions -- Channels chosen*). Reading the targets artboard alone
ships the wrong mark.

Needs Pillow, which is NOT in the app's runtime requirements -- this is a
build-time tool run by hand when the artwork changes:

    pip install Pillow
    python scripts/make-icons.py

Writes resources/wirelessboard.{icns,ico,svg}, resources/wirelessboard-light.svg,
static/favicon.png and static/logo.png.
"""

import math
import os
import struct
import sys
from io import BytesIO

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - a tool, not shipped code
    sys.exit('Pillow is needed: pip install Pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- the mark

GRID = 64          # the unit square every coordinate below is in
RADIUS = 3         # corner radius of one block, in grid units

# x, y, w, h, role. Two rows of three; the grid is centred in its box with
# 4 units left/right and 6 top/bottom.
CELLS = (
    (4, 6, 16, 24, 'idle'),
    (24, 6, 16, 24, 'good'),
    (44, 6, 16, 24, 'idle'),
    (4, 34, 16, 24, 'warn'),
    (24, 34, 16, 24, 'idle'),
    (44, 34, 16, 24, 'idle'),
)

# ⛔ Two sets of fills, not one. The board's values are tuned for a near-black
# ground and wash out on white: #69B578 is only 2.2:1 there.
DARK = {'idle': '#5A5A5A', 'good': '#69B578', 'warn': '#EF9D51'}
LIGHT = {'idle': '#8A8A8A', 'good': '#3F8A52', 'warn': '#B06C1E'}

GROUND = '#262626'     # the card ground, and the icon tile
SQUIRCLE = 0.2264      # macOS tile corner radius as a fraction of the tile

SS = 8                 # supersample factor, for the corners only


def _rgba(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def snap(value):
    """Round half **up**, always.

    ⛔⛔ NOT the built-in `round`, which rounds half to even. At 16px the first
    row of blocks ends at y=7.5 and the second starts at y=8.5; banker's
    rounding sends both to 8, the 1px gap between the rows disappears and the
    mark reads as two bars instead of six blocks. `test_gaps` pins this.
    """
    return math.floor(value + 0.5)


def framing(px, mac):
    """How a target frames the mark at this size.

    ⛔ Not one ratio for every size. macOS's 80% tile leaves a 9px mark inside a
    16px canvas -- the six blocks cannot resolve at all, and the icon collapses
    into bars. Below 64px the mark fills the canvas instead, which is what the
    canvas's own 16px test drew and what Apple's own small icons do.
    """
    if px < 64:
        return dict(tile=1.0, tile_radius=0.12 if mac else 0.0, mark=1.0)
    if mac:
        return dict(tile=0.80, tile_radius=SQUIRCLE, mark=0.78)
    return dict(tile=1.0, tile_radius=0.0, mark=0.80)


def blocks(px, tile=None, mark=1.0):
    """Where every block lands, in whole target pixels."""
    side = snap(px * tile) if tile else px
    mark_side = snap(side * mark) if tile else snap(px * mark)
    origin = snap((px - mark_side) / 2)
    unit = mark_side / float(GRID)
    out = []
    for cx, cy, cw, ch, role in CELLS:
        out.append((
            origin + snap(cx * unit), origin + snap(cy * unit),
            origin + snap((cx + cw) * unit), origin + snap((cy + ch) * unit),
            role,
        ))
    return out, snap(RADIUS * unit)


def render(px, fills, tile=None, tile_radius=0.0, mark=1.0):
    """One square icon at `px` pixels.

    `tile` is the ground's side as a fraction of the canvas, or None for a
    transparent ground. `mark` is the mark's 64-unit box as a fraction of the
    *tile* when there is one, else of the canvas.

    ⭐ Every edge is snapped to a whole target pixel before supersampling, so a
    block's sides land exactly on the grid at every size and only the rounded
    corners are antialiased. That is what keeps 16px crisp.
    """
    big = Image.new('RGBA', (px * SS, px * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)

    if tile:
        side = snap(px * tile)
        off = snap((px - side) / 2)
        r = snap(side * tile_radius)
        box = [off * SS, off * SS, (off + side) * SS - 1, (off + side) * SS - 1]
        if r:
            draw.rounded_rectangle(box, radius=r * SS, fill=_rgba(GROUND))
        else:
            draw.rectangle(box, fill=_rgba(GROUND))

    placed, r = blocks(px, tile=tile, mark=mark)
    for x0, y0, x1, y1, role in placed:
        box = [x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1]
        if r:
            draw.rounded_rectangle(box, radius=r * SS, fill=_rgba(fills[role]))
        else:
            draw.rectangle(box, fill=_rgba(fills[role]))

    # ⚠️ BOX, not LANCZOS: an area average of integer-aligned edges reproduces
    # them exactly, where LANCZOS rings and softens a block's side.
    return big.resize((px, px), Image.BOX)


def png_bytes(img):
    buf = BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- containers

# type -> pixel size. The @2x entries are the same pixels as the @1x of twice
# the size, which is what macOS expects.
ICNS_TYPES = (
    (b'icp4', 16), (b'icp5', 32), (b'ic11', 32), (b'ic12', 64),
    (b'ic07', 128), (b'ic13', 256), (b'ic08', 256), (b'ic14', 512),
    (b'ic09', 512), (b'ic10', 1024),
)


def write_icns(path, images):
    """An icns is a header then (type, length, payload) chunks. PNG payloads."""
    chunks = b''
    for kind, size in ICNS_TYPES:
        payload = png_bytes(images[size])
        chunks += kind + struct.pack('>I', len(payload) + 8) + payload
    with open(path, 'wb') as handle:
        handle.write(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)


def write_ico(path, images, sizes):
    """An ico directory with a PNG payload per entry.

    ⭐ Each entry is its own render. Pillow's own ICO save downsamples one
    image into every size, which is the thing this script exists to avoid.
    """
    payloads = [png_bytes(images[s]) for s in sizes]
    header = struct.pack('<HHH', 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    directory = b''
    for size, payload in zip(sizes, payloads):
        wide = 0 if size >= 256 else size
        directory += struct.pack(
            '<BBBBHHII', wide, wide, 0, 0, 1, 32, len(payload), offset)
        offset += len(payload)
    with open(path, 'wb') as handle:
        handle.write(header + directory + b''.join(payloads))


def write_svg(path, fills, ground=None):
    """The vector source, for anything that wants it rather than a raster."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" '
             'width="64" height="64" role="img" aria-label="Wirelessboard">']
    if ground:
        parts.append(f'<rect width="64" height="64" fill="{ground}"/>')
    for cx, cy, cw, ch, role in CELLS:
        parts.append(
            f'<rect x="{cx}" y="{cy}" width="{cw}" height="{ch}" '
            f'rx="{RADIUS}" fill="{fills[role]}"/>')
    parts.append('</svg>')
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(parts) + '\n')


# ---------------------------------------------------------------- the targets

def test_gaps():
    """⛔ Every block keeps a gap from its neighbours, at every size shipped.

    This is the whole 16px test, as an assertion. Two separate faults have
    closed these gaps already: banker's rounding merging the two rows, and a
    tile ratio that left the mark 9px wide inside a 16px canvas. Both looked
    fine in the container and wrong on screen.
    """
    sizes = sorted({s for _k, s in ICNS_TYPES} | {16, 24, 32, 48, 64, 128, 256})
    for mac in (True, False):
        for px in sizes:
            placed, _r = blocks(px, **{k: v for k, v in framing(px, mac).items()
                                       if k != 'tile_radius'})
            cols = sorted({(b[0], b[2]) for b in placed})
            rows = sorted({(b[1], b[3]) for b in placed})
            where = f'{"macOS" if mac else "Windows"} {px}px'
            for (_a0, a1), (b0, _b1) in zip(cols, cols[1:]):
                assert b0 > a1, f'{where}: columns touch at x={a1}'
            for (_a0, a1), (b0, _b1) in zip(rows, rows[1:]):
                assert b0 > a1, f'{where}: rows touch at y={a1}'
            for x0, y0, x1, y1, _role in placed:
                assert x1 - x0 >= 2 and y1 - y0 >= 2, \
                    f'{where}: a block is thinner than 2px'


def main():
    test_gaps()
    out = []

    # macOS: above 64px the tile fills 80% of the canvas with transparent margin
    # and the corner radius is drawn in -- macOS rounds nothing for you. Below
    # that the mark fills the canvas; see `framing`.
    mac = {size: render(size, DARK, **framing(size, True))
           for size in sorted({s for _k, s in ICNS_TYPES})}
    icns = os.path.join(ROOT, 'resources', 'wirelessboard.icns')
    write_icns(icns, mac)
    out.append((icns, 'macOS bundle, 16-1024 each @1x @2x'))

    # Windows: full bleed, square, no inset -- the shell draws the frame.
    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    win = {size: render(size, DARK, **framing(size, False))
           for size in ico_sizes}
    ico = os.path.join(ROOT, 'resources', 'wirelessboard.ico')
    write_ico(ico, win, ico_sizes)
    out.append((ico, 'Windows, ' + ' '.join(str(s) for s in ico_sizes)))

    # Browser tab: the one place the mark lands on light chrome, so it takes the
    # light fills and no ground of its own.
    #
    # ⭐ 64 and not 32, although the tab draws it at 16 or 32: at 64 the grid
    # unit is exactly one pixel, so every edge is an integer and the browser's
    # own halving to 32 lands back on whole pixels. It is also what shipped
    # before -- a 32px file would have halved the resolution on a retina tab.
    favicon = os.path.join(ROOT, 'static', 'favicon.png')
    render(64, LIGHT, mark=1.0).save(favicon, format='PNG', optimize=True)
    out.append((favicon, 'browser tab, 64, light-ground fills'))

    # Home screen: maskable. The launcher crops to whatever shape it likes, so
    # the ground is full bleed and everything that must survive sits inside the
    # centre 80% circle -- a square inside that circle is 0.8/sqrt(2) of the side.
    logo = os.path.join(ROOT, 'static', 'logo.png')
    render(512, DARK, tile=1.0, tile_radius=0.0, mark=0.5657).save(
        logo, format='PNG', optimize=True)
    out.append((logo, 'home screen, 512, maskable'))

    # README header. ⚠️ The canvas's "one source, five targets" artboard calls
    # this a 1280-wide lockup of mark plus name. The README does not use it that
    # way -- it renders this file at 90x90 -- so it is cut as a square badge to
    # match what is actually on the page. Changing the README to a wide lockup
    # is README imagery, the other half of #176, and a separate decision.
    # 360 is 4x the rendered size, so it stays sharp on a retina screen.
    readme = os.path.join(ROOT, 'docs', 'img', 'logo.png')
    render(360, DARK, tile=1.0, tile_radius=0.18, mark=0.78).save(
        readme, format='PNG', optimize=True)
    out.append((readme, 'README header, 360 square, shown at 90'))

    write_svg(os.path.join(ROOT, 'resources', 'wirelessboard.svg'), DARK)
    write_svg(os.path.join(ROOT, 'resources', 'wirelessboard-light.svg'), LIGHT)
    out.append((os.path.join(ROOT, 'resources', 'wirelessboard.svg'),
                'vector source, dark and light'))

    for path, note in out:
        size = os.path.getsize(path)
        print(f'{os.path.relpath(path, ROOT).replace(os.sep, "/"):40} '
              f'{size:>8,} bytes  {note}')


if __name__ == '__main__':
    main()
