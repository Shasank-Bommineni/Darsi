"""Terrain heightfield construction for Darsi.

Pipeline
--------
1. Load the SRTM-derived DEM mosaic (web-mercator tile grid, metres AMSL).
2. Resample it onto the local east/north game grid with bicubic-ish sampling.
3. Add a small amount of deterministic sub-DEM detail so that the 30 m source
   does not read as faceted triangles up close -- amplitude is capped so the
   terrain stays geographically honest (field bunds, roadside camber, erosion).
4. Carve the real road network into it: every road centreline is longitudinally
   smoothed, then the terrain is pulled towards that profile inside the
   corridor with a smooth falloff.  This is what makes roads *conform to* the
   terrain instead of floating over it.
"""
from __future__ import annotations

import json
import math

import numpy as np

from .geo import Projector, polyline_length


def _mercator_y(lat_deg: float) -> float:
    lat = math.radians(lat_deg)
    return math.log(math.tan(math.pi / 4 + lat / 2))


class Dem:
    """Bilinear sampler over the downloaded DEM mosaic."""

    def __init__(self, path: str):
        z = np.load(path, allow_pickle=False)
        self.h = z["heights"].astype(np.float32)
        self.meta = json.loads(str(z["meta"]))
        m = self.meta
        self.north = float(m["mosaic_north"])
        self.south = float(m["mosaic_south"])
        self.west = float(m["mosaic_west"])
        self.east = float(m["mosaic_east"])
        self.rows, self.cols = self.h.shape
        # Terrarium tiles are a web-mercator grid: rows are linear in mercator y.
        self.merc_top = _mercator_y(self.north)
        self.merc_bot = _mercator_y(self.south)

    def sample_latlon(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        fx = (lon - self.west) / (self.east - self.west) * (self.cols - 1)
        my = _mercator_y_vec(lat)
        fy = (self.merc_top - my) / (self.merc_top - self.merc_bot) * (self.rows - 1)
        fx = np.clip(fx, 0, self.cols - 1.001)
        fy = np.clip(fy, 0, self.rows - 1.001)
        x0 = fx.astype(np.int32)
        y0 = fy.astype(np.int32)
        tx = fx - x0
        ty = fy - y0
        h = self.h
        h00 = h[y0, x0]
        h10 = h[y0, x0 + 1]
        h01 = h[y0 + 1, x0]
        h11 = h[y0 + 1, x0 + 1]
        return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty


def _mercator_y_vec(lat_deg: np.ndarray) -> np.ndarray:
    lat = np.radians(lat_deg)
    return np.log(np.tan(np.pi / 4 + lat / 2))


# ------------------------------------------------------------------ noise

def _hash2(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    n = (ix.astype(np.int64) * np.int64(374761393) + iy.astype(np.int64) * np.int64(668265263) + np.int64(seed) * np.int64(2147483647))
    n = (n ^ (n >> np.int64(13))) * np.int64(1274126177)
    n = n ^ (n >> np.int64(16))
    return (n & np.int64(0xFFFFFF)).astype(np.float64) / float(0xFFFFFF)


def value_noise(x: np.ndarray, y: np.ndarray, seed: int) -> np.ndarray:
    ix = np.floor(x)
    iy = np.floor(y)
    fx = x - ix
    fy = y - iy
    sx = fx * fx * (3 - 2 * fx)
    sy = fy * fy * (3 - 2 * fy)
    ix = ix.astype(np.int64)
    iy = iy.astype(np.int64)
    n00 = _hash2(ix, iy, seed)
    n10 = _hash2(ix + 1, iy, seed)
    n01 = _hash2(ix, iy + 1, seed)
    n11 = _hash2(ix + 1, iy + 1, seed)
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy


def fbm(x: np.ndarray, y: np.ndarray, octaves: int, seed: int, lac: float = 2.03, gain: float = 0.5) -> np.ndarray:
    total = np.zeros_like(x, dtype=np.float64)
    amp = 1.0
    norm = 0.0
    fx, fy = x, y
    for o in range(octaves):
        total += amp * (value_noise(fx, fy, seed + o * 1013) * 2.0 - 1.0)
        norm += amp
        amp *= gain
        fx = fx * lac
        fy = fy * lac
    return total / max(norm, 1e-6)


# ------------------------------------------------------------------ builder

class TerrainBuilder:
    def __init__(self, proj: Projector, half_m: float, grid: int, dem: Dem | None):
        self.proj = proj
        self.half = half_m
        self.n = grid
        self.cell = (2 * half_m) / (grid - 1)
        self.dem = dem
        xs = np.linspace(-half_m, half_m, grid)
        ys = np.linspace(half_m, -half_m, grid)  # row 0 = north
        self.gx, self.gy = np.meshgrid(xs, ys)
        self.h = np.zeros((grid, grid), dtype=np.float32)
        self.ground = np.full((grid, grid), 0, dtype=np.uint8)
        self.road_mask = np.zeros((grid, grid), dtype=np.float32)

    def build_base(self):
        if self.dem is not None:
            lat = self.proj.lat0 + self.gy / self.proj.my
            lon = self.proj.lon0 + self.gx / self.proj.mx
            base = self.dem.sample_latlon(lat, lon).astype(np.float64)
        else:
            # Fallback only -- flagged as APPROXIMATED in docs/world-accuracy.md.
            base = 150.0 + 6.0 * fbm(self.gx / 1800.0, self.gy / 1800.0, 4, 7)
        # Sub-DEM micro relief. SRTM is 30 m; without this the ground reads as
        # large flat triangles. Amplitude stays under ~0.9 m so it never
        # contradicts the measured surface.
        micro = (
            0.55 * fbm(self.gx / 110.0, self.gy / 110.0, 3, 101)
            + 0.22 * fbm(self.gx / 34.0, self.gy / 34.0, 2, 211)
            + 0.09 * fbm(self.gx / 11.0, self.gy / 11.0, 2, 307)
        )
        self.h = (base + micro).astype(np.float32)
        self.base_min = float(np.min(base))
        self.base_max = float(np.max(base))

    # -- rasterisation helpers -------------------------------------------------
    def _to_grid(self, x, y):
        cx = (x + self.half) / self.cell
        cy = (self.half - y) / self.cell
        return cx, cy

    def stamp_polygon_ground(self, poly, value: int):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        c0x, c0y = self._to_grid(x0, y1)
        c1x, c1y = self._to_grid(x1, y0)
        i0 = max(0, int(math.floor(c0x)))
        i1 = min(self.n - 1, int(math.ceil(c1x)))
        j0 = max(0, int(math.floor(c0y)))
        j1 = min(self.n - 1, int(math.ceil(c1y)))
        if i1 < i0 or j1 < j0:
            return
        sub_x = self.gx[j0 : j1 + 1, i0 : i1 + 1]
        sub_y = self.gy[j0 : j1 + 1, i0 : i1 + 1]
        inside = _points_in_poly(sub_x, sub_y, poly)
        region = self.ground[j0 : j1 + 1, i0 : i1 + 1]
        region[inside] = value
        self.ground[j0 : j1 + 1, i0 : i1 + 1] = region

    def sample(self, x: float, y: float) -> float:
        cx, cy = self._to_grid(x, y)
        cx = min(max(cx, 0.0), self.n - 1.001)
        cy = min(max(cy, 0.0), self.n - 1.001)
        i, j = int(cx), int(cy)
        tx, ty = cx - i, cy - j
        h = self.h
        return float(
            (h[j, i] * (1 - tx) + h[j, i + 1] * tx) * (1 - ty)
            + (h[j + 1, i] * (1 - tx) + h[j + 1, i + 1] * tx) * ty
        )

    def sample_many(self, pts):
        return [self.sample(p[0], p[1]) for p in pts]

    # -- road carving ----------------------------------------------------------
    def carve_roads(self, roads, profiles=None):
        """Pull terrain towards a longitudinally smoothed road profile.

        `profiles` optionally supplies an exact elevation profile per road, in
        which case no smoothing or gradient limiting is applied -- used for the
        final locking pass so the stored road elevations and the terrain raster
        agree to the centimetre.
        """
        target = np.array(self.h, dtype=np.float32)
        weight = np.zeros_like(target)
        for ri, r in enumerate(roads):
            pts = r["pts"]
            if len(pts) < 2:
                continue
            if profiles is not None:
                prof = np.asarray(profiles[ri], dtype=np.float64)
            else:
                prof = np.array([self.sample(p[0], p[1]) for p in pts], dtype=np.float64)
                prof = _smooth_profile(prof, r["smooth_passes"])
                # Limit longitudinal gradient so roads stay rideable.
                prof = _limit_gradient(pts, prof, r["max_grade"])
            half_w = r["width"] * 0.5 + r["shoulder"]
            blend = half_w + r["blend"]
            for i in range(len(pts) - 1):
                self._carve_segment(target, weight, pts[i], pts[i + 1], prof[i], prof[i + 1], half_w, blend)
        m = weight > 0
        self.h[m] = (self.h[m] * (1.0 - weight[m]) + target[m] * weight[m]).astype(np.float32)
        self.road_mask = np.clip(weight, 0, 1)

    def _carve_segment(self, target, weight, a, b, ha, hb, half_w, blend):
        ax, ay = a
        bx, by = b
        minx, maxx = min(ax, bx) - blend, max(ax, bx) + blend
        miny, maxy = min(ay, by) - blend, max(ay, by) + blend
        c0x, c0y = self._to_grid(minx, maxy)
        c1x, c1y = self._to_grid(maxx, miny)
        i0 = max(0, int(math.floor(c0x)))
        i1 = min(self.n - 1, int(math.ceil(c1x)))
        j0 = max(0, int(math.floor(c0y)))
        j1 = min(self.n - 1, int(math.ceil(c1y)))
        if i1 < i0 or j1 < j0:
            return
        px = self.gx[j0 : j1 + 1, i0 : i1 + 1]
        py = self.gy[j0 : j1 + 1, i0 : i1 + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 < 1e-9:
            return
        t = ((px - ax) * dx + (py - ay) * dy) / L2
        t = np.clip(t, 0.0, 1.0)
        cx = ax + t * dx
        cy = ay + t * dy
        d = np.hypot(px - cx, py - cy)
        w = np.clip((blend - d) / max(blend - half_w, 1e-3), 0.0, 1.0)
        w = w * w * (3 - 2 * w)
        hz = ha + (hb - ha) * t
        sub_t = target[j0 : j1 + 1, i0 : i1 + 1]
        sub_w = weight[j0 : j1 + 1, i0 : i1 + 1]
        upd = w > sub_w
        sub_t[upd] = hz[upd]
        sub_w[upd] = w[upd]
        target[j0 : j1 + 1, i0 : i1 + 1] = sub_t
        weight[j0 : j1 + 1, i0 : i1 + 1] = sub_w

    def flatten_polygon(self, poly, height: float, blend: float = 6.0):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        c0x, c0y = self._to_grid(min(xs) - blend, max(ys) + blend)
        c1x, c1y = self._to_grid(max(xs) + blend, min(ys) - blend)
        i0 = max(0, int(math.floor(c0x)))
        i1 = min(self.n - 1, int(math.ceil(c1x)))
        j0 = max(0, int(math.floor(c0y)))
        j1 = min(self.n - 1, int(math.ceil(c1y)))
        if i1 < i0 or j1 < j0:
            return
        px = self.gx[j0 : j1 + 1, i0 : i1 + 1]
        py = self.gy[j0 : j1 + 1, i0 : i1 + 1]
        inside = _points_in_poly(px, py, poly)
        sub = self.h[j0 : j1 + 1, i0 : i1 + 1]
        sub[inside] = height
        self.h[j0 : j1 + 1, i0 : i1 + 1] = sub

    def smooth(self, passes: int = 1):
        for _ in range(passes):
            h = self.h
            p = np.pad(h, 1, mode="edge")
            self.h = (
                0.4 * h
                + 0.15 * (p[:-2, 1:-1] + p[2:, 1:-1])
                + 0.15 * (p[1:-1, :-2] + p[1:-1, 2:])
            ).astype(np.float32)


def _points_in_poly(px, py, poly):
    inside = np.zeros(px.shape, dtype=bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = (yi > py) != (yj > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (py - yi) / (yj - yi) if abs(yj - yi) > 1e-12 else np.zeros_like(py)
        xint = xi + t * (xj - xi)
        inside ^= cond & (px < xint)
        j = i
    return inside


def _smooth_profile(prof: np.ndarray, passes: int) -> np.ndarray:
    p = prof.copy()
    n = len(p)
    if n < 3:
        return p
    for _ in range(passes):
        q = p.copy()
        q[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
        p = q
    return p


def _limit_gradient(pts, prof: np.ndarray, max_grade: float) -> np.ndarray:
    """Clamp |dh/ds| so no road section exceeds a plausible gradient."""
    p = prof.copy()
    n = len(p)
    # Relaxation: forward + backward sweeps, iterated until it converges.
    for _ in range(24):
        for i in range(n - 1):
            ds = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            if ds < 1e-6:
                continue
            lim = max_grade * ds
            d = p[i + 1] - p[i]
            if d > lim:
                p[i + 1] -= (d - lim) * 0.5
                p[i] += (d - lim) * 0.5
            elif d < -lim:
                p[i + 1] += (-d - lim) * 0.5
                p[i] -= (-d - lim) * 0.5
        for i in range(n - 2, -1, -1):
            ds = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            if ds < 1e-6:
                continue
            lim = max_grade * ds
            d = p[i + 1] - p[i]
            if d > lim:
                p[i + 1] -= (d - lim) * 0.5
                p[i] += (d - lim) * 0.5
            elif d < -lim:
                p[i + 1] += (-d - lim) * 0.5
                p[i] -= (-d - lim) * 0.5
        if _max_grade(pts, p) <= max_grade * 1.001:
            break
    return p


def _max_grade(pts, prof) -> float:
    g = 0.0
    for i in range(len(prof) - 1):
        ds = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if ds < 1e-6:
            continue
        g = max(g, abs(prof[i + 1] - prof[i]) / ds)
    return g


def limit_gradient(pts, prof, max_grade: float):
    """Public wrapper used by the build pipeline's final locking pass."""
    return _limit_gradient(pts, np.asarray(prof, dtype=np.float64), max_grade)
