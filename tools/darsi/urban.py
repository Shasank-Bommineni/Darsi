"""Urban fabric: the urbanity field, real OSM footprints, and the deterministic
plot/house generator that fills the gaps OSM does not map.

Honesty note (mirrored in docs/world-accuracy.md):
  * every footprint tagged in OSM is used verbatim          -> source "osm"
  * everything this module *invents* is marked              -> source "gen"
    Generated plots only ever appear inside the measured built-up envelope,
    always facing a real surveyed street, and never on top of a real footprint,
    a water body or mapped farmland.
"""
from __future__ import annotations

import math

import numpy as np

from .classify import (
    GROUND_DRY_EARTH,
    GROUND_FIELD,
    GROUND_GRASS,
    GROUND_SCRUB,
    GROUND_TOWN,
    GROUND_WATER_BED,
    LANDUSE_GROUND,
    NATURAL_GROUND,
    STOREY_H,
    classify_building,
)
from .geo import min_area_rect, poly_area, poly_centroid, polyline_length
from .rng import Rng, hash_f, hash_u32


def _blur(a: np.ndarray, radius_cells: int, passes: int = 2) -> np.ndarray:
    out = a.astype(np.float32)
    k = max(1, int(radius_cells))
    for _ in range(passes):
        pad = np.pad(out, k, mode="edge")
        c = np.cumsum(np.cumsum(pad, axis=0), axis=1)
        c = np.pad(c, ((1, 0), (1, 0)))
        n = 2 * k + 1
        h, w = out.shape
        out = (
            c[n : n + h, n : n + w] - c[0:h, n : n + w] - c[n : n + h, 0:w] + c[0:h, 0:w]
        ) / float(n * n)
    return out


class Occupancy:
    """2 m raster used to keep generated plots out of each other's way."""

    def __init__(self, half: float, cell: float = 2.0):
        self.half = half
        self.cell = cell
        self.n = int(2 * half / cell) + 1
        self.g = np.zeros((self.n, self.n), dtype=np.uint8)

    def _idx(self, x, y):
        return (int((x + self.half) / self.cell), int((self.half - y) / self.cell))

    def box(self, cx, cy, w, d, ang, pad=0.0):
        hw, hd = w * 0.5 + pad, d * 0.5 + pad
        ca, sa = math.cos(ang), math.sin(ang)
        corners = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, ly = sx * hw, sy * hd
            corners.append((cx + lx * ca - ly * sa, cy + lx * sa + ly * ca))
        return corners

    def _bounds(self, corners):
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        i0, j1 = self._idx(min(xs), min(ys))
        i1, j0 = self._idx(max(xs), max(ys))
        return max(0, i0), min(self.n - 1, i1), max(0, j0), min(self.n - 1, j1)

    def test_box(self, cx, cy, w, d, ang, pad=0.0) -> bool:
        c = self.box(cx, cy, w, d, ang, pad)
        i0, i1, j0, j1 = self._bounds(c)
        if i1 < i0 or j1 < j0:
            return False
        return not self.g[j0 : j1 + 1, i0 : i1 + 1].any()

    def mark_box(self, cx, cy, w, d, ang, pad=0.0, value=1):
        c = self.box(cx, cy, w, d, ang, pad)
        i0, i1, j0, j1 = self._bounds(c)
        if i1 < i0 or j1 < j0:
            return
        self.g[j0 : j1 + 1, i0 : i1 + 1] = value

    def mark_poly(self, poly, pad=0.0, value=1):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        # Conservative: mark the polygon's axis-aligned bounds grown by pad.
        i0, j1 = self._idx(min(xs) - pad, min(ys) - pad)
        i1, j0 = self._idx(max(xs) + pad, max(ys) + pad)
        i0, i1 = max(0, i0), min(self.n - 1, i1)
        j0, j1 = max(0, j0), min(self.n - 1, j1)
        if i1 >= i0 and j1 >= j0:
            self.g[j0 : j1 + 1, i0 : i1 + 1] = value

    def mark_corridor(self, pts, half_w, value=1):
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            L = math.hypot(bx - ax, by - ay)
            if L < 1e-6:
                continue
            ang = math.atan2(by - ay, bx - ax)
            self.mark_box((ax + bx) / 2, (ay + by) / 2, L + half_w, half_w * 2, ang, 0.0, value)


