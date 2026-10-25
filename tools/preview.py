#!/usr/bin/env python3
"""Quick compositing preview of the assets (mirrors what the editor draws)."""
import json, math, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = lambda n: Image.open(os.path.join(ROOT, "Assets", n)).convert("RGBA")
L = json.load(open(os.path.join(ROOT, "Assets", "layout.json")))
val = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/claude-0/s/preview.png"

S = 2  # draw at 2x for antialiasing
bg = A("background.jpg").resize((L["size"][0] * S, L["size"][1] * S), Image.LANCZOS)
cv = bg.copy()
tank = L["tank"]
tb = A("tank_base.png")
cv.alpha_composite(tb.resize((tb.width * S, tb.height * S)), (tank[0] * S, tank[1] * S))
for i, s in enumerate(L["springs"]):
    sp = A("spring%d.png" % (i + 1))
    cv.alpha_composite(sp.resize((sp.width * S, sp.height * S)), (s["x0"] * S, s["y0"] * S))

d = ImageDraw.Draw(cv)
for k in ("input", "predelay", "reverb", "dwell", "tone", "mix", "output"):
    cx, cy, r = L[k]["cap"]
    sx, sy = L[k]["skirt"]
    ang = math.radians(-135 + 270 * val)
    sc = r / 44
    # skirt marker
    for t in range(0, 11):
        rr = (54 + t) * sc
        px, py = sx + math.sin(ang) * rr, sy - math.cos(ang) * rr
        if (px - cx) ** 2 + (py - cy) ** 2 > (r + 1.5) ** 2:
            d.ellipse([(px - 1.7 * sc) * S, (py - 1.7 * sc) * S, (px + 1.7 * sc) * S, (py + 1.7 * sc) * S], fill=(235, 222, 190, 255))
    cap = A("knobcap_s.png" if k == "predelay" else "knobcap_l.png").resize((int(2 * r * S), int(2 * r * S)), Image.LANCZOS)
    cv.alpha_composite(cap, (int((cx - r) * S), int((cy - r) * S)))
    d = ImageDraw.Draw(cv)
    w = 2.8 * sc
    for t in range(0, 60):
        rr = (r * 0.48) + t / 59 * (r * 0.47)
        px, py = cx + math.sin(ang) * rr, cy - math.cos(ang) * rr
        d.ellipse([(px - w) * S, (py - w) * S, (px + w) * S, (py + w) * S], fill=(22, 20, 18, 255))

for key in ("vu_in", "vu_out"):
    pv = L[key]["pivot"]
    ang = math.radians(-33.3 + 62 * val)
    x0, y0, x1, y1 = L[key]["clip"]
    lay = Image.new("RGBA", cv.size, (0, 0, 0, 0))
    dl = ImageDraw.Draw(lay)
    p0 = (pv[0] + math.sin(ang) * 120, pv[1] - math.cos(ang) * 120)
    p1 = (pv[0] + math.sin(ang) * 228, pv[1] - math.cos(ang) * 228)
    dl.line([(p0[0] * S + 6, p0[1] * S + 8), (p1[0] * S + 6, p1[1] * S + 8)], fill=(60, 40, 10, 70), width=4)
    dl.line([(p0[0] * S, p0[1] * S), (p1[0] * S, p1[1] * S)], fill=(20, 18, 16, 255), width=3)
    mask = Image.new("L", cv.size, 0)
    ImageDraw.Draw(mask).rectangle([x0 * S, y0 * S, x1 * S, y1 * S], fill=255)
    cv.paste(lay, (0, 0), Image.composite(lay, Image.new("RGBA", cv.size), mask).split()[3])

on = {"spring": val < .5, "plate": val >= .5, "flat": val < .5, "dub": val >= .5, "clean": val < .5, "dirty": val >= .5}
for k, (x, y) in L["lamps"].items():
    im = A("lamp_on.png" if on[k] else "lamp_off.png").resize((20 * S, 20 * S), Image.LANCZOS)
    cv.alpha_composite(im, (int((x - 10) * S), int((y - 10) * S)))

ps = L["lever_sprite"]["panel_size"]
for k, (x, y) in L["toggles"].items():
    base = A("lever_base.png").resize((int(ps * S), int(ps * S)), Image.LANCZOS)
    cv.alpha_composite(base, (int((x - ps / 2) * S), int((y - ps / 2) * S)))
    arm = A("lever_arm.png").rotate(-55 if val < .5 else 55, resample=Image.BICUBIC).resize((int(ps * S), int(ps * S)), Image.LANCZOS)
    cv.alpha_composite(arm, (int((x - ps / 2) * S), int((y - ps / 2) * S)))

cv.resize(L["size"]).convert("RGB").save(out)
print(out)
