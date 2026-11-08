#!/usr/bin/env python3
"""Build flush annular-sector mask for track cell 8 from shared ring with 30/23."""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
BOARD = ROOT / "assets/roulette/pc-full-ref.png"
OUT_MASK = ROOT / "assets/roulette/track-masks/n8.png"
OUT_PREV = ROOT / "assets/roulette/_fix-8-ring.jpg"
OUT_JSON = ROOT / "assets/roulette/_n8-ring-params.json"
SW, SH = 2284, 1468


def main() -> None:
    board = np.array(Image.open(BOARD).convert("RGB"))
    H, W = board.shape[:2]
    r, g, b = [board[:, :, i].astype(np.int16) for i in range(3)]

    def is_red(x: int, y: int) -> bool:
        return (
            0 <= x < W
            and 0 <= y < H
            and int(r[y, x]) > 110
            and r[y, x] > g[y, x] + 35
            and r[y, x] > b[y, x] + 35
        )

    def is_dark(x: int, y: int) -> bool:
        return (
            0 <= x < W
            and 0 <= y < H
            and r[y, x] < 70
            and g[y, x] < 85
            and b[y, x] < 110
            and int(r[y, x]) + int(g[y, x]) + int(b[y, x]) > 40
        )

    def is_green(x: int, y: int) -> bool:
        return (
            0 <= x < W
            and 0 <= y < H
            and g[y, x] > r[y, x] + 25
            and g[y, x] > b[y, x] + 15
            and g[y, x] > 80
        )

    def flood(pred, seed, bounds, limit=40000):
        x0, y0, x1, y1 = bounds
        q = deque([seed])
        seen = {seed}
        pts = []
        while q and len(pts) < limit:
            x, y = q.popleft()
            if not (x0 <= x < x1 and y0 <= y < y1):
                continue
            if not pred(x, y):
                continue
            pts.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if (nx, ny) not in seen:
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return np.array(pts)

    def circ_fit(xs, ys):
        A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
        bb = xs * xs + ys * ys
        sol, _, _, _ = np.linalg.lstsq(A, bb, rcond=None)
        cx, cy, c = sol
        R = float(np.sqrt(max(float(c) + cx * cx + cy * cy, 1e-6)))
        return float(cx), float(cy), R

    c30 = flood(is_red, (1860, 318), (1800, 250, 1950, 380))
    c23 = flood(is_red, (1965, 220), (1900, 160, 2050, 280))

    # Shared ring: fit outer circle to outer edges of 30+23, Ri at same center
    cx0, cy0 = 2008.0, 367.0
    outer_pts, inner_pts = [], []
    for comp in (c30, c23):
        angs = np.arctan2(comp[:, 1] - cy0, comp[:, 0] - cx0)
        radii = np.sqrt((comp[:, 0] - cx0) ** 2 + (comp[:, 1] - cy0) ** 2)
        amin, amax = float(angs.min()), float(angs.max())
        for i in range(56):
            a0 = amin + (amax - amin) * i / 56
            a1 = amin + (amax - amin) * (i + 1) / 56
            m = (angs >= a0) & (angs < a1)
            if int(m.sum()) < 3:
                continue
            pts = comp[m]
            rs = radii[m]
            outer_pts.append(pts[int(np.argmax(rs))])
            inner_pts.append(pts[int(np.argmin(rs))])
    outer_pts = np.array(outer_pts)
    inner_pts = np.array(inner_pts)

    cx, cy, Ro = circ_fit(outer_pts[:, 0].astype(float), outer_pts[:, 1].astype(float))
    ri = np.sqrt((inner_pts[:, 0] - cx) ** 2 + (inner_pts[:, 1] - cy) ** 2)
    Ri = float(np.median(ri))
    print("shared ring", f"cx={cx:.2f} cy={cy:.2f} Ri={Ri:.2f} Ro={Ro:.2f} thick={Ro - Ri:.2f}")

    # Dark 8 between 30/23 angular centroids, clipped to ring band
    a30c = float(np.arctan2(c30[:, 1].mean() - cy, c30[:, 0].mean() - cx))
    a23c = float(np.arctan2(c23[:, 1].mean() - cy, c23[:, 0].mean() - cx))
    a_lo_g, a_hi_g = sorted([a30c, a23c])
    digit = (1936, 256)

    def pred8(x, y):
        if not is_dark(x, y):
            return False
        rr = float(np.hypot(x - cx, y - cy))
        if not (Ri - 10 <= rr <= Ro + 12):
            return False
        ang = float(np.arctan2(y - cy, x - cx))
        return a_lo_g - 0.06 <= ang <= a_hi_g + 0.06

    c8 = flood(pred8, digit, (1830, 170, 2020, 350))
    set30 = set(map(tuple, c30.tolist()))
    set23 = set(map(tuple, c23.tolist()))
    set8 = set(map(tuple, c8.tolist()))

    wall_lo, wall_hi = [], []
    for x, y in set8:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n in set30:
                wall_lo.append((x, y))
            if n in set23:
                wall_hi.append((x, y))
    wall_lo = np.asarray(wall_lo)
    wall_hi = np.asarray(wall_hi)
    print("wall pts", len(wall_lo), len(wall_hi), "c8", len(c8))

    def med_ang(pts: np.ndarray) -> float:
        return float(np.median(np.arctan2(pts[:, 1] - cy, pts[:, 0] - cx)))

    if len(wall_lo) >= 3 and len(wall_hi) >= 3:
        a_lo, a_hi = sorted([med_ang(wall_lo), med_ang(wall_hi)])
    else:
        raise SystemExit("failed to find radial walls for 8")

    # Minimal inset (~0.7px at mid-radius) — keep flush to grooves
    dang = 0.7 / ((Ri + Ro) / 2.0)
    a_lo += dang
    a_hi -= dang
    print("walls", a_lo, a_hi, "span_deg", np.degrees(a_hi - a_lo))

    # Supersampled annular sector
    sample = np.linspace(a_lo, a_hi, 160)
    xs = list(cx + Ro * np.cos(sample)) + list(cx + Ri * np.cos(sample))
    ys = list(cy + Ro * np.sin(sample)) + list(cy + Ri * np.sin(sample))
    L = int(np.floor(min(xs) - 2))
    T = int(np.floor(min(ys) - 2))
    R = int(np.ceil(max(xs) + 2))
    B = int(np.ceil(max(ys) + 2))
    mw, mh = R - L, B - T
    scale = 4
    hi = Image.new("L", (mw * scale, mh * scale), 0)
    dr = ImageDraw.Draw(hi)
    outer = [
        ((cx + Ro * np.cos(a) - L) * scale, (cy + Ro * np.sin(a) - T) * scale)
        for a in np.linspace(a_lo, a_hi, 200)
    ]
    inner = [
        ((cx + Ri * np.cos(a) - L) * scale, (cy + Ri * np.sin(a) - T) * scale)
        for a in np.linspace(a_hi, a_lo, 200)
    ]
    dr.polygon(outer + inner, fill=255)
    soft = np.array(hi.resize((mw, mh), Image.Resampling.LANCZOS))

    yy, xx = np.ogrid[T:B, L:R]
    rad = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    ang = np.arctan2(yy - cy, xx - cx)
    hard = (rad >= Ri) & (rad <= Ro) & (ang >= a_lo) & (ang <= a_hi)
    final = soft.copy()
    final[~hard] = 0
    # kill residual AA fringe outside hard by 1px expand of ~hard
    # (already zeroed)

    for y in range(mh):
        for x in range(mw):
            if final[y, x] and is_green(x + L, y + T):
                final[y, x] = 0

    rgba = np.zeros((mh, mw, 4), dtype=np.uint8)
    rgba[:, :, 0:3] = 255
    rgba[:, :, 3] = final
    Image.fromarray(rgba).save(OUT_MASK)
    print("mask", OUT_MASK.name, "bbox", [L, T, R, B], "fill", int((final > 20).sum()))

    # Preview overlay
    x0, y0, x1, y1 = 1820, 170, 2030, 360
    vis = Image.fromarray(board[y0:y1, x0:x1].copy()).convert("RGBA")
    ov = Image.new("RGBA", vis.size, (0, 0, 0, 0))
    op = ov.load()
    for y in range(T, B):
        for x in range(L, R):
            a = int(final[y - T, x - L])
            if a > 15 and x0 <= x < x1 and y0 <= y < y1:
                op[x - x0, y - y0] = (255, 200, 50, int(a * 0.72))
    for a in np.linspace(-2.95, -1.55, 260):
        for RR, col in ((Ro, (0, 255, 255, 230)), (Ri, (255, 0, 255, 230))):
            x = cx + RR * np.cos(a)
            y = cy + RR * np.sin(a)
            if x0 <= x < x1 and y0 <= y < y1:
                ov.putpixel((int(x - x0), int(y - y0)), col)
    for a in (a_lo, a_hi):
        for rad_v in np.linspace(Ri, Ro, 80):
            x = cx + rad_v * np.cos(a)
            y = cy + rad_v * np.sin(a)
            if x0 <= x < x1 and y0 <= y < y1:
                ov.putpixel((int(x - x0), int(y - y0)), (0, 255, 0, 255))
    Image.alpha_composite(vis, ov).convert("RGB").save(OUT_PREV, quality=93)

    cell = {
        "n": 8,
        "left": round(L / SW * 100, 4),
        "top": round(T / SH * 100, 4),
        "width": round((R - L) / SW * 100, 4),
        "height": round((B - T) / SH * 100, 4),
        "px": [L, T, R, B],
        "geo": {
            "cx": cx,
            "cy": cy,
            "Ri": Ri,
            "Ro": Ro,
            "a_lo": float(a_lo),
            "a_hi": float(a_hi),
        },
    }
    OUT_JSON.write_text(json.dumps(cell, indent=2))
    print(json.dumps(cell, indent=2))


if __name__ == "__main__":
    main()