class UrbanField:
    """Coarse 'how built-up is it here' field, 0 (open country) .. 1 (bazaar)."""

    CELL = 16.0

    def __init__(self, half: float):
        self.half = half
        self.n = int(2 * half / self.CELL) + 1
        self.road = np.zeros((self.n, self.n), dtype=np.float32)
        self.bld = np.zeros((self.n, self.n), dtype=np.float32)
        self.land = np.zeros((self.n, self.n), dtype=np.float32)
        self.value = np.zeros((self.n, self.n), dtype=np.float32)

    def _idx(self, x, y):
        i = int((x + self.half) / self.CELL)
        j = int((self.half - y) / self.CELL)
        return min(max(i, 0), self.n - 1), min(max(j, 0), self.n - 1)

    def add_road(self, pts, weight):
        step = self.CELL * 0.6
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            L = math.hypot(bx - ax, by - ay)
            steps = max(1, int(L / step))
            for s in range(steps):
                t = s / steps
                i2, j2 = self._idx(ax + (bx - ax) * t, ay + (by - ay) * t)
                self.road[j2, i2] += weight * (L / steps)

    def add_building(self, cx, cy, area):
        i, j = self._idx(cx, cy)
        self.bld[j, i] += area

    def add_area(self, poly, score):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        i0, j1 = self._idx(min(xs), min(ys))
        i1, j0 = self._idx(max(xs), max(ys))
        from .geo import point_in_poly

        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                x = -self.half + (i + 0.5) * self.CELL
                y = self.half - (j + 0.5) * self.CELL
                if point_in_poly(x, y, poly):
                    self.land[j, i] = max(self.land[j, i], score) if score > 0 else min(self.land[j, i], score)

    def finalise(self, centres):
        rd = _blur(self.road, 5, 2)
        rd = rd / max(1e-6, float(np.percentile(rd, 99.5)))
        bd = _blur(self.bld, 6, 2)
        bd = bd / max(1e-6, float(np.percentile(bd, 99.5)))
        ld = _blur(self.land, 3, 1)

        place = np.zeros_like(rd)
        ys, xs = np.mgrid[0 : self.n, 0 : self.n]
        wx = -self.half + (xs + 0.5) * self.CELL
        wy = self.half - (ys + 0.5) * self.CELL
        for cx, cy, radius, strength in centres:
            d = np.hypot(wx - cx, wy - cy)
            place = np.maximum(place, strength * np.clip(1.0 - d / radius, 0, 1) ** 1.4)

        v = 1.25 * np.clip(rd, 0, 1.4) + 0.95 * np.clip(bd, 0, 1.4) + 0.55 * ld + 0.75 * place
        self.value = np.clip(v, 0.0, 1.0).astype(np.float32)

    def at(self, x, y) -> float:
        i, j = self._idx(x, y)
        return float(self.value[j, i])


# ----------------------------------------------------------------------------

RESIDENTIAL_MIX = [
    # (category, weight at u=0 .. weight at u=1)
    ("hut", 0.30, 0.01),
    ("house_small", 0.28, 0.20),
    ("house", 0.26, 0.34),
    ("house_large", 0.08, 0.16),
    ("house_two", 0.03, 0.22),
    ("apartment", 0.00, 0.045),
    ("unfinished", 0.025, 0.055),
    ("shed", 0.10, 0.02),
]

COMMERCIAL_MIX = [
    ("shop", 0.50, 0.42),
    ("shophouse", 0.18, 0.36),
    ("commercial", 0.08, 0.14),
    ("unfinished", 0.06, 0.05),
    ("shed", 0.18, 0.03),
]


def _mix_pick(mix, u: float, r: float) -> str:
    weights = [(name, w0 + (w1 - w0) * u) for name, w0, w1 in mix]
    total = sum(w for _, w in weights)
    x = r * total
    for name, w in weights:
        x -= w
        if x <= 0:
            return name
    return weights[-1][0]


def storeys_for(cat: str, u: float, rng: Rng, area: float) -> int:
    if cat in ("hut", "shed", "water_tank"):
        return 1
    if cat == "apartment":
        return rng.int(3, 4 if u < 0.8 else 5)
    if cat == "house_two":
        return 2
    if cat in ("warehouse", "industrial"):
        return 1
    if cat in ("temple", "mosque", "church"):
        return 1
    if cat in ("school", "hospital", "government", "civic"):
        return 1 + (1 if rng.chance(0.35 + 0.35 * u) else 0) + (1 if area > 700 and rng.chance(0.3) else 0)
    if cat in ("shop",):
        return 1 if rng.chance(0.62 - 0.25 * u) else 2
    if cat in ("shophouse",):
        return 2 if rng.chance(0.78) else 3
    if cat == "commercial":
        return rng.int(1, 2) + (1 if u > 0.65 and rng.chance(0.35) else 0)
    if cat == "unfinished":
        return rng.int(1, 2) + (1 if u > 0.6 and rng.chance(0.3) else 0)
    # plain houses
    p2 = 0.05 + 0.40 * u
    p3 = max(0.0, 0.14 * (u - 0.55) / 0.45) if u > 0.55 else 0.0
    f = rng.f()
    if f < p3:
        return 3
    if f < p3 + p2:
        return 2
    return 1


def building_height(cat: str, storeys: int, rng: Rng) -> tuple[float, float]:
    sh = STOREY_H.get(cat, 3.2) * rng.range(0.94, 1.07)
    body = sh * storeys
    parapet = 0.0
    if cat in ("house_small", "house", "house_large", "house_two", "apartment", "shop", "shophouse", "commercial", "school", "hospital", "government", "civic", "unfinished"):
        parapet = rng.range(0.55, 1.15)
    return body, parapet
