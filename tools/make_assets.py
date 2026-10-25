#!/usr/bin/env python3
"""Builds the plugin's GUI assets from the source artwork in assets_src/.

Everything happens in the native coordinate system of the main artwork
(1448 x 1086). The output PNGs land in Assets/ and are embedded by CMake.

  background.png   panel with all moving parts removed (knob pointers,
                   VU needles, lamp glows)
  knobcap_l.png    large knob cap without pointer slot (top-down, static)
  knobcap_s.png    small knob cap (pre-delay)
  tank_base.png    spring compartment with the springs removed
  tank_hot.png     same, with the backlight pushed (signal peaks)
  spring1..3.png   the three coil strips (RGBA, feathered), base lighting
  springhot1..3    the same strips, hot lighting
  lever_base.png   lever switch plate (no lever)
  lever_arm.png    lever arm incl. hub, pointing down, pivot at image centre
  lamp_on.png / lamp_off.png
"""
import json
import os
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets_src")
OUT = os.path.join(ROOT, "Assets")
os.makedirs(OUT, exist_ok=True)

gui = cv2.imread(os.path.join(SRC, "gui.png"))
bg = gui.copy()
H, W = bg.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]

layout = {"size": [W, H]}

# ---------------------------------------------------------------- knobs
# cap centre + radius (measured on the artwork). The skirt / scale centre sits
# a bit right and up of the cap because of the slight perspective.
caps = {
    "input":    (141.0, 749.5, 44.0),
    "predelay": (324.5, 750.5, 30.5),
    "reverb":   (511.0, 749.5, 44.0),
    "dwell":    (715.5, 750.0, 43.5),
    "tone":     (917.0, 750.0, 44.0),
    "mix":      (1116.5, 749.5, 43.5),
    "output":   (1306.5, 750.0, 44.0),
}


def make_cap(r_target):
    src = cv2.imread(os.path.join(SRC, "knob_b.png"), cv2.IMREAD_UNCHANGED)
    rgb = src[:, :, :3].astype(np.float32)
    cx, cy, r = 620.0, 608.0, 356.0
    h, w = rgb.shape[:2]
    gy, gx = np.mgrid[0:h, 0:w]
    # pointer slot incl. bevel -> fill by point reflection around the
    # centre of the conical brushing (pattern is point symmetric)
    pcx, pcy = 625.0, 604.0
    slot = (np.abs(gx - pcx) < 34) & (gy > cy - r - 5) & (gy < 505)
    rx = np.clip(np.round(2 * pcx - gx).astype(int), 0, w - 1)
    ry = np.clip(np.round(2 * pcy - gy).astype(int), 0, h - 1)
    filled = rgb.copy()
    filled[slot] = rgb[ry[slot], rx[slot]]
    # soften the seam
    soft = cv2.GaussianBlur(slot.astype(np.float32), (0, 0), 6)[..., None]
    blur = cv2.GaussianBlur(filled, (0, 0), 1.2)
    filled = filled * (1 - soft * 0.5) + blur * (soft * 0.5)
    # crop disc
    x0, y0 = int(cx - r), int(cy - r)
    disc = filled[y0:y0 + int(2 * r), x0:x0 + int(2 * r)]
    size = int(round(r_target * 2 * 4))  # 4x supersampled
    disc = cv2.resize(disc, (size, size), interpolation=cv2.INTER_AREA)
    return disc


def color_match(src, ref_pixels, src_mask):
    out = src.copy()
    for c in range(3):
        s = src[..., c][src_mask]
        r = ref_pixels[:, c]
        out[..., c] = (src[..., c] - s.mean()) / (s.std() + 1e-6) * r.std() * 0.9 + r.mean()
    return np.clip(out, 0, 255)


capimgs = {}
for name, r_t in (("l", 44.0), ("s", 30.5)):
    disc = make_cap(r_t)
    capimgs[name] = disc

