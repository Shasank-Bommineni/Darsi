"""Read an Overpass `out geom` answer into projected, typed feature lists."""
from __future__ import annotations

from dataclasses import dataclass, field

from .geo import Projector, poly_area, poly_centroid


@dataclass
class Feature:
    osm_type: str
    osm_id: int
    tags: dict
    pts: list = field(default_factory=list)   # projected [(x, y), ...]
    closed: bool = False
    lonlat: list = field(default_factory=list)

    @property
    def ref(self) -> str:
        return f"{self.osm_type[0]}{self.osm_id}"


def _ring_from_geometry(geom, proj: Projector):
    pts = [proj.forward(g["lat"], g["lon"]) for g in geom]
    ll = [(g["lon"], g["lat"]) for g in geom]
    closed = len(pts) > 3 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6
    if closed:
        pts = pts[:-1]
        ll = ll[:-1]
    return pts, ll, closed


def read(osm: dict, proj: Projector) -> list[Feature]:
    feats: list[Feature] = []
    for el in osm.get("elements", []):
        t = el.get("type")
        tags = el.get("tags") or {}
        if t == "node":
            if not tags:
                continue
            x, y = proj.forward(el["lat"], el["lon"])
            feats.append(Feature("node", el["id"], tags, [(x, y)], False, [(el["lon"], el["lat"])]))
        elif t == "way":
            geom = el.get("geometry")
            if not geom or len(geom) < 2:
                continue
            pts, ll, closed = _ring_from_geometry(geom, proj)
            if len(pts) < 2:
                continue
            f = Feature("way", el["id"], tags, pts, closed, ll)
            f.node_ids = el.get("nodes") or []
            feats.append(f)
        elif t == "relation":
            if tags.get("type") not in ("multipolygon", "building"):
                continue
            # Take the largest outer ring; small towns rarely need full
            # multipolygon assembly and holes are not visually load-bearing here.
            best = None
            for m in el.get("members", []):
                if m.get("role") not in ("outer", ""):
                    continue
                geom = m.get("geometry")
                if not geom or len(geom) < 4:
                    continue
                pts, ll, closed = _ring_from_geometry(geom, proj)
                if len(pts) < 3:
                    continue
                a = abs(poly_area(pts))
                if best is None or a > best[0]:
                    best = (a, pts, ll)
            if best:
                feats.append(Feature("relation", el["id"], tags, best[1], True, best[2]))
    return feats


def ways_with(feats, key: str):
    return [f for f in feats if key in f.tags]
