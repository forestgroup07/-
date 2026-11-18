#!/usr/bin/env python3
"""
3D mahjong tile via raymarched rounded-box SDF.
Strict size from LOCKED-BLANK-SIZE-0.1.0 (DU), colors from 1.0.1.

  L:W:T = 74:58:32
  Tg:Tc = 8:24   (绿薄 : 白厚 = 1:3)
  R ≈ 5 DU
  green RGB≈(75,138,62)  cream≈(210,199,170)

Orientation:
  green (+X) → table center (外)
  ivory (−X) → table edge / player (内)
  左侧：桌边在屏幕左 → 白面冲左，绿背冲右/桌心
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TILES = ROOT / "assets" / "mahjong" / "tiles"
PREVIEW = ROOT / "assets" / "mahjong" / "preview"

# ---- blank-size 0.1 DU, normalize W=58 → 1 ----
DU_W = 58.0
W = 1.0
L = 74.0 / DU_W
T = 32.0 / DU_W
TG = 8.0 / DU_W   # green thin
TC = 24.0 / DU_W  # ivory thick
R = 5.0 / DU_W    # 方圆角

# 1.0.1 solid colors — bright / 透亮 (match user ref gloss)
GREEN = np.array([75.0, 138.0, 62.0])
GREEN_HI = np.array([145.0, 205.0, 118.0])
GREEN_LO = np.array([58.0, 118.0, 50.0])
IVORY = np.array([226.0, 216.0, 190.0])
IVORY_HI = np.array([255.0, 252.0, 240.0])
IVORY_LO = np.array([198.0, 188.0, 162.0])

LIGHT = np.array([0.50, 0.92, -0.18], dtype=np.float64)
LIGHT /= np.linalg.norm(LIGHT)
LIGHT2 = np.array([-0.35, 0.40, 0.55], dtype=np.float64)  # fill / rim
LIGHT2 /= np.linalg.norm(LIGHT2)


def sdf_round_box(p, half, r):
    q = np.abs(p) - half
    return (
        np.linalg.norm(np.maximum(q, 0.0), axis=-1)
        + np.minimum(np.maximum(q[..., 0], np.maximum(q[..., 1], q[..., 2])), 0.0)
        - r
    )


def tile_center():
    # solid spans x∈[-TC, TG]; center shifted
    return np.array([(TG - TC) * 0.5, 0.0, 0.0])


def tile_half_and_r():
    hx = (TG + TC) * 0.5
    hy = L * 0.5
    hz = W * 0.5
    r = min(R, hx * 0.48, hy * 0.48, hz * 0.48)
    half = np.array([hx - r, hy - r, hz - r])
    return half, r


def sdf_tile(p):
    """p (...,3) world local."""
    half, r = tile_half_and_r()
    return sdf_round_box(p - tile_center(), half, r)


def sdf_grad(p, eps=1e-3):
    # p: (3,)
    dx = np.array([eps, 0, 0])
    dy = np.array([0, eps, 0])
    dz = np.array([0, 0, eps])
    return np.array([
        sdf_tile(p + dx) - sdf_tile(p - dx),
        sdf_tile(p + dy) - sdf_tile(p - dy),
        sdf_tile(p + dz) - sdf_tile(p - dz),
    ])


def look_at(eye, target, up=np.array([0.0, 1.0, 0.0])):
    f = target - eye
    f = f / np.linalg.norm(f)
    up = np.asarray(up, float)
    r = np.cross(f, up)
    rn = np.linalg.norm(r)
    if rn < 1e-9:
        up = np.array([0.0, 1.0, 0.0]) if abs(f[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        r = np.cross(f, up)
        rn = np.linalg.norm(r)
    r = r / rn
    u = np.cross(r, f)
    return r, u, f


def shade_batch(base, n, is_ivory):
    """Bright plastic: key + fill + sharp gloss + ivory 透亮 lift."""
    ndl = np.clip((n * LIGHT[None, :]).sum(axis=-1), 0, 1)
    ndl2 = np.clip((n * LIGHT2[None, :]).sum(axis=-1), 0, 1)
    col = base * (0.28 + 0.62 * ndl[:, None] + 0.28 * ndl2[:, None])
    half = LIGHT + np.array([0.0, 0.50, 1.0])
    half = half / np.linalg.norm(half)
    # sharp gloss (透亮)
    spec = np.clip((n * half[None, :]).sum(axis=-1), 0, 1)
    spec = spec ** 12 * 140.0 + spec ** 40 * 90.0
    rim = (1.0 - ndl) ** 2 * 36.0
    col = col + spec[:, None] + rim[:, None]
    # ivory translucency: lift toward warm white
    if np.any(is_ivory):
        lift = 0.18 + 0.12 * ndl[is_ivory]
        white = np.array([255.0, 252.0, 242.0])
        col[is_ivory] = col[is_ivory] * (1 - lift[:, None]) + white[None, :] * lift[:, None]
    # green also a bit wetter
    if np.any(~is_ivory):
        g = ~is_ivory
        liftg = 0.06 + 0.08 * ndl[g]
        gbright = np.array([160.0, 215.0, 130.0])
        col[g] = col[g] * (1 - liftg[:, None]) + gbright[None, :] * liftg[:, None]
    return np.clip(col, 0, 255)


def raymarch_frame(eye, target, size, fov_deg, bg, tile_offsets_z, up_vec=None):
    """
    Raymarch one or many tiles (same mesh, z offsets).
    tile_offsets_z: list of Z translations for each tile instance.
    """
    w, h = size
    up0 = np.array([0.0, 1.0, 0.0]) if up_vec is None else np.asarray(up_vec, float)
    right, up, fwd = look_at(np.asarray(eye, float), np.asarray(target, float), up0)
    aspect = w / h
    fov = math.radians(fov_deg)
    scale = math.tan(fov * 0.5)

    # pixel grid
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = (np.arange(h) + 0.5) / h * 2 - 1
    # y up in image → flip
    px, py = np.meshgrid(xs * aspect * scale, -ys * scale)

    # ray dirs
    dirs = (
        fwd[None, None, :]
        + right[None, None, :] * px[..., None]
        + up[None, None, :] * py[..., None]
    )
    dirs = dirs / np.linalg.norm(dirs, axis=-1, keepdims=True)

    buf = np.zeros((h, w, 4), dtype=np.float64)
    buf[:, :, 0] = bg[0]
    buf[:, :, 1] = bg[1]
    buf[:, :, 2] = bg[2]
    buf[:, :, 3] = 255
    hit_z = np.full((h, w), 1e9)

    half, r = tile_half_and_r()
    c0 = tile_center()
    # bbox radius for early out
    bbox_r = np.linalg.norm(half + r) + 0.05

    MAX_STEPS = 64
    SURF = 0.0015

    for zoff in tile_offsets_z:
        # shift tiles along Z in world: p_local = p_world - (0,0,zoff)
        origin = np.asarray(eye, float)

        # vectorized march per pixel is heavy if we do all steps; do coarse then refine
        # Start: distance from eye to tile center
        center_w = c0 + np.array([0.0, 0.0, zoff])
        # For each pixel, march
        t = np.zeros((h, w), dtype=np.float64)
        alive = np.ones((h, w), dtype=bool)
        # init t: ray-sphere approx
        oc = origin - center_w
        # quadratic sphere
        b = 2.0 * np.sum(dirs * oc[None, None, :], axis=-1)
        cc = np.dot(oc, oc) - bbox_r * bbox_r
        disc = b * b - 4 * cc
        hit_sph = disc > 0
        sqrt_d = np.sqrt(np.maximum(disc, 0))
        t0 = (-b - sqrt_d) * 0.5
        t1 = (-b + sqrt_d) * 0.5
        t = np.where(hit_sph, np.maximum(t0, 0.0), 0.0)
        alive &= hit_sph & (t1 > 0)

        for _ in range(MAX_STEPS):
            if not np.any(alive):
                break
            pts = origin + dirs * t[..., None]
            # local
            pl = pts.copy()
            pl[..., 2] -= zoff
            d = sdf_tile(pl)
            # only update alive
            near = alive & (d < SURF)
            # record hits if closer
            # (handle below after loop with final d)
            t = np.where(alive, t + np.maximum(d, SURF * 0.5), t)
            # escaped sphere
            alive &= hit_sph & (t < t1 + 0.15) & (d > SURF) & (d < bbox_r * 3)

        pts = origin + dirs * t[..., None]
        pl = pts.copy()
        pl[..., 2] -= zoff
        d = sdf_tile(pl)
        mask = hit_sph & (d < SURF * 4) & (t < hit_z) & (t > 0)

        if not np.any(mask):
            continue

        ys_i, xs_i = np.where(mask)
        pts_h = pl[ys_i, xs_i]
        # central differences batch
        eps = 1e-3
        e = np.eye(3) * eps
        n = np.stack([
            sdf_tile(pts_h + e[0]) - sdf_tile(pts_h - e[0]),
            sdf_tile(pts_h + e[1]) - sdf_tile(pts_h - e[1]),
            sdf_tile(pts_h + e[2]) - sdf_tile(pts_h - e[2]),
        ], axis=-1)
        ln = np.linalg.norm(n, axis=-1, keepdims=True)
        ln = np.maximum(ln, 1e-9)
        n = n / ln
        ndl = np.clip((n * LIGHT[None, :]).sum(axis=-1), 0, 1)
        is_g = pts_h[:, 0] >= 0.0
        is_ivory = ~is_g
        base = np.empty_like(pts_h)
        base[is_g] = GREEN_LO[None, :] * (1 - ndl[is_g, None]) + GREEN_HI[None, :] * (0.12 + 0.88 * ndl[is_g, None])
        base[is_ivory] = IVORY_LO[None, :] * (1 - ndl[is_ivory, None]) + IVORY_HI[None, :] * (0.12 + 0.88 * ndl[is_ivory, None])
        col = shade_batch(base, n, is_ivory)
        buf[ys_i, xs_i, 0] = col[:, 0]
        buf[ys_i, xs_i, 1] = col[:, 1]
        buf[ys_i, xs_i, 2] = col[:, 2]
        buf[ys_i, xs_i, 3] = 255
        hit_z[ys_i, xs_i] = t[ys_i, xs_i]

    return Image.fromarray(np.clip(buf, 0, 255).astype(np.uint8), "RGBA")


def crop_content(img, pad=16):
    a = np.array(img)
    rgb = a[:, :, :3].astype(int)
    mask = ~((rgb[:, :, 0] < 12) & (rgb[:, :, 1] < 12) & (rgb[:, :, 2] < 12))
    if a.shape[2] == 4:
        mask |= a[:, :, 3] > 8
    # also treat teal bg
    teal = (
        (np.abs(rgb[:, :, 0] - 12) < 18)
        & (np.abs(rgb[:, :, 1] - 48) < 22)
        & (np.abs(rgb[:, :, 2] - 52) < 22)
    )
    mask &= ~teal
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return img
    return img.crop(
        (max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad), min(a.shape[0], ys.max() + pad))
    )


def make_one():
    # User ref: green back → upper-right (桌心); ivory thick → lower-left (左侧玩家).
    # Camera on +X (green) + high Y; +Z so ivory rim falls lower-left in frame.
    img = raymarch_frame(
        eye=np.array([1.55, 1.95, 1.15]),
        target=np.array([-0.05, -0.12, -0.05]),
        size=(880, 880),
        fov_deg=26,
        bg=(0, 0, 0),
        tile_offsets_z=[0.0],
    )
    a = np.array(img)
    black = (a[:, :, 0] < 8) & (a[:, :, 1] < 8) & (a[:, :, 2] < 8)
    a[black, 3] = 0
    # no SMOOTH — keeps 透亮 edges sharp
    return crop_content(Image.fromarray(a, "RGBA"), pad=18)


def make_hand(n=13, mode="row"):
    pitch = W * 1.004
    z0 = -((n - 1) * pitch) / 2
    offsets = [z0 + i * pitch for i in range(n)]

    if mode == "row":
        # From center: green backs toward camera/center; ivory away toward player
        return raymarch_frame(
            eye=np.array([3.2, 1.6, -4.0]),
            target=np.array([0.0, 0.02, 0.0]),
            size=(1100, 520),
            fov_deg=28,
            bg=(12, 48, 52),
            tile_offsets_z=offsets,
        )

    # Left hand from 主牌位 looking LEFT (company angle).
    # Same look; farther + wider + pan so nearest tile is fully inside after FLIP
    # (no clipped half-tile on the near/left end).
    # pan≈1.25 (between 1.0 L-tight and 2.0 R-clip) so ivory face of near tile clears left
    img = raymarch_frame(
        eye=np.array([6.54, 4.60, -13.26]),
        target=np.array([-1.01, 0.45, -1.01]),
        size=(1100, 1200),
        fov_deg=32,
        bg=(12, 48, 52),
        tile_offsets_z=offsets,
        up_vec=np.array([0.0, 1.0, 0.0]),
    )
    # ivory (−X) → screen LEFT (左家), green → 桌心
    return img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def main():
    TILES.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    print(f"blank DU L:W:T={74}:{58}:{32} Tg:Tc={8}:{24} R={5} | norm L={L:.4f} T={T:.4f} Tg={TG:.4f} Tc={TC:.4f} R={R:.4f}")

    print("1/3 single")
    one = make_one()
    one.save(TILES / "hand-left-back-one.png")
    one.save(TILES / "hand-left-back-one.webp", quality=95)
    one.save(TILES / "hand-left-back-one-3D.png")
    one.save(TILES / "hand-left-back-one-CUBOID-FLY.png")
    solo = Image.new("RGBA", (one.size[0] + 56, one.size[1] + 56), (12, 48, 52, 255))
    solo.alpha_composite(one, (28, 28))
    solo.convert("RGB").save(PREVIEW / "hand-left-back-one-preview-felt.jpg", quality=93)

    print("2/3 x13 row")
    row = make_hand(13, "row")
    ImageDraw.Draw(row).text((12, 10), "blank DU L:W:T=74:58:32 Tg:Tc=8:24 | ivory->player green->center", fill=(230, 230, 210))
    row.convert("RGB").save(PREVIEW / "hand-left-back-x13-preview.jpg", quality=93)

    print("3/3 left seat (ivory->screen left / desk edge)")
    left = make_hand(13, "left")
    ImageDraw.Draw(left).text((10, 8), "LEFT x13 | ivory->left edge | green->center | Tg:Tc=8:24", fill=(230, 230, 210))
    left.convert("RGB").save(PREVIEW / "hand-left-back-x13-leftseat.jpg", quality=93)
    # transparent strip for table paste (no caption)
    left_t = make_hand(13, "left")
    a = np.array(left_t)
    teal = (
        (np.abs(a[:, :, 0].astype(int) - 12) < 18)
        & (np.abs(a[:, :, 1].astype(int) - 48) < 22)
        & (np.abs(a[:, :, 2].astype(int) - 52) < 22)
    )
    a[teal, 3] = 0
    Image.fromarray(a, "RGBA").save(TILES / "hand-left-back-x13-leftseat.png")
    print("OK", TILES / "hand-left-back-one.png")
    print(TILES / "hand-left-back-x13-leftseat.png")


if __name__ == "__main__":
    main()