for key, (cx, cy, r) in caps.items():
    sc = r / 44.0
    # reference pixels of the original cap (lower half, avoids slot)
    m_ref = ((xx - cx) ** 2 + (yy - cy) ** 2 < (r - 4) ** 2) & (yy > cy + 4)
    ref = bg[m_ref].astype(np.float32)
    disc = capimgs["s" if key == "predelay" else "l"]
    n = disc.shape[0]
    g = np.mgrid[0:n, 0:n]
    dm = ((g[1] - n / 2) ** 2 + (g[0] - n / 2) ** 2) < (n / 2 * 0.92) ** 2
    disc_m = color_match(disc, ref, dm)
    # save one cap per size (matched against the first knob of that size)
    if key in ("input", "predelay"):
        # RGBA, 4x supersampled, alpha = soft disc
        a = np.clip((n / 2 - np.sqrt((g[1] - n / 2 + .5) ** 2 + (g[0] - n / 2 + .5) ** 2)) / 4.0, 0, 1)
        rgba = np.dstack([disc_m, a * 255]).astype(np.uint8)
        down = cv2.resize(rgba, (int(round(2 * r * 2)), int(round(2 * r * 2))), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(OUT, "knobcap_%s.png" % ("s" if key == "predelay" else "l")), down)

    # remove pointer slot from background (it will be covered by the cap
    # sprite anyway; we just make sure no dark slot peeks out at the rim)
    # remove skirt marker (cream line at 12 o'clock on the skirt)
    sx, sy = cx + 8.0 * sc, cy - 3.5 * sc
    hsv = cv2.cvtColor(bg, cv2.COLOR_BGR2HSV)
    box = (np.abs(xx - sx) < 7 * sc) & (yy > sy - 70 * sc) & (yy < cy - r - 1) & \
          ((xx - sx) ** 2 + (yy - sy) ** 2 < (66 * sc) ** 2)
    mark = box & (hsv[:, :, 2] > 95)
    mark = cv2.dilate(mark.astype(np.uint8), np.ones((3, 3)), iterations=1)
    bg = cv2.inpaint(bg, mark, 4, cv2.INPAINT_TELEA)

    layout[key] = {"cap": [cx, cy, r], "skirt": [round(sx, 1), round(sy, 1)]}

# ---------------------------------------------------------------- VU meters
# needle pivot (below the window) and the needle's visible window
vu_in = {"pivot": [509.0, 464.0], "clip": [344, 205, 664, 343]}
# find output meter offset by template matching the input meter face
tpl = gui[215:330, 360:650]
res = cv2.matchTemplate(gui[180:360, 700:1200], tpl, cv2.TM_CCOEFF_NORMED)
_, mv, _, ml = cv2.minMaxLoc(res)
dx = 700 + ml[0] - 360
dy = 180 + ml[1] - 215
print("output VU offset", dx, dy, "score", round(mv, 3))
vu_out = {"pivot": [509.0 + dx, 464.0 + dy], "clip": [344 + dx, 205 + dy, 664 + dx, 343 + dy]}
layout["vu_in"], layout["vu_out"] = vu_in, vu_out

