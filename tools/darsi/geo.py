"""Geographic projection and 2D geometry helpers for the Darsi world build.

Everything downstream works in a local east/north metre frame anchored on the
Darsi town centre.  Over a 9 km window an equirectangular projection is accurate
to well under a metre, which is far below the fidelity of the source data.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_R = 6378137.0

# Darsi town centre -- OSM place node 3319071258 (name=Darsi, place=town).
ANCHOR_LAT = 15.7694505
ANCHOR_LON = 79.6776541


@dataclass(frozen=True)
class Projector:
    lat0: float = ANCHOR_LAT
    lon0: float = ANCHOR_LON

    @property
    def mx(self) -> float:
        return math.cos(math.radians(self.lat0)) * math.radians(1.0) * EARTH_R

    @property
    def my(self) -> float:
        return math.radians(1.0) * EARTH_R

    def forward(self, lat: float, lon: float) -> tuple[float, float]:
        """lat/lon -> (east metres, north metres)."""
        return ((lon - self.lon0) * self.mx, (lat - self.lat0) * self.my)

    def inverse(self, x: float, y: float) -> tuple[float, float]:
        return (self.lat0 + y / self.my, self.lon0 + x / self.mx)


# ---------------------------------------------------------------- 2D geometry

def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def poly_area(pts) -> float:
    """Signed area (positive = counter-clockwise)."""
    n = len(pts)
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def poly_centroid(pts) -> tuple[float, float]:
    a = poly_area(pts)
    if abs(a) < 1e-9:
        n = max(1, len(pts))
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cr = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    return (cx / (6 * a), cy / (6 * a))


def convex_hull(points):
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_area_rect(points):
    """Rotating-calipers minimum-area bounding rectangle.

    Returns (cx, cy, width, depth, angle) where `angle` is the rotation of the
    `width` axis in radians and width >= depth.
    """
    hull = convex_hull(points)
    if len(hull) < 3:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        w = max(1e-3, max(xs) - min(xs))
        d = max(1e-3, max(ys) - min(ys))
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, w, d, 0.0)

    best = None
    n = len(hull)
    for i in range(n):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        L = math.hypot(ex, ey)
        if L < 1e-9:
            continue
        ex, ey = ex / L, ey / L
        nx, ny = -ey, ex
        us = [p[0] * ex + p[1] * ey for p in hull]
        vs = [p[0] * nx + p[1] * ny for p in hull]
        u0, u1 = min(us), max(us)
        v0, v1 = min(vs), max(vs)
        area = (u1 - u0) * (v1 - v0)
        if best is None or area < best[0]:
            cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
            cx = cu * ex + cv * nx
            cy = cu * ey + cv * ny
            best = (area, cx, cy, u1 - u0, v1 - v0, math.atan2(ey, ex))
    _, cx, cy, w, d, ang = best
    if d > w:
        w, d = d, w
        ang += math.pi / 2
    return (cx, cy, w, d, ang)


def point_in_poly(x, y, poly) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            t = (y - yi) / (yj - yi + 1e-18)
            if x < xi + t * (xj - xi):
                inside = not inside
        j = i
    return inside


def seg_point_dist(px, py, ax, ay, bx, by) -> tuple[float, float]:
    """Distance from P to segment AB, and the parametric position t in [0,1]."""
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 < 1e-12:
        return (math.hypot(px - ax, py - ay), 0.0)
    t = ((px - ax) * dx + (py - ay) * dy) / L2
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return (math.hypot(px - cx, py - cy), t)


def resample_polyline(pts, step: float):
    """Resample a polyline to roughly uniform spacing, preserving both ends."""
    if len(pts) < 2:
        return list(pts)
    out = [tuple(pts[0])]
    carry = 0.0
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-9:
            continue
        pos = carry
        while pos + step <= seg:
            pos += step
            t = pos / seg
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
        carry = pos - seg
    if dist(out[-1], pts[-1]) > step * 0.33:
        out.append(tuple(pts[-1]))
    else:
        out[-1] = tuple(pts[-1])
    return out


def smooth_polyline(pts, passes: int = 1, weight: float = 0.5):
    """Light Laplacian smoothing that keeps the endpoints pinned."""
    p = [tuple(q) for q in pts]
    for _ in range(passes):
        if len(p) < 3:
            break
        q = [p[0]]
        for i in range(1, len(p) - 1):
            ax, ay = p[i - 1]
            bx, by = p[i]
            cx, cy = p[i + 1]
            q.append((bx + weight * ((ax + cx) * 0.5 - bx), by + weight * ((ay + cy) * 0.5 - by)))
        q.append(p[-1])
        p = q
    return p


def polyline_length(pts) -> float:
    return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
