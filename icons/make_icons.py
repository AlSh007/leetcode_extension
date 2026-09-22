"""Draw the LeetCode-to-GitHub extension icon at each size Chrome asks for.

Rendered at 8x and downsampled with LANCZOS, so edges stay clean. The 16px
variant drops the chevrons: at that size they collapse into noise and the
arrow alone has to carry the mark.
"""
from PIL import Image, ImageDraw

BG_TOP    = (30, 38, 52)
BG_BOTTOM = (11, 15, 23)
ACCENT    = (255, 161, 22)    # LeetCode orange
LIGHT     = (230, 237, 243)   # GitHub Primer text
SS        = 8                 # supersample factor


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def gradient(size, top, bottom):
    g = Image.new("RGB", (1, size))
    px = g.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return g.resize((size, size), Image.NEAREST)


def draw_icon(px, simplified=False):
    S = px * SS
    u = lambda v: v * S                      # unit-square -> pixels
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    tile = gradient(S, BG_TOP, BG_BOTTOM).convert("RGBA")
    tile.putalpha(rounded_mask(S, int(u(0.22))))
    img.alpha_composite(tile)

    d = ImageDraw.Draw(img)

    if not simplified:
        # < and > flanking the arrow: "this is code"
        w = int(u(0.072))
        for pts in (
            [(0.345, 0.315), (0.212, 0.5), (0.345, 0.685)],   # <
            [(0.655, 0.315), (0.788, 0.5), (0.655, 0.685)],   # >
        ):
            d.line([(u(x), u(y)) for x, y in pts], fill=LIGHT, width=w, joint="curve")
            for x, y in pts:                                   # round the caps
                d.ellipse([u(x) - w / 2, u(y) - w / 2, u(x) + w / 2, u(y) + w / 2], fill=LIGHT)

    # Up-arrow: "push it". Wider and taller when it stands alone at 16px.
    if simplified:
        shaft_w, half, apex_y, head_y, tail_y = 0.150, 0.300, 0.150, 0.430, 0.850
    else:
        shaft_w, half, apex_y, head_y, tail_y = 0.104, 0.158, 0.245, 0.455, 0.760

    d.rounded_rectangle(
        [u(0.5 - shaft_w / 2), u(head_y - 0.02), u(0.5 + shaft_w / 2), u(tail_y)],
        radius=u(shaft_w / 2), fill=ACCENT,
    )
    d.polygon(
        [(u(0.5), u(apex_y)), (u(0.5 - half), u(head_y)), (u(0.5 + half), u(head_y))],
        fill=ACCENT,
    )
    return img.resize((px, px), Image.LANCZOS)


if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    for size in (16, 48, 128):
        icon = draw_icon(size, simplified=(size <= 16))
        icon.save(f"{out}/icon{size}.png")
        print(f"icon{size}.png  {size}x{size}")