for off in ((0, 0), (dx, dy)):
    # needle: dark thin line from ~ (384,274) to (431,345)
    p0 = np.array([382.0 + off[0], 271.0 + off[1]])
    p1 = np.array([434.0 + off[0], 348.0 + off[1]])
    d = p1 - p0
    L = np.linalg.norm(d)
    nrm = np.array([-d[1], d[0]]) / L
    t = ((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / L ** 2
    dist = np.abs((xx - p0[0]) * nrm[0] + (yy - p0[1]) * nrm[1])
    m = (t > 0) & (t < 1) & (dist < 4.5)
    m = cv2.dilate(m.astype(np.uint8), np.ones((3, 3)), iterations=1)
    m[int(339 + off[1]):, :] = 0  # don't touch the bezel
    bg = cv2.inpaint(bg, m, 5, cv2.INPAINT_TELEA)
    # restore the scale arc segment the needle crossed: redraw a short arc
    # (black line, ~2px) around the pivot at the scale radius
    pv = (509.0 + off[0], 464.0 + off[1])

# ---------------------------------------------------------------- lamps
lamps = {
    "spring": [237.5, 900.5], "plate": [451.0, 901.0],
    "flat": [626.0, 902.0], "dub": [768.5, 902.0],
    "clean": [1007.5, 902.5], "dirty": [1214.0, 902.0],
}
layout["lamps"] = lamps
for k in ("spring", "flat", "dub", "clean"):
    x, y = lamps[k]
    m = ((xx - x) ** 2 + (yy - y) ** 2 < 15 ** 2).astype(np.uint8)
    bg = cv2.inpaint(bg, m, 9, cv2.INPAINT_TELEA)

# remove remaining warm halo: pull saturation/brightness down to the panel's
# average around the old glow
for k in ("spring", "dub", "clean"):
    x, y = lamps[k]
    rr = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
    zone = rr < 26
    hsv = cv2.cvtColor(bg, cv2.COLOR_BGR2HSV).astype(np.float32)
    ring = (rr > 30) & (rr < 40)
    vref = np.median(hsv[..., 2][ring])
    w_ = np.clip((26 - rr) / 26, 0, 1)
    over = np.clip(hsv[..., 2] - vref, 0, None)
    # only damp pixels that are brighter than reference and warm (not text)
    text = hsv[..., 2] > 150
    damp = zone & ~text
    hsv[..., 2][damp] = (hsv[..., 2] - over * w_ * 0.8)[damp]
    bg = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

# ---------------------------------------------------------------- toggles
toggles = {"springmode": [345.0, 903.0], "eq": [718.0, 903.0], "tankdrive": [1108.0, 903.0]}
layout["toggles"] = toggles

lev = cv2.imread(os.path.join(SRC, "lever.png"), cv2.IMREAD_UNCHANGED)
lev = cv2.copyMakeBorder(lev, 100, 100, 100, 100, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0)).astype(np.float32)
lh, lw = lev.shape[:2]
gy, gx = np.mgrid[0:lh, 0:lw]
gx = gx - 100
gy = gy - 100
pcx, pcy = 628.0, 520.0  # plate & hub centre (source coords)
hub_r = 136.0
shaft = (gx > 522) & (gx < 728) & (gy > pcy) & (gy < 1075)
arm_m = shaft | ((gx - pcx) ** 2 + (gy - pcy) ** 2 < hub_r ** 2)
arm_m = cv2.GaussianBlur(arm_m.astype(np.float32), (0, 0), 1.5)
arm = lev.copy()
arm[..., 3] = lev[..., 3] * arm_m
base = lev.copy()
rx = np.clip(np.round(2 * pcx - gx).astype(int) + 100, 0, lw - 1)
ry = np.clip(np.round(2 * pcy - gy).astype(int) + 100, 0, lh - 1)
reflect = shaft & (gy < 880)
base[reflect] = lev[ry[reflect], rx[reflect]]
base[shaft & (gy >= 880), 3] = 0
# crop square around pivot so rotation in code is simple
R = 560
Y0, X0 = int(pcy - R) + 100, int(pcx - R) + 100
base_c = base[Y0:Y0 + 2 * R, X0:X0 + 2 * R]
arm_c = arm[Y0:Y0 + 2 * R, X0:X0 + 2 * R]
# target: plate diameter (730 px source) -> 58 px on the panel, stored at 2x
scale = 58.0 / 730.0 * 2
side = int(round(2 * R * scale))
for nm, a in (("lever_base", base_c), ("lever_arm", arm_c)):
    a = np.clip(a, 0, 255)
    # premultiply for clean downscale
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4] / 255.0
    pm = cv2.resize(pm, (side, side), interpolation=cv2.INTER_AREA)
    al = pm[..., 3:4]
    pm[..., :3] = np.where(al > 0, pm[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
    cv2.imwrite(os.path.join(OUT, nm + ".png"), np.clip(pm, 0, 255).astype(np.uint8))
layout["lever_sprite"] = {"panel_size": 2 * R * 58.0 / 730.0}

# lamps: on / off sprites (2x)
lamp = cv2.imread(os.path.join(SRC, "lamp.png"), cv2.IMREAD_UNCHANGED).astype(np.float32)
lamp_c = lamp[40:1214, 40:1214]
sz = 2 * 20


def save_rgba(name, a, size):
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4] / 255.0
    pm = cv2.resize(pm, (size, size), interpolation=cv2.INTER_AREA)
    al = pm[..., 3:4]
    pm[..., :3] = np.where(al > 0, pm[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
    cv2.imwrite(os.path.join(OUT, name), np.clip(pm, 0, 255).astype(np.uint8))


save_rgba("lamp_on.png", lamp_c, sz)
off = lamp_c.copy()
lg, lx = np.mgrid[0:off.shape[0], 0:off.shape[1]]
lens = ((lx - 587) ** 2 + (lg - 600) ** 2) < 330 ** 2
hsv = cv2.cvtColor(np.clip(off[..., :3], 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
hsv[..., 2][lens] = hsv[..., 2][lens] * 0.22 + 8
hsv[..., 1][lens] = hsv[..., 1][lens] * 0.75
off[..., :3] = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
save_rgba("lamp_off.png", off, sz)
layout["lamp_size"] = 20

# ---------------------------------------------------------------- springs
tank = [92, 405, 1358, 595]  # x0, y0, x1, y1 of the compartment
layout["tank"] = tank
springs = [  # band (y0, y1) incl. shadow, coil x range
    {"y0": 446, "y1": 477, "x0": 259, "x1": 1192},
    {"y0": 493, "y1": 524, "x0": 259, "x1": 1192},
    {"y0": 538, "y1": 565, "x0": 259, "x1": 1192},
]
layout["springs"] = springs

tb = gui[tank[1]:tank[3], tank[0]:tank[2]].astype(np.float32)
clean = tb.copy()
for s in springs:
    a, b = s["y0"] - tank[1] - 1, s["y1"] - tank[1] + 1
    x0, x1 = s["x0"] - tank[0], s["x1"] - tank[0]
    top = clean[a - 2:a + 1].mean(0)
    bot = clean[b:b + 3].mean(0)
    for i, y in enumerate(range(a, b)):
        t = (y - a) / (b - a)
        clean[y, x0:x1] = top[x0:x1] * (1 - t) + bot[x0:x1] * t
# texture back a little grain
noise = np.random.default_rng(1).normal(0, 2.0, clean.shape[:2])[..., None]
clean = clean + noise * 0.6


def hot(img):
    """Push the backlight: warm screen blend with a glow centred on the
    bulbs and the middle of the tank."""
    h, w = img.shape[:2]
    gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
    glow = np.zeros((h, w), np.float32)
    for (bx, by, rad, amp) in ((180 - tank[0], 425 - tank[1], 160, 1.0),
                               (1265 - tank[0], 425 - tank[1], 160, 1.0),
                               (w / 2, 20, 520, 0.7)):
        glow += amp * np.exp(-(((gx - bx) / rad) ** 2 + ((gy - by) / (rad * 0.55)) ** 2))
    glow = np.clip(glow, 0, 1.2)[..., None]
    warm = np.array([40, 150, 255], np.float32)  # BGR amber
    lit = img * (1 + 0.55 * glow)
    lit = 255 - (255 - lit) * (1 - glow * 0.35 * warm / 255)
    return np.clip(lit, 0, 255)


cv2.imwrite(os.path.join(OUT, "tank_base.png"), np.clip(clean, 0, 255).astype(np.uint8))
cv2.imwrite(os.path.join(OUT, "tank_hot.png"), hot(clean).astype(np.uint8))
hot_full = hot(tb)
for i, s in enumerate(springs):
    a, b = s["y0"] - tank[1], s["y1"] - tank[1]
    x0, x1 = s["x0"] - tank[0], s["x1"] - tank[0]
    h = b - a
    alpha = np.ones((h, x1 - x0), np.float32)
    feather = 4
    for k in range(feather):
        alpha[k] *= (k + 0.5) / feather
        alpha[h - 1 - k] *= (k + 0.5) / feather
    for k in range(6):  # fade in at the anchors
        alpha[:, k] *= (k + 0.5) / 6
        alpha[:, -1 - k] *= (k + 0.5) / 6
    for nm, src in (("spring%d.png", tb), ("springhot%d.png", hot_full)):
        strip = src[a:b, x0:x1]
        cv2.imwrite(os.path.join(OUT, nm % (i + 1)),
                    np.dstack([np.clip(strip, 0, 255), alpha * 255]).astype(np.uint8))

cv2.imwrite(os.path.join(OUT, "background.jpg"), bg, [cv2.IMWRITE_JPEG_QUALITY, 93])
with open(os.path.join(OUT, "layout.json"), "w") as f:
    json.dump(layout, f, indent=1)
print("done")
